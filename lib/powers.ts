import type { PowerId } from "./types";
import { seededShuffle } from "./seed";

export type PowerDefinition = { id: PowerId; name: string; cost: number; description: string; targetRequired: boolean; targetableAfterCommit?: boolean };
export const POWERS: Record<PowerId, PowerDefinition> = {
  guard: { id: "guard", name: "Soft Landing", cost: 2, description: "Cancel your negative score this game after House Rules.", targetRequired: false },
  amplify: { id: "amplify", name: "Turn It Up", cost: 2, description: "Add +1 if your score this game is positive.", targetRequired: false },
  bounty: { id: "bounty", name: "Side Bet", cost: 2, description: "Earn +2 if you outscore your marked friend this game.", targetRequired: true },
  bodyguard: { id: "bodyguard", name: "Take the Hit", cost: 3, description: "Cancel one marked friend's negative score this game.", targetRequired: true },
  hex: { id: "hex", name: "Bad Omen", cost: 3, description: "Give a marked player −2 this game.", targetRequired: true },
  comeback: { id: "comeback", name: "Second Wind", cost: 2, description: "Earn +2 if you are tied for last and score points this game.", targetRequired: false },
  pickpocket: { id: "pickpocket", name: "Pocket Change", cost: 3, description: "Take 1 point from a marked player who scores this game.", targetRequired: true },
  contrarian: { id: "contrarian", name: "Lone Wolf", cost: 2, description: "Earn +2 if you are the only player to choose your option.", targetRequired: false },
  scout: { id: "scout", name: "Read Receipt", cost: 2, description: "Privately see one committed player's locked choice.", targetRequired: true, targetableAfterCommit: true },
};

export const POWER_LIST = Object.values(POWERS);

export function powerOffersFor(seed: string, gameNumber: number, playerId: string) {
  const available = `${seed}:power-offers:${gameNumber}:${playerId}`;
  const selfPowers = seededShuffle(POWER_LIST.filter((power) => !power.targetRequired), `${available}:self`).slice(0, 2);
  const targetedPowers = seededShuffle(POWER_LIST.filter((power) => power.targetRequired), `${available}:target`).slice(0, 1);
  return seededShuffle([...selfPowers, ...targetedPowers], `${available}:display`).map((power) => power.id);
}
