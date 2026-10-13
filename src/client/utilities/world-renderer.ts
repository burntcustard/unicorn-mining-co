import { DrawingPath } from './drawing-path';
import { mesh, strokePath } from './path-mesh';

class Gradient {
  stops: [number, number[]][] = [];
  constructor(
    public radial: boolean,
    public from: number[],
    public to: number[],
  ) {}
  addColorStop(at: number, color: string) {
    this.stops.push([at, rgba(color)]);
    this.stops.sort((a, b) => a[0] - b[0]);
  }
}

const colors = new Map<string, number[]>();

function rgba(value: string): number[] {
  let c = colors.get(value);

  if (c) return c;

  if (value[0] === '#') {
    let h = value.slice(1);

    if (h.length === 3 || h.length === 4) {
      h = h
        .split('')
        .map((v) => v + v)
        .join('');
    }

    c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    c.push(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
  } else if (value.startsWith('rgb')) {
    c = value.match(/[\d.]+/g)!.map(Number);
    c[0] /= 255;
    c[1] /= 255;
    c[2] /= 255;

    if (c.length === 3) c.push(1);
  } else {
    throw Error('Unsupported vector color ' + value);
  }

  colors.set(value, c);
  return c;
}

export class WorldRenderer {
  matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  states: [
    WorldRenderer['matrix'],
    number,
    string,
    string | Gradient,
    string | Gradient,
    number,
    string,
    string,
    number[],
    WorldRenderer['clips'],
  ][] = [];
  clips: { path: DrawingPath; matrix: DOMMatrix; rule: string }[] = [];
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle: string | Gradient = '#000';
  strokeStyle: string | Gradient = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  lineCap = 'butt';
  imageSmoothingEnabled = true;
  dash: number[] = [];
  path = new DrawingPath(false);
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  backdrop: WebGLTexture;
  buffers = new WeakMap<Float32Array, { uses: number; buffer?: WebGLBuffer }>();
  uniforms = new Map<string, WebGLUniformLocation>();
  textures = new WeakMap<
    object,
    { texture: WebGLTexture; width: number; height: number }
  >();
  batch = new Float32Array(65536);
  batchLength = 0;
  batchProgram: WebGLProgram;
  batchBuffer: WebGLBuffer;
  batchSize: WebGLUniformLocation;
  frame: WebGLFramebuffer;
  world: WebGLTexture;
  stencilBuffer: WebGLRenderbuffer;
  width = 0;
  height = 0;
  backdropWidth = 0;
  backdropHeight = 0;
  static create(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext(
      'webgl2',
      Object.fromEntries([
        ['alpha', true],
        ['stencil', true],
        ['antialias', false],
        ['premultipliedAlpha', true],
      ]),
    ) as WebGL2RenderingContext;

    return gl ? new WorldRenderer(canvas, gl) : undefined;
  }

  private constructor(
    public canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    const program = (this.program = gl.createProgram()!);
    const shaders = [
      [
        gl.VERTEX_SHADER,
        `#version 300 es
      in vec2 a_position;uniform mat3 u_matrix;uniform vec2 u_size;out vec2 v_local;
      void main(){vec3 r_p=u_matrix*vec3(a_position,1.);gl_Position=vec4(r_p.x/u_size.x*2.-1.,1.-r_p.y/u_size.y*2.,0.,1.);v_local=a_position;}`,
      ],
      [
        gl.FRAGMENT_SHADER,
        `#version 300 es
      precision highp float;in vec2 v_local;uniform vec2 u_size;uniform vec4 u_colors[4];uniform vec4 u_stops;uniform int u_kind,u_count,u_blend;uniform vec4 u_axis,u_rect,u_uv;uniform float u_alpha;uniform sampler2D u_image,u_backdrop;out vec4 r_color;
      float r_luma(vec4 r_c){return dot(r_c.rgb,vec3(.299,.587,.114));}
      vec4 r_edge(vec2 r_uv){vec2 r_px=1./u_size;vec4 r_mid=texture(u_image,r_uv);float r_nw=r_luma(texture(u_image,r_uv+vec2(-1.,1.)*r_px)),r_ne=r_luma(texture(u_image,r_uv+r_px)),r_sw=r_luma(texture(u_image,r_uv-r_px)),r_se=r_luma(texture(u_image,r_uv+vec2(1.,-1.)*r_px));
        float r_lo=min(r_luma(r_mid),min(min(r_nw,r_ne),min(r_sw,r_se))),r_hi=max(r_luma(r_mid),max(max(r_nw,r_ne),max(r_sw,r_se)));if(r_hi-r_lo<.04)return r_mid;
        vec2 r_dir=vec2(-((r_nw+r_ne)-(r_sw+r_se)),(r_nw+r_sw)-(r_ne+r_se));float r_reduce=max((r_nw+r_ne+r_sw+r_se)*.03125,.0078125);r_dir=clamp(r_dir/(min(abs(r_dir.x),abs(r_dir.y))+r_reduce),vec2(-8.),vec2(8.))*r_px;
        vec4 r_a=.5*(texture(u_image,r_uv+r_dir*(-1./6.))+texture(u_image,r_uv+r_dir*(1./6.)));vec4 r_b=r_a*.5+.25*(texture(u_image,r_uv-r_dir*.5)+texture(u_image,r_uv+r_dir*.5));float r_lb=r_luma(r_b);return r_lb<r_lo||r_lb>r_hi?r_a:r_b;
      }
      void main(){vec4 r_src=u_colors[0];if(u_kind==5){r_color=r_edge(vec2(v_local.x/u_size.x,1.-v_local.y/u_size.y));return;}if(u_kind==3){vec2 r_uv=u_uv.xy+(v_local-u_rect.xy)/u_rect.zw*u_uv.zw;r_src=texture(u_image,r_uv);}
      else if(u_kind==4){vec2 r_p=v_local-u_axis.xy;float r_len=length(r_p),r_aa=max(fwidth(r_len),.00001);float r_mask=clamp(.5-(abs(r_len-u_axis.z)-u_axis.w*.5)/r_aa,0.,1.);if(r_mask<=0.)discard;
        if(u_stops.x>0.){float r_angle=mod(atan(r_p.y,r_p.x)+6.28318530718,6.28318530718);float r_q=mod(r_angle*u_axis.z,u_stops.x);r_mask*=smoothstep(-r_aa*.5,r_aa*.5,min(r_q,u_stops.y-r_q));}r_src.a*=r_mask;}
      else if(u_kind!=0){float r_t=u_kind==1?dot(v_local-u_axis.xy,u_axis.zw):length(v_local-u_axis.xy)*u_axis.z+u_axis.w;
        for(int r_i=1;r_i<4;r_i++){if(r_i>=u_count)break;float r_a=u_stops[r_i-1],r_b=u_stops[r_i];vec4 r_next=u_colors[r_i];r_src=mix(r_src,r_next,clamp((r_t-r_a)/max(r_b-r_a,.00001),0.,1.));}
      }if(u_kind!=3)r_src.rgb*=r_src.a;r_src*=u_alpha;
      if(u_blend==2){vec4 r_dst=texture(u_backdrop,gl_FragCoord.xy/u_size);vec3 r_mix=max(r_src.rgb/max(r_src.a,.000001),r_dst.rgb/max(r_dst.a,.000001));r_color=vec4((1.-r_src.a)*r_dst.rgb+(1.-r_dst.a)*r_src.rgb+r_src.a*r_dst.a*r_mix,r_src.a+r_dst.a-r_src.a*r_dst.a);}else r_color=r_src;}`,
      ],
    ] as const;

    for (const [type, source] of shaders) {
      const shader = gl.createShader(type)!;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw Error(gl.getShaderInfoLog(shader)!);
      }

      gl.attachShader(program, shader);
    }

    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw Error(gl.getProgramInfoLog(program)!);
    }

    gl.useProgram(program);

    for (const name of [
      'u_matrix',
      'u_size',
      'u_colors[0]',
      'u_stops',
      'u_kind',
      'u_count',
      'u_blend',
      'u_axis',
      'u_rect',
      'u_uv',
      'u_alpha',
      'u_image',
      'u_backdrop',
    ]) {
      this.uniforms.set(name, gl.getUniformLocation(program, name)!);
    }

    gl.uniform1i(this.uniforms.get('u_image')!, 0);
    gl.uniform1i(this.uniforms.get('u_backdrop')!, 1);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.backdrop = this.texture();
    this.world = this.texture();
    this.frame = gl.createFramebuffer()!;
    this.stencilBuffer = gl.createRenderbuffer()!;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.createBatch();
    const initial = gl.getError();

    if (initial) throw Error('Initial GL ' + initial);
  }
  createBatch() {
    const g = this.gl,
      p = (this.batchProgram = g.createProgram()!);

    for (const [type, source] of [
      [
        g.VERTEX_SHADER,
        `#version 300 es
    in vec2 a_position;in vec4 a_color;uniform vec2 u_size;out vec4 v_color;void main(){gl_Position=vec4(a_position.x/u_size.x*2.-1.,1.-a_position.y/u_size.y*2.,0.,1.);v_color=a_color;}`,
      ],
      [
        g.FRAGMENT_SHADER,
        `#version 300 es
    precision highp float;in vec4 v_color;out vec4 r_color;void main(){r_color=v_color;}`,
      ],
    ] as const) {
      const shader = g.createShader(type)!;

      g.shaderSource(shader, source);
      g.compileShader(shader);

      if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
        throw Error(g.getShaderInfoLog(shader)!);
      }

      g.attachShader(p, shader);
    }

    g.bindAttribLocation(p, 0, 'a_position');
    g.bindAttribLocation(p, 1, 'a_color');
    g.linkProgram(p);

    if (!g.getProgramParameter(p, g.LINK_STATUS)) {
      throw Error(g.getProgramInfoLog(p)!);
    }

    this.batchSize = g.getUniformLocation(p, 'u_size')!;
    this.batchBuffer = g.createBuffer()!;
    g.bindBuffer(g.ARRAY_BUFFER, this.batchBuffer);
    g.bufferData(g.ARRAY_BUFFER, this.batch.byteLength, g.DYNAMIC_DRAW);
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  }
  emit(data: Float32Array, color: string) {
    if (this.batchLength + data.length * 3 > this.batch.length) this.flush();

    if (data.length * 3 > this.batch.length) {
      throw Error('Vector batch exceeds buffer');
    }

    const { a, b, c, d, e, f } = this.matrix,
      colorValue = rgba(color),
      alpha = colorValue[3] * this.globalAlpha;
    let at = this.batchLength;

    for (let i = 0; i < data.length; i += 2) {
      const x = data[i],
        y = data[i + 1];

      this.batch[at++] = a * x + c * y + e;
      this.batch[at++] = b * x + d * y + f;
      this.batch[at++] = colorValue[0] * alpha;
      this.batch[at++] = colorValue[1] * alpha;
      this.batch[at++] = colorValue[2] * alpha;
      this.batch[at++] = alpha;
    }

    this.batchLength = at;
  }
  flush() {
    if (!this.batchLength) return;
    const g = this.gl;

    g.useProgram(this.batchProgram);
    g.disable(g.SCISSOR_TEST);
    g.disable(g.STENCIL_TEST);
    g.colorMask(true, true, true, true);
    g.enable(g.BLEND);
    g.blendEquation(g.FUNC_ADD);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.uniform2f(this.batchSize, this.canvas.width, this.canvas.height);
    g.bindBuffer(g.ARRAY_BUFFER, this.batchBuffer);
    g.bufferSubData(
      g.ARRAY_BUFFER,
      0,
      this.batch.subarray(0, this.batchLength),
    );
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 24, 0);
    g.enableVertexAttribArray(1);
    g.vertexAttribPointer(1, 4, g.FLOAT, false, 24, 8);
    g.drawArrays(g.TRIANGLES, 0, this.batchLength / 6);
    this.batchLength = 0;
    g.disableVertexAttribArray(1);
    g.useProgram(this.program);
    g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  }
  texture() {
    const g = this.gl,
      t = g.createTexture()!;

    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }
  getContextAttributes() {
    const error = this.gl.getError();

    if (error) throw Error(`World graphics error ${error}`);
    return { ...this.gl.getContextAttributes(), willReadFrequently: false };
  }
  clearRect() {
    const g = this.gl;

    if (
      this.width !== this.canvas.width ||
      this.height !== this.canvas.height
    ) {
      this.width = this.canvas.width;
      this.height = this.canvas.height;
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, this.world);
      g.texImage2D(
        g.TEXTURE_2D,
        0,
        g.RGBA,
        this.width,
        this.height,
        0,
        g.RGBA,
        g.UNSIGNED_BYTE,
        null,
      );
      g.bindFramebuffer(g.FRAMEBUFFER, this.frame);
      g.framebufferTexture2D(
        g.FRAMEBUFFER,
        g.COLOR_ATTACHMENT0,
        g.TEXTURE_2D,
        this.world,
        0,
      );
      g.bindRenderbuffer(g.RENDERBUFFER, this.stencilBuffer);
      g.renderbufferStorage(
        g.RENDERBUFFER,
        g.STENCIL_INDEX8,
        this.width,
        this.height,
      );
      g.framebufferRenderbuffer(
        g.FRAMEBUFFER,
        g.STENCIL_ATTACHMENT,
        g.RENDERBUFFER,
        this.stencilBuffer,
      );

      if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) {
        throw Error('Vector framebuffer incomplete');
      }
    }

    g.bindFramebuffer(g.FRAMEBUFFER, this.frame);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, null);
    g.viewport(0, 0, this.canvas.width, this.canvas.height);
    g.disable(g.SCISSOR_TEST);
    g.colorMask(true, true, true, true);
    g.stencilMask(255);
    g.clearColor(0, 0, 0, 0);
    g.clearStencil(0);
    g.clear(g.COLOR_BUFFER_BIT | g.STENCIL_BUFFER_BIT);
    g.useProgram(this.program);
    g.uniform2f(
      this.uniforms.get('u_size')!,
      this.canvas.width,
      this.canvas.height,
    );
  }
  save() {
    this.states.push([
      { ...this.matrix },
      this.globalAlpha,
      this.globalCompositeOperation,
      this.fillStyle,
      this.strokeStyle,
      this.lineWidth,
      this.lineJoin,
      this.lineCap,
      this.dash,
      this.clips.slice(),
    ]);
  }
  restore() {
    [
      this.matrix,
      this.globalAlpha,
      this.globalCompositeOperation,
      this.fillStyle,
      this.strokeStyle,
      this.lineWidth,
      this.lineJoin,
      this.lineCap,
      this.dash,
      this.clips,
    ] = this.states.pop()!;
  }
  scale(x: number, y: number) {
    const m = this.matrix;

    m.a *= x;
    m.b *= x;
    m.c *= y;
    m.d *= y;
  }
  translate(x: number, y: number) {
    const m = this.matrix;

    m.e += m.a * x + m.c * y;
    m.f += m.b * x + m.d * y;
  }
  rotate(angle: number) {
    const m = this.matrix,
      { a, b, c, d } = m,
      sin = Math.sin(angle),
      cos = Math.cos(angle);

    m.a = a * cos + c * sin;
    m.b = b * cos + d * sin;
    m.c = c * cos - a * sin;
    m.d = d * cos - b * sin;
  }
  resetTransform() {
    this.matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  getTransform() {
    return new DOMMatrix([
      this.matrix.a,
      this.matrix.b,
      this.matrix.c,
      this.matrix.d,
      this.matrix.e,
      this.matrix.f,
    ]);
  }
  beginPath() {
    this.path = new DrawingPath(false);
  }
  moveTo(x: number, y: number) {
    this.path.moveTo(x, y);
  }
  lineTo(x: number, y: number) {
    this.path.lineTo(x, y);
  }
  closePath() {
    this.path.closePath();
  }
  arc(...args: Parameters<DrawingPath['arc']>) {
    this.path.arc(...args);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.path.rect(x, y, w, h);
  }
  setLineDash(values: number[]) {
    this.dash = values.slice();
  }
  createLinearGradient(x: number, y: number, u: number, v: number) {
    return new Gradient(false, [x, y], [u, v]);
  }
  createRadialGradient(
    x: number,
    y: number,
    r: number,
    u: number,
    v: number,
    s: number,
  ) {
    if (x !== u || y !== v) throw Error('Off-center radial gradient');
    return new Gradient(true, [x, y, r], [u, v, s]);
  }
  clip(path: DrawingPath | string = this.path, rule = 'nonzero') {
    if (typeof path === 'string') {
      rule = path;
      path = this.path;
    }

    if (this.clips.length === 4) throw Error('Too many vector clips');
    this.clips.push({ path, matrix: this.getTransform(), rule });
  }
  vertices(data: Float32Array, matrix = this.matrix) {
    const g = this.gl,
      m = matrix;

    g.uniformMatrix3fv(this.uniforms.get('u_matrix')!, false, [
      m.a,
      m.b,
      0,
      m.c,
      m.d,
      0,
      m.e,
      m.f,
      1,
    ]);
    let record = this.buffers.get(data);

    if (!record) this.buffers.set(data, (record = { uses: 0 }));

    if (++record.uses === 3) {
      record.buffer = g.createBuffer()!;
      g.bindBuffer(g.ARRAY_BUFFER, record.buffer);
      g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
    } else if (record.buffer) {
      g.bindBuffer(g.ARRAY_BUFFER, record.buffer);
    } else {
      g.bindBuffer(g.ARRAY_BUFFER, this.buffer);
      g.bufferData(g.ARRAY_BUFFER, data, g.STREAM_DRAW);
    }

    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.drawArrays(g.TRIANGLES, 0, data.length / 2);
  }
  counter(
    path: DrawingPath,
    matrix: WorldRenderer['matrix'],
    rule: string,
    mask: number,
  ) {
    const g = this.gl;

    g.stencilMask(15);
    g.clearStencil(0);
    g.clear(g.STENCIL_BUFFER_BIT);
    g.stencilFunc(g.EQUAL, mask, 240);
    g.colorMask(false, false, false, false);
    g.disable(g.BLEND);
    g.uniform1i(this.uniforms.get('u_kind')!, 0);
    g.uniform1i(this.uniforms.get('u_blend')!, 0);

    if (rule === 'evenodd') {
      g.stencilOp(g.KEEP, g.KEEP, g.INVERT);
    } else {
      g.frontFace(g.CW);
      g.stencilOpSeparate(g.FRONT, g.KEEP, g.KEEP, g.INCR_WRAP);
      g.stencilOpSeparate(g.BACK, g.KEEP, g.KEEP, g.DECR_WRAP);
    }

    this.vertices(mesh(path).vertices, matrix);
  }
  scissor(bounds: number[]) {
    const m = this.matrix;
    let l = Infinity,
      t = Infinity,
      r = -Infinity,
      b = -Infinity;

    for (const x of [bounds[0], bounds[2]]) {
      for (const y of [bounds[1], bounds[3]]) {
        const u = m.a * x + m.c * y + m.e,
          v = m.b * x + m.d * y + m.f;

        l = Math.min(l, u);
        r = Math.max(r, u);
        t = Math.min(t, v);
        b = Math.max(b, v);
      }
    }

    l = Math.max(0, Math.floor(l - 1));
    r = Math.min(this.canvas.width, Math.ceil(r + 1));
    t = Math.max(0, Math.floor(t - 1));
    b = Math.min(this.canvas.height, Math.ceil(b + 1));
    this.gl.enable(this.gl.SCISSOR_TEST);
    this.gl.scissor(
      l,
      this.canvas.height - b,
      Math.max(0, r - l),
      Math.max(0, b - t),
    );
  }
  prepare() {
    this.flush();
    const g = this.gl;

    g.enable(g.STENCIL_TEST);
    g.stencilMask(255);
    g.clearStencil(0);
    g.clear(g.STENCIL_BUFFER_BIT);
    let mask = 0;

    for (let i = 0; i < this.clips.length; i++) {
      const c = this.clips[i],
        bit = 128 >> i;

      this.counter(c.path, c.matrix, c.rule, mask);
      g.stencilMask(bit);
      g.stencilFunc(g.NOTEQUAL, bit, 15);
      g.stencilOp(g.KEEP, g.KEEP, g.REPLACE);
      this.vertices(this.quad(mesh(c.path).bounds), c.matrix);
      mask |= bit;
    }

    return mask;
  }
  quad([l, t, r, b]: number[]) {
    return new Float32Array([l, t, r, t, r, b, l, t, r, b, l, b]);
  }
  style(value: string | Gradient) {
    const g = this.gl;

    if (typeof value === 'string') {
      g.uniform4fv(this.uniforms.get('u_colors[0]')!, rgba(value));
      g.uniform1i(this.uniforms.get('u_kind')!, 0);
      return;
    }

    let colors: number[][],
      stops: number[],
      kind = 0,
      axis = [0, 0, 0, 0];

    if (value instanceof Gradient) {
      colors = value.stops.map((s) => s[1]);
      stops = value.stops.map((s) => s[0]);

      if (colors.length > 4) throw Error('Too many gradient stops');
      kind = value.radial ? 2 : 1;

      if (value.radial) {
        const delta = value.to[2] - value.from[2];

        axis = [
          value.from[0],
          value.from[1],
          1 / delta,
          -value.from[2] / delta,
        ];
      } else {
        const x = value.to[0] - value.from[0],
          y = value.to[1] - value.from[1],
          length = x * x + y * y;

        axis = [value.from[0], value.from[1], x / length, y / length];
      }
    } else {
      colors = [rgba(value)];
      stops = [0];
    }

    const count = colors.length;

    while (colors.length < 4) {
      colors.push(colors.at(-1)!);
      stops.push(stops.at(-1)!);
    }

    g.uniform4fv(this.uniforms.get('u_colors[0]')!, colors.flat());
    g.uniform4fv(this.uniforms.get('u_stops')!, stops);
    g.uniform1i(this.uniforms.get('u_count')!, count);
    g.uniform1i(this.uniforms.get('u_kind')!, kind);
    g.uniform4fv(this.uniforms.get('u_axis')!, axis);
  }
  blend(bounds: number[]) {
    const g = this.gl,
      mode =
        this.globalCompositeOperation === 'lighten'
          ? 2
          : this.globalCompositeOperation === 'lighter'
            ? 1
            : 0;

    g.uniform1i(this.uniforms.get('u_blend')!, mode);
    g.uniform1f(this.uniforms.get('u_alpha')!, this.globalAlpha);

    if (mode === 2) {
      const p = [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[0], bounds[3]],
        [bounds[2], bounds[3]],
      ].map(([x, y]) => ({
        x: this.matrix.a * x + this.matrix.c * y + this.matrix.e,
        y: this.matrix.b * x + this.matrix.d * y + this.matrix.f,
      }));

      const l = Math.max(0, Math.floor(Math.min(...p.map((p) => p.x)))),
        t = Math.max(0, Math.floor(Math.min(...p.map((p) => p.y)))),
        r = Math.min(
          this.canvas.width,
          Math.ceil(Math.max(...p.map((p) => p.x))),
        ),
        b = Math.min(
          this.canvas.height,
          Math.ceil(Math.max(...p.map((p) => p.y))),
        );

      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, this.backdrop);

      if (
        this.backdropWidth !== this.canvas.width ||
        this.backdropHeight !== this.canvas.height
      ) {
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RGBA,
          this.canvas.width,
          this.canvas.height,
          0,
          g.RGBA,
          g.UNSIGNED_BYTE,
          null,
        );
        this.backdropWidth = this.canvas.width;
        this.backdropHeight = this.canvas.height;
      }

      if (r > l && b > t) {
        g.copyTexSubImage2D(
          g.TEXTURE_2D,
          0,
          l,
          this.canvas.height - b,
          l,
          this.canvas.height - b,
          r - l,
          b - t,
        );
      }

      g.disable(g.BLEND);
    } else {
      g.enable(g.BLEND);
      g.blendEquation(g.FUNC_ADD);
      g.blendFunc(g.ONE, mode === 1 ? g.ONE : g.ONE_MINUS_SRC_ALPHA);
    }
  }
  fill(
    path: DrawingPath | string = this.path,
    rule = 'nonzero',
    value = this.fillStyle,
  ) {
    if (typeof path === 'string') {
      rule = path;
      path = this.path;
    }

    if (!path.contours.length) return;
    const data = mesh(path);

    if (!data.vertices.length) return;
    const g = this.gl;

    if (
      !this.clips.length &&
      data.triangles &&
      typeof value === 'string' &&
      this.globalCompositeOperation === 'source-over'
    ) {
      this.emit(data.triangles, value);
      return;
    }

    this.flush();
    this.scissor(data.bounds);

    if (!this.clips.length && data.triangles) {
      g.disable(g.STENCIL_TEST);
      g.colorMask(true, true, true, true);
      this.style(value);
      this.blend(data.bounds);
      this.vertices(data.triangles);
      return;
    }

    const mask = this.prepare();

    this.counter(path, this.matrix, rule, mask);
    g.colorMask(true, true, true, true);
    g.stencilMask(0);
    g.stencilFunc(g.NOTEQUAL, 0, 15);
    g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
    this.style(value);
    this.blend(data.bounds);
    this.vertices(this.quad(data.bounds));
    g.disable(g.STENCIL_TEST);
  }
  stroke(path: DrawingPath = this.path) {
    if (
      path.circle &&
      typeof this.strokeStyle === 'string' &&
      this.dash.length <= 2
    ) {
      const [x, y, r] = path.circle,
        pad = this.lineWidth * 0.5 + 2,
        bounds = [x - r - pad, y - r - pad, x + r + pad, y + r + pad],
        g = this.gl;

      this.scissor(bounds);
      const mask = this.prepare();

      g.stencilMask(0);
      g.stencilFunc(g.EQUAL, mask, 240);
      g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
      g.colorMask(true, true, true, true);
      this.style(this.strokeStyle);
      g.uniform1i(this.uniforms.get('u_kind')!, 4);
      g.uniform4f(this.uniforms.get('u_axis')!, x, y, r, this.lineWidth);
      g.uniform4f(
        this.uniforms.get('u_stops')!,
        this.dash.reduce((s, n) => s + n, 0),
        this.dash[0] || 0,
        0,
        0,
      );
      this.blend(bounds);
      this.vertices(this.quad(bounds));
      g.disable(g.STENCIL_TEST);
      return;
    }

    const outline = strokePath(
      path,
      this.lineWidth,
      this.dash,
      this.lineCap,
      this.lineJoin,
    );

    if (
      !this.clips.length &&
      typeof this.strokeStyle === 'string' &&
      rgba(this.strokeStyle)[3] * this.globalAlpha === 1 &&
      this.globalCompositeOperation === 'source-over'
    ) {
      const data = mesh(outline);

      this.emit(data.vertices, this.strokeStyle);
      return;
    }

    this.fill(outline, 'nonzero', this.strokeStyle);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const p = new DrawingPath(false);

    p.rect(x, y, w, h);
    this.fill(p);
  }
  drawImage(image: HTMLCanvasElement | ImageBitmap, ...args: number[]) {
    let sx = 0,
      sy = 0,
      sw = image.width,
      sh = image.height,
      dx: number,
      dy: number,
      dw: number,
      dh: number;

    if (args.length === 2) {
      [dx, dy] = args;
      dw = sw;
      dh = sh;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
    } else {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    }

    const g = this.gl;

    this.scissor([dx, dy, dx + dw, dy + dh]);
    const mask = this.prepare();

    g.stencilMask(0);
    g.stencilFunc(g.EQUAL, mask, 240);
    g.stencilOp(g.KEEP, g.KEEP, g.KEEP);
    g.colorMask(true, true, true, true);
    g.activeTexture(g.TEXTURE0);
    let rec = this.textures.get(image);

    if (!rec) {
      rec = { texture: this.texture(), width: 0, height: 0 };
      this.textures.set(image, rec);
    }

    g.bindTexture(g.TEXTURE_2D, rec.texture);

    if (
      image instanceof HTMLCanvasElement ||
      rec.width !== image.width ||
      rec.height !== image.height
    ) {
      if (rec.width !== image.width || rec.height !== image.height) {
        g.texImage2D(
          g.TEXTURE_2D,
          0,
          g.RGBA,
          image.width,
          image.height,
          0,
          g.RGBA,
          g.UNSIGNED_BYTE,
          null,
        );
      }

      g.texSubImage2D(
        g.TEXTURE_2D,
        0,
        0,
        0,
        Math.min(image.width, Math.ceil(sx + sw) + 1),
        Math.min(image.height, Math.ceil(sy + sh) + 1),
        g.RGBA,
        g.UNSIGNED_BYTE,
        image,
      );
      rec.width = image.width;
      rec.height = image.height;
    }

    g.uniform1i(this.uniforms.get('u_kind')!, 3);
    g.uniform4f(this.uniforms.get('u_rect')!, dx, dy, dw, dh);
    g.uniform4f(
      this.uniforms.get('u_uv')!,
      sx / image.width,
      sy / image.height,
      sw / image.width,
      sh / image.height,
    );
    this.blend([dx, dy, dx + dw, dy + dh]);
    this.vertices(this.quad([dx, dy, dx + dw, dy + dh]));
    g.disable(g.STENCIL_TEST);
  }
  present() {
    this.flush();
    const g = this.gl;

    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.disable(g.SCISSOR_TEST);
    g.disable(g.STENCIL_TEST);
    g.disable(g.BLEND);
    g.colorMask(true, true, true, true);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.world);
    g.uniform1i(this.uniforms.get('u_kind')!, 5);
    this.vertices(this.quad([0, 0, this.width, this.height]), new DOMMatrix());
  }
}
