import './style.css';
import { createSoundVisualizer } from './visualizer';
import {
  renderContinuousBuffer,
  renderEffectBuffer,
  resolveSoundEffect,
  type SoundEffect,
} from '../../client/audio/synthesis';
import { numberControl, type NumberParameter } from '../number-control';
import {
  effectParameters,
  effectChoices,
  engineParameters,
  hornDrillParameters,
  maxLayers,
  compactOptional,
  validateSound,
  soundId,
  type SoundDocument,
  type SoundName,
  type SoundValues,
  type SavedSound,
  type EffectChoiceKey,
  type EffectNumberKey,
} from './parameters';

const endpoint = '/__sound-editor/sounds';
const layerEndpoint = '/__sound-editor/layers';
const select = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const save = select<HTMLButtonElement>('#save');
const resetEvent = select<HTMLButtonElement>('#event-reset');
const status = select<HTMLParagraphElement>('#status');
const event = select<HTMLFieldSetElement>('#event');
const eventPicker = select<HTMLDivElement>('#event-picker');
const eventSearch = select<HTMLInputElement>('#event-search');
const eventEmpty = select<HTMLParagraphElement>('#event-empty');
const kind = select<HTMLFieldSetElement>('#continuous-kind');
const playContinuous = select<HTMLButtonElement>('#continuous-play');
const playEvent = select<HTMLButtonElement>('#event-play');
const addLayer = select<HTMLButtonElement>('#add-layer');
const newEvent = select<HTMLButtonElement>('#new-event');
const eventCreate = select<HTMLFormElement>('#event-create');
const eventName = select<HTMLInputElement>('#event-name');
const layerCreate = select<HTMLFormElement>('#layer-create');
const layerName = select<HTMLInputElement>('#layer-name');
const loadLayer = select<HTMLButtonElement>('#load-layer');
const layerPicker = select<HTMLDivElement>('#layer-picker');
const layerSearch = select<HTMLInputElement>('#layer-search');
const layerOptions = select<HTMLDivElement>('#layer-options');
const layers = select<HTMLDivElement>('#layers');
const continuousParameters = select<HTMLDivElement>('#continuous-parameters');
const biting = select<HTMLInputElement>('#biting');
const previewControls = select<HTMLDivElement>('#engine-preview-controls');
const waveform = select<HTMLCanvasElement>('#sound-visualizer');
const visualizer = createSoundVisualizer({ canvas: waveform });
const voices = new Set<AudioBufferSourceNode>();
let documentData: SoundDocument;
const savedData = new Map<SoundName, string>();

const layerStates = new WeakMap<SoundEffect, { saved?: string }>();

const layerState = (effect: SoundEffect) => {
  let state = layerStates.get(effect);

  if (!state) layerStates.set(effect, (state = {}));
  return state;
};

const pendingSourceChanges = new Set<SoundName>();
const sourceRequests = new Map<SoundName, symbol>();
const savedLayers = new Map<string, string>();
const pendingLayerChanges = new Set<string>();
const layerRequests = new Map<string, symbol>();
const savingLayers = new Set<string>();

const libraryCards = new Map<
  string,
  { card: HTMLElement; save: HTMLButtonElement }
>();

let activeTab: 'continuous' | 'events' = 'events';
let selectedEvent = 'hatchOpen';
let selectedLibrary = '';
let layerToSave: SoundEffect | undefined;
let creatingEvent = false;
let creatingLayer = false;
let searchBound = false;
const listedEvents: ReturnType<typeof radioChoices> = [];
let selectedKind: 'engine' | 'hornDrill' = 'engine';
let saving = false;
let loadingDocument = false;
let audio: AudioContext;
let sampleContext: OfflineAudioContext;

let automaticPreview:
  | { source: AudioBufferSourceNode; gain: GainNode }
  | undefined;

let continuous: { source: AudioBufferSourceNode; gain: GainNode } | undefined;

let playing = false;
let power = 1;
let load = 0;

const currentName = (): SoundName =>
  activeTab === 'continuous' ? selectedKind : selectedEvent;
const librarySelected = () =>
  activeTab === 'events' && selectedEvent === 'unassigned';
const allSounds = () => [
  ...Object.keys(documentData.effectData),
  'engine',
  'hornDrill',
];
const soundValue = (name: SoundName): SoundValues[SoundName] =>
  name === 'engine'
    ? documentData.continuousData.engine
    : name === 'hornDrill'
      ? documentData.continuousData.hornDrill
      : documentData.effectData[name];

const setSoundValue = (name: SoundName, value: SoundValues[SoundName]) => {
  if (name === 'engine') {
    documentData.continuousData.engine = value as SoundValues['engine'];
  } else if (name === 'hornDrill') {
    documentData.continuousData.hornDrill = value as SoundValues['hornDrill'];
  } else {
    documentData.effectData[name] = value as SoundEffect[];
  }
};

const fingerprint = (name: SoundName) => {
  const value = soundValue(name);

  return JSON.stringify(
    Array.isArray(value) ? value.map(compactOptional) : value,
  );
};

const rememberSound = (name: SoundName) => {
  savedData.set(name, fingerprint(name));
  const value = soundValue(name);

  if (Array.isArray(value)) {
    for (const effect of value) {
      layerState(effect).saved = JSON.stringify(compactOptional(effect));
    }
  }
};

const dirty = (name: SoundName) =>
  documentData && fingerprint(name) !== savedData.get(name);
const dirtySounds = () => (documentData ? allSounds().filter(dirty) : []);
const layerFingerprint = (name: string) =>
  JSON.stringify(compactOptional(documentData.unassigned[name]));
const dirtyLayer = (name: string) =>
  layerFingerprint(name) !== savedLayers.get(name);
const dirtyLayers = () =>
  documentData ? Object.keys(documentData.unassigned).filter(dirtyLayer) : [];
const invalid = () =>
  !!select(
    activeTab === 'continuous' ? '#continuous-parameters' : '#layers',
  ).querySelector('[aria-invalid="true"]');

const message = (text: string, error = false) => {
  status.textContent = text;
  status.dataset.error = String(error);
  status.hidden = !text;
};

const updateSave = () => {
  const name = currentName();
  const pending = dirtySounds();
  const otherCount =
    pending.filter((sound) => sound !== name).length + dirtyLayers().length;

  save.hidden = librarySelected();
  save.disabled = librarySelected() || !dirty(name) || saving || invalid();
  resetEvent.hidden = librarySelected() || activeTab !== 'events';
  resetEvent.disabled = !documentData || saving || loadingDocument;
  playEvent.hidden = librarySelected();
  playEvent.disabled = !documentData || !eventLayers().length;
  newEvent.disabled = !documentData || loadingDocument || creatingEvent;
  loadLayer.hidden = librarySelected();
  loadLayer.disabled =
    !documentData ||
    !Object.keys(documentData.unassigned).length ||
    eventLayers().length >= maxLayers;

  for (const [name, { card, save }] of libraryCards) {
    save.disabled =
      !dirtyLayer(name) ||
      savingLayers.has(name) ||
      !!card.querySelector('[aria-invalid="true"]');
  }

  select('#pending-changes').textContent = otherCount
    ? `${otherCount} other ${otherCount === 1 ? 'sound has' : 'sounds have'} unsaved changes.`
    : '';
};

const changed = (audition = false) => {
  updateSave();

  if (librarySelected()) {
    message('');
    updateWaveform();
    return;
  }

  message(dirty(currentName()) ? 'Unsaved changes to this sound.' : '');

  if (
    audition &&
    activeTab === 'events' &&
    eventLayers().length &&
    !invalid()
  ) {
    previewEffect({ automatic: true });
  } else {
    updateWaveform();
  }
};

const eventLayers = () => documentData?.effectData[selectedEvent] || [];
const labelFor = (name: string) =>
  name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase())
    .replace(/\bUi\b/g, 'UI');

const showDuration = (duration: number, name = currentName()) => {
  const milliseconds = Math.round(duration * 1000);
  const caption = `${labelFor(name)}, ${milliseconds} ms`;

  select('#visualizer-caption').textContent = caption;
};

const showBuffer = (buffer: AudioBuffer, name = currentName()) => {
  visualizer.setBuffer(buffer);
  showDuration(buffer.getChannelData(0).length / buffer.sampleRate, name);
};

const showLayerBuffers = (buffers: AudioBuffer[]) => {
  visualizer.setBuffers(buffers);
  showDuration(
    Math.max(
      0,
      ...buffers.map(
        (buffer) => buffer.getChannelData(0).length / buffer.sampleRate,
      ),
    ),
  );
};

const renderEventLayers = (context: Pick<BaseAudioContext, 'createBuffer'>) =>
  eventLayers().map((effect) =>
    renderEffectBuffer({ context, layers: [effect] }),
  );

const detailedLayerLimit = 32;

const updateWaveform = () => {
  if (!documentData) return;

  try {
    if (activeTab === 'continuous' && continuous) {
      showBuffer(continuous.source.buffer!);
      return;
    }

    sampleContext ||= new OfflineAudioContext(1, 1, 44100);

    if (librarySelected()) {
      if (!documentData.unassigned[selectedLibrary]) {
        selectedLibrary = Object.keys(documentData.unassigned)[0] || '';
      }

      const effect = documentData.unassigned[selectedLibrary];

      if (effect) {
        showBuffer(
          renderEffectBuffer({ context: sampleContext, layers: [effect] }),
          selectedLibrary,
        );
      } else {
        visualizer.setBuffer();
        select('#visualizer-caption').textContent = 'Unassigned';
      }
    } else if (activeTab === 'events') {
      if (eventLayers().length > detailedLayerLimit) {
        showBuffer(
          renderEffectBuffer({ context: sampleContext, layers: eventLayers() }),
        );
      } else {
        showLayerBuffers(renderEventLayers(sampleContext));
      }
    } else {
      showBuffer(
        renderContinuousBuffer({
          context: sampleContext,
          kind: selectedKind,
          settings: documentData.continuousData[selectedKind],
        }),
      );
    }
  } catch (error) {
    message(
      `Waveform failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  }
};

const context = () => {
  audio ||= new AudioContext();
  audio.resume();
  return audio;
};

const startSource = ({
  buffer,
  loop = false,
}: {
  buffer: AudioBuffer;
  loop?: boolean;
}) => {
  const source = audio.createBufferSource();

  source.buffer = buffer;
  source.loop = loop;

  source.addEventListener('ended', () => {
    voices.delete(source);
    source.disconnect();
  });

  voices.add(source);
  return source;
};

const previewEffect = ({
  layerIndex,
  libraryLayer,
  automatic = false,
}: {
  layerIndex?: number;
  libraryLayer?: string;
  automatic?: boolean;
} = {}) => {
  try {
    const ctx = context();

    const singleBuffer =
      !!libraryLayer || eventLayers().length > detailedLayerLimit;

    const buffers = singleBuffer
      ? [
          renderEffectBuffer({
            context: ctx,
            layers: libraryLayer
              ? [documentData.unassigned[libraryLayer]]
              : layerIndex === undefined
                ? eventLayers()
                : [eventLayers()[layerIndex]],
          }),
        ]
      : renderEventLayers(ctx);

    let buffer = buffers[singleBuffer ? 0 : (layerIndex ?? 0)];

    if (layerIndex === undefined && !singleBuffer) {
      const length = Math.max(
        1,
        ...buffers.map((buffer) => buffer.getChannelData(0).length),
      );

      buffer = ctx.createBuffer(1, length, 44100);
      const samples = buffer.getChannelData(0);

      for (const layer of buffers) {
        layer.getChannelData(0).forEach((sample, index) => {
          samples[index] += sample;
        });
      }
    }

    const source = startSource({
      buffer,
    });

    if (libraryLayer) {
      selectedLibrary = libraryLayer;
      showBuffer(buffer, libraryLayer);
    } else if (singleBuffer) {
      showBuffer(
        buffer,
        layerIndex === undefined
          ? currentName()
          : `${currentName()} layer ${layerIndex + 1}`,
      );
    } else {
      showLayerBuffers(buffers);
    }

    const destination = ctx.destination;

    if (automatic) {
      if (automaticPreview) {
        const previous = automaticPreview;
        const time = ctx.currentTime;

        previous.gain.gain.cancelScheduledValues(time);
        previous.gain.gain.setValueAtTime(previous.gain.gain.value, time);
        previous.gain.gain.linearRampToValueAtTime(0, time + 0.02);
        previous.source.stop(time + 0.025);
      }

      const gain = ctx.createGain();

      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(destination);
      automaticPreview = { source, gain };

      source.addEventListener('ended', () => {
        gain.disconnect();

        if (automaticPreview?.source === source) automaticPreview = undefined;
      });
    } else {
      source.connect(destination);
    }

    source.start();
  } catch (error) {
    message(
      `Preview failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  }
};

const fadeContinuous = (duration = 0.03) => {
  if (!continuous) return;
  const { source, gain } = continuous;
  const time = audio.currentTime;

  gain.gain.cancelScheduledValues(time);
  gain.gain.setValueAtTime(gain.gain.value, time);
  gain.gain.setTargetAtTime(0, time + 0.01, duration / 5);
  source.stop(time + duration + 0.01);
  continuous = undefined;
};

const updateContinuous = (rebuild = false) => {
  if (!playing) return;

  try {
    const ctx = context();
    const engine = selectedKind === 'engine';
    const settings = engine
      ? documentData.continuousData.engine
      : documentData.continuousData.hornDrill;

    if (rebuild) fadeContinuous();

    if (!continuous) {
      const source = startSource({
        buffer: renderContinuousBuffer({
          context: ctx,
          kind: engine ? 'engine' : 'hornDrill',
          settings,
        }),
        loop: true,
      });

      const gain = ctx.createGain();

      gain.gain.value = 0;
      source.playbackRate.value = settings.basePitch;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.addEventListener('ended', () => gain.disconnect());
      continuous = { source, gain };
      showBuffer(source.buffer!);
      source.start();
    }

    const engineSettings = documentData.continuousData.engine;
    const drillSettings = documentData.continuousData.hornDrill;
    const revs = load * engineSettings.revRange;
    const level = engine
      ? power * (engineSettings.idleVolume + revs) * engineSettings.volume
      : biting.checked
        ? drillSettings.bitingVolume
        : drillSettings.activeVolume;
    const pitch = engine
      ? engineSettings.basePitch + revs
      : biting.checked
        ? drillSettings.bitingPitch
        : drillSettings.activePitch;
    const time = ctx.currentTime + 0.01;

    continuous.gain.gain.setTargetAtTime(level, time, settings.ramp / 5000);
    continuous.source.playbackRate.setTargetAtTime(
      pitch,
      time,
      settings.ramp / 5000,
    );
  } catch (error) {
    playing = false;
    fadeContinuous();
    updatePlayButton();
    message(
      `Preview failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  }
};

const updatePlayButton = () => {
  playContinuous.textContent = playing
    ? 'Stop continuous preview'
    : 'Start continuous preview';
  playContinuous.setAttribute('aria-pressed', String(playing));
};

const stopAll = () => {
  playing = false;
  continuous = undefined;
  automaticPreview = undefined;

  for (const source of voices) {
    source.stop();
    source.disconnect();
  }

  voices.clear();
  updatePlayButton();
};

const parameters = <T extends object, K extends keyof T>({
  container,
  settings,
  definitions,
  change,
  audition = false,
  notify,
}: {
  container: HTMLElement;
  settings: T;
  definitions: Record<K, NumberParameter>;
  change: (key: K) => void;
  audition?: boolean;
  notify?: () => void;
}) => {
  const controls = {} as Record<K, ReturnType<typeof numberControl>>;

  for (const key of Object.keys(definitions) as K[]) {
    const control = numberControl({
      parameter: definitions[key],
      value: settings[key] as number,
      change: (value) => {
        settings[key] = value as T[K];
        change(key);

        if (notify) {
          notify();
        } else {
          changed(audition);
        }
      },
    });

    controls[key] = control;
    container.append(control.element);
  }

  return controls;
};

const renderContinuous = () => {
  const engine = selectedKind === 'engine';

  continuousParameters.replaceChildren();
  select('#engine-preview').hidden = !engine;
  select('#drill-preview').hidden = engine;

  if (engine) {
    parameters({
      container: continuousParameters,
      settings: documentData.continuousData.engine,
      definitions: engineParameters,
      change: () => updateContinuous(true),
    });
  } else {
    parameters({
      container: continuousParameters,
      settings: documentData.continuousData.hornDrill,
      definitions: hornDrillParameters,
      change: () => updateContinuous(true),
    });
  }

  updateContinuous(true);
  updateSave();
};

const layerParameters = ({
  read,
  write,
  notify,
}: {
  read: () => SoundEffect;
  write: (effect: SoundEffect) => void;
  notify: () => void;
}) => {
  const controls = document.createElement('div');

  controls.className = 'sound-parameters flex flex-col mt-4';

  const settings = resolveSoundEffect(read());
  const duration = () =>
    settings.attack + settings.decay + settings.hold + settings.release;

  const followsEnvelope = {
    pitchDuration: Math.abs(settings.pitchDuration - duration()) <= 1e-9,
    filterDuration: Math.abs(settings.filterDuration - duration()) <= 1e-9,
  };

  const choiceControls = {} as Record<EffectChoiceKey, HTMLLabelElement>;

  const updateVisibility = () => {
    const hidden = (key: EffectNumberKey, hide: boolean) => {
      const control = parameterControls[key];

      control.element.hidden = hide;

      if (hide) control.setValue(settings[key]);
    };

    hidden('pulseWidth', settings.waveform !== 'pulse');
    hidden(
      'phaseOffset',
      settings.waveform === 'noise' || settings.waveform === 'crackle',
    );
    hidden(
      'noiseSeed',
      settings.waveform !== 'noise' && settings.waveform !== 'crackle',
    );
    hidden(
      'fmRatio',
      settings.waveform !== 'sine' || !!settings.partials.length,
    );
    hidden(
      'fmDepth',
      settings.waveform !== 'sine' || !!settings.partials.length,
    );
    hidden('partialRatio', settings.waveform !== 'sine');

    for (const key of ['frequency', 'endFrequency', 'pitchDuration'] as const) {
      hidden(key, settings.waveform === 'noise');
    }

    choiceControls.pitchCurve.hidden = settings.waveform === 'noise';
  };

  const parameterControls = parameters({
    container: controls,
    settings,
    definitions: effectParameters,
    notify,
    change: (key) => {
      if (key === 'pitchDuration' || key === 'filterDuration') {
        followsEnvelope[key] = Math.abs(settings[key] - duration()) <= 1e-9;
      }

      for (const [start, end] of [
        ['frequency', 'endFrequency'],
        ['cutoff', 'endCutoff'],
        ['highpass', 'endHighpass'],
        ['resonance', 'endResonance'],
      ] as const) {
        if (key === start && read()[end] === undefined) {
          settings[end] = settings[start];
          parameterControls[end].setValue(settings[end]);
        }
      }

      if (['attack', 'decay', 'hold', 'release'].includes(key)) {
        for (const key of ['pitchDuration', 'filterDuration'] as const) {
          if (followsEnvelope[key]) {
            settings[key] = duration();
            parameterControls[key].setValue(settings[key]);
          }
        }
      }

      write(compactOptional(settings));
    },
  });

  for (const key of Object.keys(effectChoices) as EffectChoiceKey[]) {
    const { label: text, options } = effectChoices[key];
    const row = document.createElement('label');
    const label = document.createElement('span');
    const choice = document.createElement('select');

    row.className = 'number-control';
    label.textContent = text;

    for (const value of options) {
      const option = document.createElement('option');

      option.value = value;
      option.textContent = labelFor(value.replaceAll('-', ' '));
      choice.append(option);
    }

    choice.value = settings[key];

    choice.addEventListener('change', () => {
      if (!options.includes(choice.value)) return;
      Object.assign(settings, { [key]: choice.value });
      write(compactOptional(settings));
      updateVisibility();
      notify();
    });

    row.append(label, choice);
    choiceControls[key] = row;
  }

  const order: (EffectNumberKey | EffectChoiceKey)[] = [
    'waveform',
    'noiseSeed',
    'phaseOffset',
    'volume',
    'delay',
    'pulseWidth',
    'frequency',
    'endFrequency',
    'pitchDuration',
    'pitchCurve',
    'modulationRate',
    'modulationDepth',
    'fmRatio',
    'fmDepth',
    'partialRatio',
    'attack',
    'attackCurve',
    'decay',
    'decayCurve',
    'sustain',
    'hold',
    'release',
    'releaseCurve',
    'cutoff',
    'lowpassOrder',
    'endCutoff',
    'highpass',
    'endHighpass',
    'filterDuration',
    'filterCurve',
    'resonance',
    'endResonance',
    'ring',
  ];

  controls.replaceChildren(
    ...order.map((key) =>
      key in choiceControls
        ? choiceControls[key as EffectChoiceKey]
        : parameterControls[key as EffectNumberKey].element,
    ),
  );

  for (const key of [
    'gainPoints',
    'gainPositions',
    'resonancePoints',
    'pitchPoints',
    'partials',
  ] as const) {
    const row = document.createElement('label');
    const label = document.createElement('span');
    const input = document.createElement('input');

    row.className = 'number-control';
    label.textContent =
      key === 'gainPoints'
        ? 'Gain points'
        : key === 'gainPositions'
          ? 'Gain positions'
          : key === 'pitchPoints'
            ? 'Pitch points (Hz)'
            : key === 'partials'
              ? 'Partial levels (sine)'
              : 'Resonance points (Hz)';
    input.type = 'text';
    input.title =
      key === 'gainPoints'
        ? '2–32 gains from 0 to 1. Empty uses the envelope alone.'
        : key === 'resonancePoints'
          ? '2–32 integer frequencies, equally spaced across Filter duration. Overrides Resonance and End resonance. Empty uses the normal filter sweep.'
          : key === 'pitchPoints'
            ? '2–32 integer frequencies, equally spaced across Pitch duration. Overrides Frequency and End frequency. Empty uses the normal pitch sweep.'
            : key === 'partials'
              ? '1–32 relative levels from 0 to 1. The middle partial uses Frequency; neighbors are separated by Frequency × Partial spacing ratio. Replaces sine FM. Empty uses the normal waveform.'
              : 'Optional positions for each gain: strictly increasing from 0 to 1 across the layer. Empty uses equal spacing.';
    input.value = settings[key].join(', ');

    input.addEventListener('input', () => {
      const text = input.value.trim();
      const points = text
        ? text
            .split(',')
            .map((part) => (part.trim() ? Number(part.trim()) : NaN))
        : [];
      const candidate = { ...settings, [key]: points };

      try {
        validateSound('sound', [candidate]);
        input.setAttribute('aria-invalid', 'false');
        input.setCustomValidity('');
        settings[key] = points;
        write(compactOptional(settings));
        updateVisibility();
        notify();
      } catch (error) {
        input.setAttribute('aria-invalid', 'true');
        input.setCustomValidity((error as Error).message);
        updateSave();
      }
    });

    row.append(label, input);
    controls.append(row);
  }

  updateVisibility();
  return controls;
};

const renderLayers = () => {
  visualizer.setHoveredLayer();
  layers.replaceChildren();
  libraryCards.clear();
  const effects = eventLayers();

  select('#events-heading').textContent = labelFor(selectedEvent);
  addLayer.textContent = librarySelected() ? 'New layer' : 'Add layer';
  addLayer.disabled = !librarySelected() && effects.length >= maxLayers;

  if (librarySelected()) {
    renderLibrary();
    updateSave();
    return;
  }

  effects.forEach((effect, index) => {
    const card = document.createElement('article');
    const header = document.createElement('div');
    const title = document.createElement('h3');
    const state = layerState(effect);

    const createControls = () =>
      layerParameters({
        read: () => effects[index],
        write: (effect) => {
          layerStates.set(effect, state);
          effects[index] = effect;
        },
        notify: () => changed(true),
      });

    let controls =
      effects.length > detailedLayerLimit ? undefined : createControls();

    card.className = 'sound-layer';
    card.addEventListener('mouseenter', () =>
      visualizer.setHoveredLayer(index),
    );
    card.addEventListener('mouseleave', () => visualizer.setHoveredLayer());
    header.className =
      'layer-header compact-controls flex flex-wrap items-center';
    title.className = 'text-sm mr-auto leading-tight';
    title.textContent = `Layer ${index + 1}`;
    header.append(title);

    if (effects.length > detailedLayerLimit) {
      const edit = document.createElement('button');

      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.title = `Edit layer ${index + 1}`;
      edit.setAttribute('aria-expanded', 'false');

      edit.addEventListener('click', () => {
        if (!controls) {
          controls = createControls();
          card.append(controls);
        } else {
          controls.hidden = !controls.hidden;
        }

        edit.textContent = controls.hidden ? 'Edit' : 'Hide';
        edit.setAttribute('aria-expanded', String(!controls.hidden));
      });

      header.append(edit);
    }

    for (const [text, action] of [
      ['Play layer', () => previewEffect({ layerIndex: index })],
      [
        'Save layer',
        () => {
          if (!card.querySelector('[aria-invalid="true"]')) {
            beginLayerSave(effects[index]);
          }
        },
      ],
      [
        'Reset',
        () => {
          if (state.saved === undefined) {
            effects.splice(index, 1);
            renderLayers();
          } else {
            const restored: SoundEffect = JSON.parse(state.saved);

            layerStates.set(restored, state);
            effects[index] = restored;

            if (controls) {
              const replacement = createControls();

              replacement.hidden = controls.hidden;
              controls.replaceWith(replacement);
              controls = replacement;
            }
          }

          changed();
        },
      ],
      [
        'Duplicate',
        () => {
          effects.splice(index + 1, 0, { ...effects[index] });
          renderLayers();
          changed();
        },
      ],
      [
        'Remove',
        () => {
          effects.splice(index, 1);
          renderLayers();
          changed();
        },
      ],
    ] as const) {
      const button = document.createElement('button');

      button.type = 'button';
      button.textContent = text === 'Play layer' ? '▶︎' : text;
      button.disabled = text === 'Duplicate' && effects.length >= maxLayers;

      if (text === 'Play layer') button.title = `Play layer ${index + 1}`;

      if (text === 'Reset') {
        button.title = 'Discard unsaved changes to this layer';
      }

      button.addEventListener('click', action);
      header.append(button);
    }

    card.append(header);

    if (controls) card.append(controls);
    layers.append(card);
  });

  updateSave();
};

const renderLibraryLayer = (name: string) => {
  const card = document.createElement('article');
  const header = document.createElement('div');
  const title = document.createElement('h3');
  const save = document.createElement('button');
  const play = document.createElement('button');
  const reset = document.createElement('button');
  const add = document.createElement('button');
  const label = labelFor(name);

  card.className = 'sound-layer';
  header.className =
    'layer-header compact-controls flex flex-wrap items-center';
  title.className = 'text-sm mr-auto leading-tight';
  title.textContent = label;
  save.type = play.type = add.type = reset.type = 'button';
  save.textContent = 'Save';
  play.textContent = '▶︎';
  add.textContent = 'Add to event';
  reset.textContent = 'Reset';
  reset.title = 'Discard unsaved changes to this layer';
  play.title = `Play saved layer ${label}`;
  play.addEventListener('click', () => previewEffect({ libraryLayer: name }));
  save.addEventListener('click', () => saveLibraryLayer(name));

  reset.addEventListener('click', () => {
    documentData.unassigned[name] = JSON.parse(savedLayers.get(name)!);
    card.replaceWith(renderLibraryLayer(name));
    changed();
  });

  add.addEventListener('click', () => {
    if (!card.querySelector('[aria-invalid="true"]')) {
      openLayerPicker(documentData.unassigned[name]);
    }
  });

  header.append(title, play, save, reset, add);
  libraryCards.set(name, { card, save });

  card.append(
    header,
    layerParameters({
      read: () => documentData.unassigned[name],
      write: (effect) => (documentData.unassigned[name] = effect),
      notify: () => {
        selectedLibrary = name;
        updateSave();
        message(`Unsaved changes to ${label}.`);

        if (!card.querySelector('[aria-invalid="true"]')) {
          previewEffect({ libraryLayer: name, automatic: true });
        }
      },
    }),
  );

  return card;
};

const renderLibrary = () => {
  for (const name of Object.keys(documentData.unassigned)) {
    layers.append(renderLibraryLayer(name));
  }
};

const closeAuthoring = () => {
  layerCreate.hidden = eventCreate.hidden = layerPicker.hidden = true;
};

const beginLayerSave = (effect: SoundEffect) => {
  closeAuthoring();
  layerToSave = compactOptional(effect);
  layerName.value = '';
  layerCreate.hidden = false;
  layerName.focus();
};

let pickerLayer: SoundEffect | undefined;

const renderLayerPicker = () => {
  layerOptions.replaceChildren();
  const query = layerSearch.value
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/g, '');
  const names = Object.keys(
    pickerLayer ? documentData.effectData : documentData.unassigned,
  );

  for (const name of names) {
    if (
      ![labelFor(name), name, soundId(name)].some((text) =>
        text
          .toLocaleLowerCase('en-US')
          .replace(/[\s_-]+/g, '')
          .includes(query),
      )
    ) {
      continue;
    }

    const button = document.createElement('button');
    const item = document.createElement('div');
    const label = labelFor(name);

    button.className = 'sound-option';
    button.type = 'button';
    button.textContent = label;
    item.setAttribute('role', 'listitem');
    button.disabled =
      (pickerLayer ? documentData.effectData[name] : eventLayers()).length >=
      maxLayers;

    button.addEventListener('click', () => {
      const effect = pickerLayer || documentData.unassigned[name];
      const target = pickerLayer ? name : selectedEvent;

      if (
        !effect ||
        !documentData.effectData[target] ||
        documentData.effectData[target].length >= maxLayers
      ) {
        return;
      }

      documentData.effectData[target].push({ ...effect });
      eventSearch.value = '';
      rebuildEventChoices();
      selectEvent(target);
    });

    item.append(button);
    layerOptions.append(item);
  }
};

const openLayerPicker = (effect?: SoundEffect) => {
  closeAuthoring();
  pickerLayer = effect ? compactOptional(effect) : undefined;
  layerSearch.value = '';
  layerSearch.placeholder = effect
    ? 'Search sound events'
    : 'Search saved layers';
  layerPicker.hidden = false;
  renderLayerPicker();
  layerSearch.focus();
};

const readDocument = async <T>(response: Response): Promise<T> => {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
};

const renderSelected = () => {
  if (activeTab === 'continuous') {
    renderContinuous();
  } else {
    renderLayers();
  }

  updateWaveform();
};

const radioChoices = ({
  container,
  names,
  group,
  selected,
  change,
}: {
  container: HTMLFieldSetElement;
  names: readonly SoundName[];
  group: string;
  selected: SoundName;
  change: (name: SoundName) => void;
}) => {
  return names.map((name) => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    const text = document.createElement('span');

    label.className =
      group === 'sound-event' ? 'sound-choice sound-option' : 'sound-choice';
    radio.type = 'radio';
    radio.name = group;
    radio.value = name;
    radio.checked = name === selected;
    text.textContent = labelFor(name);

    if (group === 'sound-event') {
      label.addEventListener('click', (event) => {
        if (container.disabled) return;

        if (event.target !== radio) event.preventDefault();
        radio.focus();
        change(name);
      });
    } else {
      radio.addEventListener('change', () => {
        if (radio.checked) change(name);
      });
    }

    label.append(radio, text);
    container.append(label);
    return { name, label, radio, select: () => change(name) };
  });
};

const bindEventSearch = (choices: ReturnType<typeof radioChoices>) => {
  const normalize = (text: string) =>
    text.toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '');
  const visible = () => choices.filter(({ label }) => !label.hidden);

  const filter = () => {
    const query = normalize(eventSearch.value);

    for (const choice of choices) {
      choice.label.hidden = ![
        labelFor(choice.name),
        choice.name,
        soundId(choice.name),
      ].some((name) => normalize(name).includes(query));
    }

    eventEmpty.hidden = visible().length > 0;
  };

  const activate = (choice: (typeof choices)[number] | undefined) => {
    if (!choice || event.disabled) return;

    for (const entry of choices) entry.radio.checked = entry === choice;
    choice.radio.focus();
    choice.label.scrollIntoView({ block: 'nearest' });
    choice.select();
  };

  if (!searchBound) {
    searchBound = true;
    eventSearch.addEventListener('input', filter);

    eventSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        eventSearch.value = '';
        filter();
        return;
      }

      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      const options = visible();
      const checked = options.find(({ radio }) => radio.checked);

      activate(
        checked || (event.key === 'ArrowUp' ? options.at(-1) : options[0]),
      );
    });
  }

  for (const choice of choices) {
    choice.radio.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.preventDefault();

        if (!choice.radio.disabled) changed(true);
        return;
      }

      const options = visible();
      const index = options.indexOf(choice);
      const next = ['ArrowDown', 'ArrowRight'].includes(event.key)
        ? (index + 1) % options.length
        : ['ArrowUp', 'ArrowLeft'].includes(event.key)
          ? (index + options.length - 1) % options.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? options.length - 1
              : undefined;

      if (next === undefined) return;
      event.preventDefault();
      activate(options[next]);
    });
  }

  filter();
};

const rebuildEventChoices = () => {
  event.replaceChildren();

  listedEvents.splice(
    0,
    listedEvents.length,
    ...radioChoices({
      container: event,
      names: ['unassigned', ...Object.keys(documentData.effectData)],
      group: 'sound-event',
      selected: selectedEvent,
      change: selectEvent,
    }),
  );

  bindEventSearch(listedEvents);
};

const selectEvent = (name: string) => {
  selectedEvent = name;
  closeAuthoring();

  for (const entry of listedEvents) entry.radio.checked = entry.name === name;
  renderLayers();
  changed(true);
};

const refreshSound = async (name: SoundName) => {
  const request = Symbol();

  sourceRequests.set(name, request);

  try {
    const result = await readDocument<SavedSound>(
      await fetch(`${endpoint}/${soundId(name)}`),
    );

    if (sourceRequests.get(name) !== request) return;

    if (saving || loadingDocument) {
      pendingSourceChanges.add(name);
      return;
    }

    // A notification from our own save must not discard edits made afterward.
    if (result.revision === documentData.revisions[name]) return;

    const discovered =
      name !== 'engine' &&
      name !== 'hornDrill' &&
      !Object.hasOwn(documentData.effectData, name);

    setSoundValue(name, result.data);
    documentData.revisions[name] = result.revision;
    rememberSound(name);

    if (discovered) rebuildEventChoices();

    if (currentName() === name) {
      if (activeTab === 'events') stopAll();
      renderSelected();

      if (
        activeTab === 'events' &&
        audio?.state === 'running' &&
        eventLayers().length
      ) {
        previewEffect({ automatic: true });
      }
    }

    updateSave();
    message(`${labelFor(name)} updated from its sound file.`);
  } catch (error) {
    if (sourceRequests.get(name) !== request) return;
    message(
      `Could not refresh ${labelFor(name)}: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  } finally {
    if (sourceRequests.get(name) === request) sourceRequests.delete(name);
  }
};

type SavedLayer = { data: SoundEffect; revision: string };

const refreshLayer = async (name: string) => {
  if (loadingDocument || savingLayers.has(name)) {
    pendingLayerChanges.add(name);
    return;
  }

  const request = Symbol();

  layerRequests.set(name, request);

  try {
    const result = await readDocument<SavedLayer>(
      await fetch(`${layerEndpoint}/${soundId(name)}`),
    );

    if (layerRequests.get(name) !== request) return;

    if (loadingDocument || savingLayers.has(name)) {
      pendingLayerChanges.add(name);
      return;
    }

    if (result.revision === documentData.layerRevisions[name]) return;
    documentData.unassigned[name] = result.data;
    documentData.layerRevisions[name] = result.revision;
    savedLayers.set(name, layerFingerprint(name));

    if (librarySelected()) {
      if (selectedLibrary === name) stopAll();
      const previous = libraryCards.get(name)?.card;
      const card = renderLibraryLayer(name);

      if (previous) {
        previous.replaceWith(card);
      } else {
        layers.append(card);
      }

      updateWaveform();

      if (selectedLibrary === name && audio?.state === 'running') {
        previewEffect({ libraryLayer: name, automatic: true });
      }
    }

    if (!layerPicker.hidden) renderLayerPicker();
    updateSave();
    message(`${labelFor(name)} updated from its layer file.`);
  } catch (error) {
    if (layerRequests.get(name) === request) {
      message(
        `Could not refresh ${labelFor(name)}: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        true,
      );
    }
  } finally {
    if (layerRequests.get(name) === request) layerRequests.delete(name);
  }
};

const saveLibraryLayer = async (name: string) => {
  const entry = libraryCards.get(name);

  if (
    !entry ||
    savingLayers.has(name) ||
    entry.card.querySelector('[aria-invalid="true"]')
  ) {
    return;
  }

  const snapshot = layerFingerprint(name);

  if (layerRequests.delete(name)) pendingLayerChanges.add(name);
  savingLayers.add(name);
  updateSave();

  try {
    const response = await fetch(`${layerEndpoint}/${soundId(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: JSON.parse(snapshot),
        revision: documentData.layerRevisions[name],
      }),
    });

    if (response.status === 409) pendingLayerChanges.add(name);
    const result = await readDocument<SavedLayer>(response);

    documentData.layerRevisions[name] = result.revision;
    savedLayers.set(name, snapshot);
    message(
      `${labelFor(name)} saved.${dirtyLayer(name) ? ' Newer edits are still unsaved.' : ''}`,
    );
  } catch (error) {
    message(
      `Save failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  } finally {
    savingLayers.delete(name);
    updateSave();
    await flushSourceChanges();
  }
};

const flushSourceChanges = async () => {
  if (saving || loadingDocument) return;
  const updates = [...pendingSourceChanges];
  const layerUpdates = [...pendingLayerChanges];

  pendingSourceChanges.clear();
  pendingLayerChanges.clear();

  if (documentData) {
    await Promise.all(updates.map((name) => refreshSound(name)));
    await Promise.all(layerUpdates.map((name) => refreshLayer(name)));
  } else if (updates.length || layerUpdates.length) {
    await loadDocument();
  }
};

const loadDocument = async () => {
  loadingDocument = true;
  pendingSourceChanges.clear();
  pendingLayerChanges.clear();

  try {
    documentData = await readDocument<SoundDocument>(await fetch(endpoint));

    for (const name of allSounds()) rememberSound(name);

    for (const name of Object.keys(documentData.unassigned)) {
      savedLayers.set(name, layerFingerprint(name));
    }

    rebuildEventChoices();
    kind.replaceChildren();

    radioChoices({
      container: kind,
      names: ['engine', 'hornDrill'],
      group: 'continuous-sound',
      selected: selectedKind,
      change: (name) => {
        selectedKind = name as typeof selectedKind;
        renderContinuous();
        changed();
      },
    });

    renderContinuous();
    renderLayers();
    playContinuous.disabled = playEvent.disabled = false;
    event.disabled = kind.disabled = false;
    eventSearch.disabled = false;
    updateSave();
    updateWaveform();
    message('');
  } catch (error) {
    message(
      `Could not load sounds: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  } finally {
    loadingDocument = false;

    if (documentData) updateSave();
    await flushSourceChanges();
  }
};

resetEvent.addEventListener('click', () => {
  if (
    !documentData ||
    librarySelected() ||
    activeTab !== 'events' ||
    saving ||
    loadingDocument
  ) {
    return;
  }

  const snapshot = savedData.get(selectedEvent);

  if (!snapshot) return;
  stopAll();
  closeAuthoring();
  setSoundValue(selectedEvent, JSON.parse(snapshot));
  rememberSound(selectedEvent);
  renderSelected();
  changed();
});

save.addEventListener('click', async () => {
  if (!documentData || librarySelected() || saving || invalid()) return;
  const name = currentName();
  const snapshot = fingerprint(name);
  const value = soundValue(name);
  const states = Array.isArray(value) ? value.map(layerState) : [];

  const payload = {
    data: JSON.parse(snapshot),
    revision: documentData.revisions[name],
  };

  if (sourceRequests.delete(name)) pendingSourceChanges.add(name);
  saving = true;
  updateSave();
  message(`Saving ${labelFor(name)}…`);

  try {
    const response = await fetch(`${endpoint}/${soundId(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.status === 409) pendingSourceChanges.add(name);
    const result = await readDocument<SavedSound>(response);

    documentData.revisions[name] = result.revision;
    savedData.set(name, snapshot);

    states.forEach((state, index) => {
      state.saved = JSON.stringify(payload.data[index]);
    });

    message(
      dirty(name)
        ? `${labelFor(name)} saved. Newer edits to it are still unsaved.`
        : `${labelFor(name)} saved.`,
    );
  } catch (error) {
    message(
      `Save failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  } finally {
    saving = false;
    updateSave();

    await flushSourceChanges();
  }
});

newEvent.addEventListener('click', () => {
  closeAuthoring();
  eventName.value = '';
  eventCreate.hidden = false;
  eventName.focus();
});

select('#event-create-cancel').addEventListener(
  'click',
  () => (eventCreate.hidden = true),
);
select('#layer-create-cancel').addEventListener(
  'click',
  () => (layerCreate.hidden = true),
);

eventCreate.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (creatingEvent || !documentData) return;
  creatingEvent = true;
  select<HTMLButtonElement>('#event-create-submit').disabled = true;
  updateSave();

  try {
    const result = await readDocument<SavedSound & { name: string }>(
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: eventName.value, data: [] }),
      }),
    );

    if (!Object.hasOwn(documentData.effectData, result.name)) {
      setSoundValue(result.name, result.data);
      documentData.revisions[result.name] = result.revision;
      rememberSound(result.name);
    }

    eventSearch.value = '';
    rebuildEventChoices();

    if (activeTab === 'events' && selectedEvent === result.name) {
      closeAuthoring();
      updateSave();
    } else {
      selectEvent(result.name);
    }

    message(`${labelFor(result.name)} created.`);
    pendingSourceChanges.add(result.name);
  } catch (error) {
    message(
      `Could not create event: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  } finally {
    creatingEvent = false;
    select<HTMLButtonElement>('#event-create-submit').disabled = false;
    updateSave();
    await flushSourceChanges();
  }
});

layerCreate.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (creatingLayer || !documentData || !layerToSave) return;
  const data = layerToSave;

  creatingLayer = true;
  select<HTMLButtonElement>('#layer-create-submit').disabled = true;

  try {
    const result = await readDocument<SavedLayer & { name: string }>(
      await fetch(layerEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: layerName.value, data }),
      }),
    );

    if (!Object.hasOwn(documentData.unassigned, result.name)) {
      documentData.unassigned[result.name] = result.data;
      documentData.layerRevisions[result.name] = result.revision;
      savedLayers.set(result.name, layerFingerprint(result.name));
    }

    if (layerToSave === data) layerCreate.hidden = true;

    if (librarySelected()) {
      selectedLibrary = result.name;

      if (!libraryCards.has(result.name)) {
        layers.append(renderLibraryLayer(result.name));
      }

      updateWaveform();
    }

    updateSave();
    message(`${labelFor(result.name)} saved to Unassigned.`);
    pendingLayerChanges.add(result.name);
  } catch (error) {
    message(
      `Could not save layer: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      true,
    );
  } finally {
    creatingLayer = false;
    select<HTMLButtonElement>('#layer-create-submit').disabled = false;
    await flushSourceChanges();
  }
});

loadLayer.addEventListener('click', () => openLayerPicker());
layerSearch.addEventListener('input', renderLayerPicker);

layerSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    layerPicker.hidden = true;
  }
});

biting.addEventListener('change', () => updateContinuous());
playEvent.addEventListener('click', () => previewEffect());

playContinuous.addEventListener('click', () => {
  playing = !playing;

  if (playing) {
    updateContinuous();
  } else {
    fadeContinuous(
      selectedKind === 'engine'
        ? documentData.continuousData.engine.ramp / 1000
        : documentData.continuousData.hornDrill.ramp / 1000,
    );
  }

  updatePlayButton();
});

addLayer.addEventListener('click', () => {
  const effect = { volume: 0.2, frequency: 440, attack: 10, decay: 200 };

  if (librarySelected()) return beginLayerSave(effect);

  if (eventLayers().length >= maxLayers) return;
  eventLayers().push(effect);
  renderLayers();
  changed();
});

const tabs = [
  select<HTMLButtonElement>('#events-tab'),
  select<HTMLButtonElement>('#continuous-tab'),
];

const selectTab = (index: number) => {
  const nextTab = index === 0 ? 'events' : 'continuous';

  if (nextTab === activeTab) return;
  stopAll();
  closeAuthoring();
  activeTab = nextTab;
  select(
    nextTab === 'events' ? '#event-actions' : '#continuous-actions',
  ).append(save, resetEvent);
  eventPicker.hidden = nextTab !== 'events';
  select('main').scrollTop = 0;

  tabs.forEach((tab, tabIndex) => {
    const selected = tabIndex === index;

    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    select(tabIndex === 0 ? '#events' : '#continuous').hidden = !selected;
    (tabIndex === 0 ? event : kind).hidden = !selected;
  });

  if (documentData) {
    renderSelected();
    changed();
  }
};

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));

  tab.addEventListener('keydown', (event) => {
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined;

    if (next === undefined) return;
    event.preventDefault();
    selectTab(next);
    tabs[next].focus();
  });
});

document.addEventListener('input', updateSave);

window.addEventListener('beforeunload', (event) => {
  stopAll();

  if (dirtySounds().length || dirtyLayers().length) event.preventDefault();
});

window.addEventListener('pagehide', stopAll);

import.meta.hot?.dispose(() => {
  stopAll();
  visualizer.dispose();
});

import.meta.hot?.on(
  'sound-editor:updated',
  ({ name, kind }: { name: SoundName; kind?: string }) => {
    if (kind === 'layer') {
      if (!documentData || loadingDocument || savingLayers.has(name)) {
        pendingLayerChanges.add(name);

        if (!documentData && !loadingDocument) return loadDocument();
        return;
      }

      return refreshLayer(name);
    }

    if (!documentData || loadingDocument || saving) {
      pendingSourceChanges.add(name);

      if (!documentData && !loadingDocument) return loadDocument();
      return;
    }

    return refreshSound(name);
  },
);

for (const [label, initial, change] of [
  [
    'Power',
    power,
    (value: number) => {
      power = value;
    },
  ],
  [
    'Load',
    load,
    (value: number) => {
      load = value;
    },
  ],
] as const) {
  previewControls.append(
    numberControl({
      parameter: { label, min: 0, max: 1, step: 0.01 },
      value: initial,
      change: (value) => {
        change(value);
        updateContinuous();
      },
    }).element,
  );
}

await loadDocument();
