export type Player = {
  id: string;
  name: string;
  seenAt: number;
};

export type GamePhase =
  | "round-intro"
  | "minigame"
  | "round-results"
  | "house-rule-selection"
  | "next-round"
  | "final-results";

export type HouseRule = {
  id: "underdog" | "bounty" | "double-down";
  name: string;
  description: string;
  duration: "next-round";
  parameters?: Record<string, string | number>;
};

export type RoundResult = {
  choices: Record<string, "RED" | "BLUE">;
  points: Record<string, number>;
  reasons: Record<string, string>;
  redCount: number;
  blueCount: number;
};

export type PartyRound = {
  number: number;
  minigameId: string;
  startedAt: number;
  deadlineAt: number;
  submissions: Record<string, "RED" | "BLUE">;
  result: RoundResult | null;
};

export type PartySession = {
  phase: GamePhase;
  roundNumber: number;
  scores: Record<string, number>;
  round: PartyRound | null;
  activeRules: HouseRule[];
  offeredRules: HouseRule[];
  ruleWinnerId: string | null;
  history: Array<{ number: number; result: RoundResult; rule: HouseRule | null }>;
  maxRounds: number;
};

export type MinigameDefinition = {
  id: string;
  displayName: string;
  instructions: string;
  phases: readonly GamePhase[];
  input: { choices: readonly string[] };
  resolve: (input: {
    players: Player[];
    submissions: Record<string, string>;
    scores: Record<string, number>;
    rules: HouseRule[];
  }) => RoundResult;
  compatibleHouseRules: readonly HouseRule["id"][];
};

export type Room = {
  id: string;
  code: string;
  hostId: string;
  revision: number;
  createdAt: number;
  players: Player[];
  blockedPlayers?: string[];
  session: PartySession | null;
  processed: string[];
};

export type Action = { type: string; value?: string | number | boolean };

export type Snapshot = {
  id: string;
  code: string;
  hostId: string;
  revision: number;
  players: Player[];
  me: string;
  serverNow: number;
  session: (Omit<PartySession, "round"> & {
    round: (Omit<PartyRound, "submissions"> & {
      answeredCount: number;
      myChoice: "RED" | "BLUE" | null;
      submittedIds: string[];
    }) | null;
  }) | null;
};
