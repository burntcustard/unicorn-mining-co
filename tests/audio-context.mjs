// Minimal Web Audio implementation for the Node gameplay tests.
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
      gain: {
        value: 0,
        setValueAtTime(value) {
          this.value = value;
        },
        linearRampToValueAtTime(value) {
          this.value = value;
        },
        cancelScheduledValues() {},
      },
      connect(destination) {
        this.destination = destination;
      },
    };
  }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));

    return { length, sampleRate, getChannelData: (channel) => data[channel] };
  }

  createBufferSource() {
    const source = {
      loop: false,
      starts: 0,
      stops: 0,
      stopTimes: [],
      set buffer(buffer) {
        this.assignedBuffer = buffer;
        this.assignedSamples = buffer.getChannelData(0).slice();
      },
      get buffer() {
        return this.assignedBuffer;
      },
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

    this.sources.push(source);
    return source;
  }
}

globalThis.AudioContext = TestAudioContext;
