export type Player = { id: string; name: string; seenAt: number };

export type GamePhase = "game-intro" | "active-game" | "game-results" | "house-rule-selection" | "intermission" | "final-results";

export type HouseRuleEffect =
  | { type: "score-multiplier"; multiplier: number }
  | { type: "last-place-bonus"; points: number }
  | { type: "bounty"; points: number; targetId: string };

export type HouseRule = {
  id: "underdog" | "bounty" | "double-down";
  name: string;
  description: string;
  activationPoint: "next-game";
  effect: HouseRuleEffect;
  canStack: boolean;
};

export type RoundResult = { choices: Record<string, "RED" | "BLUE">; points: Record<string, number>; reasons: Record<string, string>; redCount: number; blueCount: number };
export type PartyRound = { number: number; minigameId: string; startedAt: number; deadlineAt: number; submissions: Record<string, "RED" | "BLUE">; result: RoundResult | null };
export type PartySession = {
  phase: GamePhase;
  gameNumber: number;
  gameSlots: string[];
  scores: Record<string, number>;
  round: PartyRound | null;
  activeRules: HouseRule[];
  offeredRules: HouseRule[];
  newlyActivatedRule: HouseRule | null;
  ruleWinnerId: string | null;
  history: Array<{ number: number; minigameId: string; result: RoundResult; rules: HouseRule[]; selectedRule: HouseRule | null }>;
};
export type MinigameDefinition = {
  id: string;
  displayName: string;
  instructions: string;
  input: { choices: readonly string[] };
  resolve: (input: { players: Player[]; submissions: Record<string, string>; scores: Record<string, number>; rules: HouseRule[] }) => RoundResult;
};
export type Room = { id: string; code: string; hostId: string; revision: number; createdAt: number; players: Player[]; blockedPlayers?: string[]; session: PartySession | null; processed: string[] };
export type Action = { type: string; value?: string | number | boolean };
export type Snapshot = {
  id: string; code: string; hostId: string; revision: number; players: Player[]; me: string; serverNow: number;
  session: (Omit<PartySession, "round"> & { round: (Omit<PartyRound, "submissions"> & { answeredCount: number; myChoice: "RED" | "BLUE" | null; submittedIds: string[] }) | null }) | null;
};
