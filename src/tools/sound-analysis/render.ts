import {
  renderEffectBuffer,
  type SoundEffect,
} from '../../client/audio/synthesis.ts';

export const sampleRate = 44100;

const renderSamples = (layers: SoundEffect[]) =>
  renderEffectBuffer({
    context: {
      createBuffer(numberOfChannels, length, sampleRate) {
        const channels = Array.from(
          { length: numberOfChannels },
          () => new Float32Array(length),
        );

        return {
          duration: length / sampleRate,
          length,
          numberOfChannels,
          sampleRate,
          getChannelData: (channel) => channels[channel],
          copyFromChannel(destination, channel, offset = 0) {
            destination.set(
              channels[channel].subarray(offset, offset + destination.length),
            );
          },
          copyToChannel(source, channel, offset = 0) {
            channels[channel].set(source.subarray(0, length - offset), offset);
          },
        };
      },
    },
    layers,
  }).getChannelData(0);

/**
 * Give noise layers repeatable samples without changing the gameplay synth.
 */
export const render = (layers: SoundEffect[], seed = 1) => {
  const random = Math.random;
  let state = seed >>> 0;

  Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  try {
    return renderSamples(layers);
  } finally {
    Math.random = random;
  }
};
