import type { DialogSpec } from './types';

export const pirateDialog = {
  cargoDemand: ["Give me all your cargo or I'll open fire."],
  countdown: ['{seconds}'],
  countdownEnd: ['...'],
  attack: [
    "Looks like I'm taking those items by force",
    "I'll be taking your cargo by force then",
  ],
  taunt: ['Come back here!', "I'm going to get you!", "You can't run from me!"],
  surrender: ['A wise decision.'],
  lateSurrender: ['Changed your mind? Excellent.'],
  brokenTruce: ["So you've changed your mind and want to fight?"],
  defendLoot: ['This loot is mine!'],
  search: ['I heard reports of mining in this area...'],
  searchExpired: ['I guess they left'],
  escaped: ["You've gotten away this time {player}"],
  stranded: ['Oh no'],
  destroyed: ['AHH!'],
} satisfies DialogSpec;
