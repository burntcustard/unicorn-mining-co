// Minimal Web Audio implementation for the Node gameplay tests.
type TestBufferSource = {
  playbackRate: ReturnType<typeof audioParam>;
  starts: number;
  stops: number;
  stopTimes: number[];
  assignedSamples: Float32Array;
  audioBuffer: ReturnType<TestAudioContext['createBuffer']>;
  buffer: ReturnType<TestAudioContext['createBuffer']>;
  destination: unknown;
  stop: (time?: number) => void;
  connect: (destination: unknown) => void;
  start: () => void;
};

const audioParam = () => ({
  value: 0,
  events: [] as (string | number)[][],
  setValueAtTime(value: number, time: number) {
    this.events.push(['set', value, time]);
    this.value = value;
  },
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push(['ramp', value, time]);
    this.value = value;
  },
  setTargetAtTime(value: number, time: number, constant: number) {
    this.events.push(['target', value, time, constant]);
    this.value = value;
  },
  cancelScheduledValues() {},
  cancelAndHoldAtTime() {},
});

export class TestAudioContext {
  currentTime = 0;
  destination = {};

  static instances: TestAudioContext[] = [];
  sampleRate = 44100;

  sources: TestBufferSource[] = [];
  state = 'running';

  constructor() {
    TestAudioContext.instances.push(this);
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      sampleRate,
      data: new Float32Array(length),
      getChannelData(_channel = 0) {
        return this.data;
      },
    };
  }

  createBufferSource(): TestBufferSource {
    const source = {
      playbackRate: { ...audioParam(), value: 1 },
      starts: 0,
      stops: 0,
      stopTimes: [] as number[],
      assignedSamples: undefined as Float32Array,
      audioBuffer: undefined as ReturnType<TestAudioContext['createBuffer']>,
      destination: undefined as unknown,
      set buffer(buffer: ReturnType<TestAudioContext['createBuffer']>) {
        this.assignedSamples = buffer.getChannelData(0).slice();
        this.audioBuffer = buffer;
      },
      get buffer() {
        return this.audioBuffer;
      },
      stop(time: number) {
        this.stops++;
        this.stopTimes.push(time);
      },
      connect(destination: unknown) {
        this.destination = destination;
      },
      start() {
        this.starts++;
      },
    };

    this.sources.push(source);
    return source;
  }

  createGain() {
    return {
      gain: audioParam(),
      destination: undefined as unknown,
      connect(destination: unknown) {
        this.destination = destination;
      },
    };
  }

  resume() {}
}

Object.assign(globalThis, { AudioContext: TestAudioContext });
