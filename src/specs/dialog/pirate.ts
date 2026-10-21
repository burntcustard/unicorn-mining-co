import type { DialogSpec } from './types';

export const pirateDialog = {
  cargoDemand: ["Give me all your cargo or I'll open fire."],
  cargoReDemand: ["Give that back or I'll open fire."],
  lootStolen: ['Hey, that was my haul!'],
  cargoFull: ["That's all I can carry. Lucky you."],
  successfulHaul: [
    "Pleasure doing business with you {player_name}. I'll see myself out.",
  ],
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
  lostPlayer: ['Where did you go?'],
  searchExpired: ['I guess they left'],
  escaped: ["You've gotten away this time {player}"],
  stranded: ["Oh no, I'm stuck!"],
  defeat: ["You win this time, I'm leaving!"],
  destroyed: ['AHH!'],
} satisfies DialogSpec;
