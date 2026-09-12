// Minimal Web Audio implementation for the Node gameplay tests.
const audioParam = () => ({
  value: 0,
  setValueAtTime(value) {
    this.value = value;
  },
  linearRampToValueAtTime(value) {
    this.value = value;
  },
  cancelScheduledValues() {},
});

export class TestAudioContext {
  static instances = [];
  sampleRate = 44100;
  currentTime = 0;
  state = 'running';
  destination = {};
  sources = [];

  constructor() {
    TestAudioContext.instances.push(this);
  }

  resume() {}

  createGain() {
    return {
      gain: audioParam(),
      connect(destination) {
        this.destination = destination;
      },
    };
  }

  createBuffer(channels, length, sampleRate) {
    return {
      sampleRate,
      data: new Float32Array(length),
      getChannelData() {
        return this.data;
      },
    };
  }

  createBufferSource() {
    const source = {
      starts: 0,
      connect(destination) {
        this.destination = destination;
      },
      start() {
        this.starts++;
      },
    };

    this.sources.push(source);
    return source;
  }

  createOscillator() {
    const oscillator = {
      frequency: audioParam(),
      starts: 0,
      stops: 0,
      stopTimes: [],
      connect(destination) {
        this.destination = destination;
      },
      start() {
        this.starts++;
      },
      stop(time) {
        this.stops++;
        this.stopTimes.push(time);
      },
    };

    this.sources.push(oscillator);
    return oscillator;
  }
}

globalThis.AudioContext = TestAudioContext;
