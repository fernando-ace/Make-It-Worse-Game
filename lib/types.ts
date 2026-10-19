export type Player = { id: string; name: string; seenAt: number };

export type GamePhase = "game-intro" | "active-game" | "game-results" | "house-rule-selection" | "intermission" | "final-results";
export type ChaosIntensity = "standard" | "high";

export type HouseRuleEffect =
  | { type: "binding-promises" }
  | { type: "breathing-room" }
  | { type: "score-multiplier"; multiplier: number }
  | { type: "last-place-bonus"; points: number }
  | { type: "bounty"; points: number; targetId: string }
  | { type: "forced-first"; playerId: string }
  | { type: "score-floor"; playerId: string }
  | { type: "target-bonus"; points: number }
  | { type: "alliance-bonus"; points: number }
  | { type: "chaos-bonus"; points: number }
  | { type: "failed-risk-cost"; points: number }
  | { type: "protection-bonus"; points: number }
  | { type: "cooperation-bonus"; points: number };

export type HouseRule = {
  id: "binding-promises" | "breathing-room" | "underdog" | "bounty" | "double-down" | "first-commit" | "safety-net" | "target-bonus" | "alliance-bonus" | "chaos-bonus" | "failed-risk-cost" | "protection-bonus" | "cooperation-bonus";
  name: string;
  description: string;
  activationPoint: "next-game";
  effect: HouseRuleEffect;
  canStack: boolean;
  compatibleFamilies?: string[];
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
  | { type: "promise"; playerId: string; kept: boolean }
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
export type ActivePower = { beat?: number; id: PowerId; actorId: string; targetId?: string; gameNumber: number };
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
export type BeatState = { index: 0 | 1; firstChoices: Record<string, string>; publicLines: string[]; privateHints: Record<string, string> };
export type PartyRound = { openedAt?: number; completedAt?: number; beat?: BeatState; number: number; minigameId: string; startedAt: number; deadlineAt: number; config: MinigameConfig; submissions: Record<string, string>; firstCommitPlayerId: string | null; result: MinigameResolution | null };
export type PartySession = {
  startedAt?: number; completedAt?: number;
  phase: GamePhase;
  gameNumber: number;
  gameSlots: string[];
  chaosIntensity: ChaosIntensity;
  gameConfig: MinigameConfig;
  scores: Record<string, number>;
  seed: string;
  objectives: Record<string, ObjectiveState>;
  objectivesRevealedBy: string[];
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
export type SessionAward = { id: "most-targeted" | "biggest-gambler" | "best-read" | "worst-ally" | "chaos-agent" | "most-betrayed" | "best-ally" | "promise-keeper" | "broken-word"; name: string; playerId: string; count: number; detail: string };
export type MinigameDefinition = {
  id: string;
  displayName: string;
  instructions: string;
  interaction?: "read" | "trust" | "target" | "alliance" | "risk" | "negotiate";
  finaleSuitable?: boolean;
  difficulty?: 1 | 2 | 3;
  expansion?: boolean;
  director?: GameDirectorMetadata;
  multiBeat?: {
    seconds: [number, number];
    advance: (input: { players: Player[]; submissions: Record<string, string>; seed: string }) => { config: MinigameConfig; publicLines: string[]; privateHints?: Record<string, string> };
    resolve: (input: { players: Player[]; submissions: Record<string, string>; firstChoices: Record<string, string>; seed: string }) => Omit<MinigameResolution, "points" | "modifiers" | "optionCounts">;
  };
  options: (input: { players: Player[]; gameNumber: number }) => GameOption[];
  config: (input: { players: Player[]; gameNumber: number }) => MinigameConfig;
  validate: (choice: string, input: { players: Player[]; playerId: string; config: MinigameConfig }) => boolean;
  resolve: (input: { players: Player[]; submissions: Record<string, string>; scores: Record<string, number>; config: MinigameConfig }) => Omit<MinigameResolution, "points" | "modifiers" | "optionCounts">;
};
export type Room = { id: string; code: string; hostId: string; revision: number; createdAt: number; players: Player[]; blockedPlayers?: string[]; chaosIntensity?: ChaosIntensity; session: PartySession | null; processed: string[] };
export type Action = { type: string; value?: string | number | boolean; beat?: number };
export type Snapshot = {
  id: string; code: string; hostId: string; revision: number; players: Player[]; me: string; serverNow: number; chaosIntensity: ChaosIntensity;
  session: (Omit<PartySession, "round" | "seed" | "objectives" | "objectivesRevealedBy" | "chaos" | "activePowers"> & {
    round: (Omit<PartyRound, "submissions" | "beat"> & { beat?: { index: 0 | 1; publicLines: string[]; myFirstChoice: string | null; myHint: string | null }; answeredCount: number; myChoice: string | null; submittedIds: string[] }) | null;
    myObjective: ObjectiveState; myChaos: number; myPowers: ActivePower[]; myPowerOffers: PowerId[]; myIntel: { playerId: string; playerName: string; choice: string } | null; objectiveReveal?: Record<string, ObjectiveState>;
  }) | null;
};
