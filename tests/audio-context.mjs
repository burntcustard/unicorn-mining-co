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
