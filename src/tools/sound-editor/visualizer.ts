const layerColors = ['#58e7ee', '#68df85', '#ffb35c'];

const layerColor = (index: number) =>
  layerColors[index] || `hsl(${(index * 137.5) % 360} 75% 65%)`;

type Waveform = {
  columns: Float32Array;
  peak: number;
};

/**
 * Preserve short transients when reducing a whole sound to canvas columns.
 */
const waveform = (samples: Float32Array, width: number): Waveform => {
  const columns = new Float32Array(Math.max(1, Math.floor(width)) * 2);
  const count = columns.length / 2;
  let peak = 0;

  for (let column = 0; column < count; column++) {
    const start = Math.floor((column * samples.length) / count);
    const end = Math.max(
      start + 1,
      Math.floor(((column + 1) * samples.length) / count),
    );
    let min = Infinity;
    let max = -Infinity;

    for (let index = start; index < end; index++) {
      const value = samples[index] || 0;

      min = Math.min(min, value);
      max = Math.max(max, value);
    }

    columns[column * 2] = min;
    columns[column * 2 + 1] = max;
    peak = Math.max(peak, -min, max);
  }

  return { columns, peak };
};

/**
 * Show each selected sound layer on shared time and amplitude axes.
 */
export const createSoundVisualizer = ({
  canvas,
}: {
  canvas: HTMLCanvasElement;
}) => {
  const ctx = canvas.getContext('2d')!;

  const measure = () => {
    const bounds = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    const horizontal = [
      style.borderLeftWidth,
      style.borderRightWidth,
      style.paddingLeft,
      style.paddingRight,
    ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
    const vertical = [
      style.borderTopWidth,
      style.borderBottomWidth,
      style.paddingTop,
      style.paddingBottom,
    ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);

    return {
      width: Math.max(1, bounds.width - horizontal),
      height: Math.max(1, bounds.height - vertical),
    };
  };

  let size = measure();
  let scaleX = 1;
  let scaleY = 1;

  let layers: { samples: Float32Array; duration: number }[] = [];

  let selected: (Waveform & { duration: number })[] | undefined;

  let selectedPeak = 0;
  let layered = false;
  let hoveredLayer: number | undefined;
  let selectedColumns = 0;
  let duration = 0;
  let disposed = false;
  let resolution: MediaQueryList | undefined;

  const drawPlot = ({
    top,
    height,
    width,
  }: {
    top: number;
    height: number;
    width: number;
  }) => {
    const center = (Math.floor((top + height / 2) * scaleY) + 0.5) / scaleY;
    const left = 4;

    ctx.fillStyle = '#213';
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = '#435';
    ctx.lineWidth = 1 / scaleY;
    ctx.beginPath();
    ctx.moveTo(left, center);
    ctx.lineTo(left + width, center);

    ctx.stroke();
  };

  const drawWaveform = ({
    wave,
    top,
    height,
    width,
    color,
    peak = Math.max(1, wave.peak),
    opacity = 0.7,
  }: {
    wave: Waveform;
    top: number;
    height: number;
    width: number;
    color: string;
    peak?: number;
    opacity?: number;
  }) => {
    const center = top + height / 2;
    const left = 4;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / Math.min(scaleX, scaleY);
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    const scale = (height * 0.45) / (peak || 1);
    const count = wave.columns.length / 2;

    ctx.moveTo(left, center - wave.columns[0] * scale);

    for (let column = 0; column < count; column++) {
      const x = left + (column * width) / Math.max(1, count - 1);

      ctx.lineTo(x, center - wave.columns[column * 2 + 1] * scale);
      ctx.lineTo(x, center - wave.columns[column * 2] * scale);
    }

    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const draw = () => {
    if (disposed) return;
    const { width, height } = size;
    const ratio = globalThis.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;

    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    scaleX = pixelWidth / width;
    scaleY = pixelHeight / height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.fillStyle = '#102';
    ctx.fillRect(0, 0, width, height);
    const plotWidth = Math.max(1, width - 8);
    const plotColumns = Math.max(1, Math.round(plotWidth * scaleX));

    if (!selected || selectedColumns !== plotColumns) {
      selected = layers.map((layer) => ({
        ...waveform(
          layer.samples,
          plotColumns * (layer.duration / duration || 0),
        ),
        duration: layer.duration,
      }));

      selectedPeak = Math.max(0, ...selected.map(({ peak }) => peak));
      selectedColumns = plotColumns;
    }

    ctx.font = '11px system-ui';
    ctx.textBaseline = 'alphabetic';
    const plotTop = layered && layers.length ? 22 : 4;
    const selectedHeight = height - plotTop - 4;

    if (layered) {
      layers.slice(0, 3).forEach((_, index) => {
        ctx.fillStyle = layerColor(index);
        ctx.fillText(`Layer ${index + 1}`, 4 + index * 66, 14);
      });

      if (layers.length > 3) {
        ctx.fillStyle = '#ccd';
        ctx.textAlign = 'right';
        ctx.fillText(`+${layers.length - 3}`, width - 4, 14);
        ctx.textAlign = 'left';
      }
    }

    drawPlot({ top: plotTop, height: selectedHeight, width: plotWidth });

    selected.forEach((wave, index) =>
      drawWaveform({
        wave,
        top: plotTop,
        height: selectedHeight,
        width: plotWidth * (wave.duration / duration || 0),
        color: layerColor(index),
        peak: selectedPeak,
        opacity:
          layered &&
          hoveredLayer !== undefined &&
          hoveredLayer < layers.length &&
          index !== hoveredLayer
            ? 0.14
            : 0.7,
      }),
    );
  };

  const observer = new ResizeObserver((entries) => {
    const content = entries?.[0]?.contentRect;

    size = content
      ? {
          width: Math.max(1, content.width),
          height: Math.max(1, content.height),
        }
      : measure();

    draw();
  });

  const onResolutionChange = () => {
    watchResolution();
    draw();
  };

  const watchResolution = () => {
    resolution?.removeEventListener('change', onResolutionChange);
    resolution = globalThis.matchMedia?.(
      `(resolution: ${globalThis.devicePixelRatio || 1}dppx)`,
    );
    resolution?.addEventListener('change', onResolutionChange);
  };

  observer.observe(canvas);
  watchResolution();
  draw();

  const setSelection = ({
    buffers,
    showLayers,
  }: {
    buffers: AudioBuffer[];
    showLayers: boolean;
  }) => {
    if (disposed) return;

    layers = buffers.map((buffer) => ({
      samples: buffer.getChannelData(0),
      duration: buffer.length / buffer.sampleRate,
    }));

    duration = Math.max(0, ...layers.map((layer) => layer.duration));
    layered = showLayers;
    selected = undefined;
    draw();
  };

  return {
    setBuffer(buffer?: AudioBuffer) {
      setSelection({ buffers: buffer ? [buffer] : [], showLayers: false });
    },
    setBuffers(buffers: AudioBuffer[]) {
      setSelection({ buffers, showLayers: true });
    },
    setHoveredLayer(index?: number) {
      if (disposed || hoveredLayer === index) return;

      hoveredLayer = index;
      draw();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      resolution?.removeEventListener('change', onResolutionChange);
    },
  };
};
