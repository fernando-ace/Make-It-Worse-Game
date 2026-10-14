export type Player = { id: string; name: string; seenAt: number };

export type GamePhase = "game-intro" | "active-game" | "game-results" | "house-rule-selection" | "intermission" | "final-results";

export type HouseRuleEffect =
  | { type: "score-multiplier"; multiplier: number }
  | { type: "last-place-bonus"; points: number }
  | { type: "bounty"; points: number; targetId: string }
  | { type: "forced-first"; playerId: string }
  | { type: "score-floor"; playerId: string };

export type HouseRule = {
  id: "underdog" | "bounty" | "double-down" | "first-commit" | "safety-net";
  name: string;
  description: string;
  activationPoint: "next-game";
  effect: HouseRuleEffect;
  canStack: boolean;
};

export type GameOption = { id: string; label: string; detail?: string };
export type MinigameConfig = { title: string; prompt: string; options: GameOption[]; scoreHint: string; promptId?: string };
export type GameDirectorMetadata = {
  family: string;
  socialIntensity: 1 | 2 | 3;
  informationVisibility: "public" | "simultaneous-secret" | "asymmetric";
  betrayalPotential: 1 | 2 | 3;
  coordination: 1 | 2 | 3;
  randomness: 1 | 2 | 3;
  minPlayers: number;
  maxPlayers: number;
  expectedSeconds: number;
  sessionTags: Array<"opener" | "social" | "read" | "stakes" | "chaos" | "finale">;
  houseRuleTags: string[];
};
export type GameEvent =
  | { type: "target"; actorId: string; targetId: string }
  | { type: "gamble"; playerId: string; result: "won" | "lost" }
  | { type: "read"; playerId: string; accurate: boolean }
  | { type: "betrayal"; playerId: string }
  | { type: "chaos"; playerId: string }
  | { type: "alliance"; playerId: string; targetId: string; mutual: boolean }
  | { type: "save"; actorId: string; targetId: string; successful: boolean }
  | { type: "support"; actorId: string; targetId: string; successful: boolean }
  | { type: "contribution"; playerId: string; effort: number; successful: boolean }
  | { type: "betrayed"; playerId: string; targetId: string }
  | { type: "power"; playerId: string; powerId: PowerId; targetId?: string; outcome?: "success" | "miss" | "info" }
  | { type: "chaos-earned"; playerId: string; amount: number }
  | { type: "round-score"; playerId: string; points: number; highest: boolean; gameNumber: number };
export type ObjectiveState = { id: string; title: string; description: string; progress: number; target: number; completed: boolean; reward: number; relatedPlayerId?: string; progressedGameIds?: string[] };
export type PowerId = "guard" | "amplify" | "bounty" | "bodyguard" | "hex" | "comeback" | "pickpocket" | "contrarian" | "scout";
export type ActivePower = { id: PowerId; actorId: string; targetId?: string; gameNumber: number };
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
export type PartyRound = { number: number; minigameId: string; startedAt: number; deadlineAt: number; config: MinigameConfig; submissions: Record<string, string>; firstCommitPlayerId: string | null; result: MinigameResolution | null };
export type PartySession = {
  phase: GamePhase;
  gameNumber: number;
  gameSlots: string[];
  gameConfig: MinigameConfig;
  scores: Record<string, number>;
  seed: string;
  objectives: Record<string, ObjectiveState>;
  chaos: Record<string, number>;
  activePowers: ActivePower[];
  scoreProgression: Array<Record<string, number>>;
  round: PartyRound | null;
  activeRules: HouseRule[];
  offeredRules: HouseRule[];
  newlyActivatedRule: HouseRule | null;
  ruleWinnerId: string | null;
  history: Array<{ number: number; minigameId: string; result: MinigameResolution; rules: HouseRule[]; selectedRule: HouseRule | null }>;
  awards: SessionAward[];
};
export type SessionAward = { id: "most-targeted" | "biggest-gambler" | "best-read" | "worst-ally" | "chaos-agent" | "most-betrayed" | "best-ally"; name: string; playerId: string; count: number; detail: string };
export type MinigameDefinition = {
  id: string;
  displayName: string;
  instructions: string;
  interaction?: "read" | "trust" | "target" | "alliance" | "risk" | "negotiate";
  finaleSuitable?: boolean;
  difficulty?: 1 | 2 | 3;
  expansion?: boolean;
  director?: GameDirectorMetadata;
  options: (input: { players: Player[]; gameNumber: number }) => GameOption[];
  config: (input: { players: Player[]; gameNumber: number }) => MinigameConfig;
  validate: (choice: string, input: { players: Player[]; playerId: string; config: MinigameConfig }) => boolean;
  resolve: (input: { players: Player[]; submissions: Record<string, string>; scores: Record<string, number>; config: MinigameConfig }) => Omit<MinigameResolution, "points" | "modifiers" | "optionCounts">;
};
export type Room = { id: string; code: string; hostId: string; revision: number; createdAt: number; players: Player[]; blockedPlayers?: string[]; session: PartySession | null; processed: string[] };
export type Action = { type: string; value?: string | number | boolean };
export type Snapshot = {
  id: string; code: string; hostId: string; revision: number; players: Player[]; me: string; serverNow: number;
  session: (Omit<PartySession, "round" | "seed" | "objectives" | "chaos" | "activePowers"> & {
    round: (Omit<PartyRound, "submissions"> & { answeredCount: number; myChoice: string | null; submittedIds: string[] }) | null;
    myObjective: ObjectiveState; myChaos: number; myPowers: ActivePower[]; myPowerOffers: PowerId[]; myIntel: { playerId: string; playerName: string; choice: string } | null; objectiveReveal?: Record<string, ObjectiveState>;
  }) | null;
};
