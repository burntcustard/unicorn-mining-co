// Minimal Web Audio implementation for the Node gameplay tests.
const audioParam = () => ({
  value: 0,
  events: [],
  setValueAtTime(value, time) {
    this.events.push(['set', value, time]);
    this.value = value;
  },
  linearRampToValueAtTime(value, time) {
    this.events.push(['ramp', value, time]);
    this.value = value;
  },
  setTargetAtTime(value, time, constant) {
    this.events.push(['target', value, time, constant]);
    this.value = value;
  },
  cancelScheduledValues() {},
  cancelAndHoldAtTime() {},
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

  createBiquadFilter() {
    return { frequency: audioParam(), connect(destination) {
      this.destination = destination;
    } };
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
      playbackRate: { ...audioParam(), value: 1 },
      starts: 0,
      stops: 0,
      stopTimes: [],
      set buffer(buffer) {
        this.assignedSamples = buffer.getChannelData(0).slice();
        this.audioBuffer = buffer;
      },
      get buffer() {
        return this.audioBuffer;
      },
      stop(time) {
        this.stops++;
        this.stopTimes.push(time);
      },
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

  createPeriodicWave(real, imaginary) {
    return { real, imaginary };
  }

  createOscillator() {
    const oscillator = {
      setPeriodicWave(wave) {
        this.wave = wave;
      },
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
