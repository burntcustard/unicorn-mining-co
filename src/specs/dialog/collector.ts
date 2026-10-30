import type { DialogSpec } from './types';

export const collectorDialog = {
  departure: [
    'Heading out to collect a few things. Someone has to tidy up.',
    'Got my list. Time to clear some space.',
    'Another collection round. Back soon!',
  ],
  cargoFull: ["That's all I can carry. Heading home!"],
  finished: ['List finished. Back to the station.'],
  damaged: ["I've lost a piece! Better get back to the station."],
  outsideRadius: ["I've wandered too far. Heading home."],
  stranded: ["I'm stuck out here. This wasn't in the job description."],
  unreachable: ["I can't reach that {item_name}!"],
  unlisted: ["That wasn't on my list. I'll ignore it for now."],
  missingFirst: ["I can't find one of the items on my list. Oh well."],
  missingSecond: ["That's two missing. Someone got here before me."],
  missingThird: ['Three missing now. Is this list out of date?'],
  missingFourth: ["A fourth missing item. There's not much left for me."],
  missingFifth: ["Five missing. I'm beginning to see a pattern."],
  missingSixth: ["Well, this was pointless. I'm heading back."],
} satisfies DialogSpec;
