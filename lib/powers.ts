import type { PowerId } from "./types";

export const POWERS: Record<PowerId, { id: PowerId; name: string; cost: number; description: string; targetRequired: boolean }> = {
  guard: { id: "guard", name: "Soft Landing", cost: 2, description: "Cancel your negative score this game after House Rules.", targetRequired: false },
  amplify: { id: "amplify", name: "Turn It Up", cost: 2, description: "Add +1 if your score this game is positive.", targetRequired: false },
  bounty: { id: "bounty", name: "Side Bet", cost: 2, description: "Earn +2 if you outscore your marked friend this game.", targetRequired: true },
};

export const POWER_LIST = Object.values(POWERS);
