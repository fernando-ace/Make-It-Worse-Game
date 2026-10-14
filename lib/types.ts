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

export type GameOption = { id: string; label: string; detail?: string };
export type MinigameConfig = { title: string; prompt: string; options: GameOption[]; scoreHint: string; promptId?: string };
export type GameEvent =
  | { type: "target"; actorId: string; targetId: string }
  | { type: "gamble"; playerId: string; result: "won" | "lost" }
  | { type: "read"; playerId: string; accurate: boolean }
  | { type: "betrayal"; playerId: string }
  | { type: "chaos"; playerId: string };
export type MinigameResolution = {
  choices: Record<string, string>;
  basePoints: Record<string, number>;
  points: Record<string, number>;
  reasons: Record<string, string>;
  modifiers: Record<string, string[]>;
  optionCounts: Record<string, number>;
  events: GameEvent[];
  reveal: string;
};
export type PartyRound = { number: number; minigameId: string; startedAt: number; deadlineAt: number; config: MinigameConfig; submissions: Record<string, string>; result: MinigameResolution | null };
export type PartySession = {
  phase: GamePhase;
  gameNumber: number;
  gameSlots: string[];
  gameConfig: MinigameConfig;
  scores: Record<string, number>;
  round: PartyRound | null;
  activeRules: HouseRule[];
  offeredRules: HouseRule[];
  newlyActivatedRule: HouseRule | null;
  ruleWinnerId: string | null;
  history: Array<{ number: number; minigameId: string; result: MinigameResolution; rules: HouseRule[]; selectedRule: HouseRule | null }>;
  awards: SessionAward[];
};
export type SessionAward = { id: "most-targeted" | "biggest-gambler" | "best-read" | "worst-ally" | "chaos-agent"; name: string; playerId: string; count: number; detail: string };
export type MinigameDefinition = {
  id: string;
  displayName: string;
  instructions: string;
  options: (input: { players: Player[]; gameNumber: number }) => GameOption[];
  config: (input: { players: Player[]; gameNumber: number }) => MinigameConfig;
  validate: (choice: string, input: { players: Player[]; playerId: string; config: MinigameConfig }) => boolean;
  resolve: (input: { players: Player[]; submissions: Record<string, string>; scores: Record<string, number>; config: MinigameConfig }) => Omit<MinigameResolution, "points" | "modifiers" | "optionCounts">;
};
export type Room = { id: string; code: string; hostId: string; revision: number; createdAt: number; players: Player[]; blockedPlayers?: string[]; session: PartySession | null; processed: string[] };
export type Action = { type: string; value?: string | number | boolean };
export type Snapshot = {
  id: string; code: string; hostId: string; revision: number; players: Player[]; me: string; serverNow: number;
  session: (Omit<PartySession, "round"> & { round: (Omit<PartyRound, "submissions"> & { answeredCount: number; myChoice: string | null; submittedIds: string[] }) | null }) | null;
};
