import type { GameEvent, ObjectiveState, Player } from "./types";
import { seededShuffle } from "./seed";

type ObjectiveDefinition = Omit<ObjectiveState, "progress" | "completed" | "relatedIds"> & {
  compatibleGames: string[];
  match: (playerId: string, event: GameEvent) => boolean;
};

export const OBJECTIVES: ObjectiveDefinition[] = [
  { id: "sharp-read", title: "Read the Room", description: "Correctly read the group in two different games.", target: 2, reward: 4, compatibleGames: ["split-decision", "make-it-worse", "bluff-check"], match: (id, e) => e.type === "read" && e.playerId === id && e.accurate },
  { id: "repeat-rival", title: "A Familiar Target", description: "Target someone in two different games.", target: 2, reward: 4, compatibleGames: ["pile-on", "hot-potato"], match: (id, e) => e.type === "target" && e.actorId === id },
  { id: "wide-net", title: "Spread the Blame", description: "Make two targeted moves.", target: 2, reward: 4, compatibleGames: ["pile-on", "hot-potato"], match: (id, e) => e.type === "target" && e.actorId === id },
  { id: "steady-risk", title: "Risk Pays", description: "Win two recorded gambles.", target: 2, reward: 4, compatibleGames: ["trust-me", "escalation-ladder"], match: (id, e) => e.type === "gamble" && e.playerId === id && e.result === "won" },
  { id: "good-neighbor", title: "Good Neighbor", description: "Make two mutual pacts.", target: 2, reward: 4, compatibleGames: ["secret-handshake", "favor-bank"], match: (id, e) => e.type === "alliance" && e.playerId === id && e.mutual },
  { id: "turncoat", title: "Keep Them Guessing", description: "Make a betrayal move.", target: 1, reward: 4, compatibleGames: ["trust-me", "group-tab"], match: (id, e) => e.type === "betrayal" && e.playerId === id },
  { id: "still-standing", title: "Still Standing", description: "Be targeted and keep playing.", target: 1, reward: 4, compatibleGames: ["pile-on", "hot-potato"], match: (id, e) => e.type === "target" && e.targetId === id },
  { id: "bluff-catcher", title: "Bluff Catcher", description: "Make accurate challenges or crowd reads in two games.", target: 2, reward: 4, compatibleGames: ["bluff-check", "split-decision", "make-it-worse"], match: (id, e) => e.type === "read" && e.playerId === id && e.accurate },
  { id: "good-sport", title: "No Hard Feelings", description: "Keep two mutual pacts.", target: 2, reward: 4, compatibleGames: ["secret-handshake", "favor-bank"], match: (id, e) => e.type === "alliance" && e.playerId === id && e.mutual },
  { id: "all-in", title: "One More for the Story", description: "Take two recorded risks.", target: 2, reward: 4, compatibleGames: ["trust-me", "escalation-ladder"], match: (id, e) => e.type === "gamble" && e.playerId === id },
  { id: "generous-chaos", title: "Helpful Menace", description: "Help a friend benefit from one of your moves.", target: 1, reward: 4, compatibleGames: ["favor-bank", "secret-handshake"], match: (id, e) => e.type === "alliance" && e.playerId === id && e.mutual },
  { id: "surprise-audit", title: "Trust, but Verify", description: "Challenge one bluff accurately.", target: 1, reward: 4, compatibleGames: ["bluff-check"], match: (id, e) => e.type === "read" && e.playerId === id && e.accurate },
  { id: "quiet-climber", title: "Quiet Climber", description: "Score in two games without taking the round high score.", target: 2, reward: 4, compatibleGames: ["split-decision", "make-it-worse", "trust-me", "pile-on", "secret-handshake", "hot-potato", "group-tab", "escalation-ladder", "bluff-check", "favor-bank"], match: (id, e) => e.type === "round-score" && e.playerId === id && e.points > 0 && !e.highest },
  { id: "power-player", title: "Spend with Purpose", description: "Use two powers across the session.", target: 2, reward: 4, compatibleGames: ["split-decision", "make-it-worse", "trust-me", "pile-on", "secret-handshake", "hot-potato", "group-tab", "escalation-ladder", "bluff-check", "favor-bank"], match: (id, e) => e.type === "power" && e.playerId === id },
];

export function assignObjectives(seed: string, players: Player[], gameSlots: string[]): Record<string, ObjectiveState> {
  const eligible = seededShuffle(OBJECTIVES.filter((objective) => objective.compatibleGames.filter((game) => gameSlots.includes(game)).length >= objective.target), `${seed}:objective-pool`);
  if (!eligible.length) throw new Error("No objectives are compatible with this session lineup");
  return Object.fromEntries(players.map((player, index) => {
    const objective = eligible[index % eligible.length];
    return [player.id, { id: objective.id, title: objective.title, description: objective.description, progress: 0, target: objective.target, completed: false, reward: objective.reward }];
  }));
}

export function advanceObjectives(objectives: Record<string, ObjectiveState>, events: GameEvent[], gameId: string) {
  for (const [playerId, state] of Object.entries(objectives)) {
    if (state.completed) continue;
    const definition = OBJECTIVES.find((item) => item.id === state.id);
    if (!definition?.compatibleGames.includes(gameId)) continue;
    const gained = events.filter((event) => definition.match(playerId, event)).length;
    if (gained) {
      state.progress = Math.min(state.target, state.progress + gained);
      state.completed = state.progress >= state.target;
    }
  }
}
