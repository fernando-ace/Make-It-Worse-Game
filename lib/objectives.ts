import type { GameEvent, ObjectiveState, Player } from "./types";
import { seededShuffle } from "./seed";
import { powerOffersFor } from "./powers";

type ObjectiveDefinition = Omit<ObjectiveState, "progress" | "completed" | "relatedPlayerId" | "progressedGameIds"> & {
  compatibleGames: string[];
  requiresFriend?: boolean;
  requiredPower?: import("./types").PowerId;
  match: (playerId: string, event: GameEvent, friendId?: string) => boolean;
};

const ALL_GAMES = ["split-decision", "make-it-worse", "trust-me", "pile-on", "secret-handshake", "hot-potato", "group-tab", "escalation-ladder", "bluff-check", "favor-bank", "auction-house", "lifeline", "group-project", "prisoners-dilemma", "split-the-difference", "golden-ticket"];
const READ_GAMES = ["split-decision", "make-it-worse", "bluff-check"];
const TARGET_GAMES = ["pile-on", "hot-potato"];
const RISK_GAMES = ["trust-me", "escalation-ladder", "auction-house"];
const ALLIANCE_GAMES = ["secret-handshake", "favor-bank"];
const BETRAYAL_GAMES = ["trust-me", "group-tab"];

export const OBJECTIVES: ObjectiveDefinition[] = [
  { id: "sharp-read", title: "Read the Room", description: "Correctly read the group in two different games.", target: 2, reward: 4, compatibleGames: READ_GAMES, match: (id, e) => e.type === "read" && e.playerId === id && e.accurate },
  { id: "repeat-rival", title: "A Familiar Target", description: "Target {friend} in two different games.", target: 2, reward: 4, compatibleGames: TARGET_GAMES, requiresFriend: true, match: (id, e, friend) => e.type === "target" && e.actorId === id && e.targetId === friend },
  { id: "wide-net", title: "Spread the Blame", description: "Make targeted moves in two different games.", target: 2, reward: 4, compatibleGames: TARGET_GAMES, match: (id, e) => e.type === "target" && e.actorId === id },
  { id: "steady-risk", title: "Risk Pays", description: "Win two recorded gambles.", target: 2, reward: 4, compatibleGames: RISK_GAMES, match: (id, e) => e.type === "gamble" && e.playerId === id && e.result === "won" },
  { id: "good-neighbor", title: "Good Neighbor", description: "Make two mutual pacts.", target: 2, reward: 4, compatibleGames: ALLIANCE_GAMES, match: (id, e) => e.type === "alliance" && e.playerId === id && e.mutual },
  { id: "turncoat", title: "Keep Them Guessing", description: "Make a betrayal move.", target: 1, reward: 4, compatibleGames: BETRAYAL_GAMES, match: (id, e) => e.type === "betrayal" && e.playerId === id },
  { id: "still-standing", title: "Still Standing", description: "Be targeted and keep playing.", target: 1, reward: 4, compatibleGames: TARGET_GAMES, match: (id, e) => e.type === "target" && e.targetId === id },
  { id: "bluff-catcher", title: "Bluff Catcher", description: "Correctly call the bluff in Bluff Check.", target: 1, reward: 3, compatibleGames: ["bluff-check"], match: (id, e) => e.type === "read" && e.playerId === id && e.accurate },
  { id: "good-sport", title: "No Hard Feelings", description: "Keep a mutual pact with {friend}.", target: 1, reward: 3, compatibleGames: ALLIANCE_GAMES, requiresFriend: true, match: (id, e, friend) => e.type === "alliance" && e.playerId === id && e.targetId === friend && e.mutual },
  { id: "all-in", title: "One More for the Story", description: "Take recorded risks in two different games.", target: 2, reward: 4, compatibleGames: RISK_GAMES, match: (id, e) => e.type === "gamble" && e.playerId === id },
  { id: "generous-chaos", title: "Helpful Menace", description: "Choose chaos in two different games.", target: 2, reward: 4, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "chaos" && e.playerId === id },
  { id: "surprise-audit", title: "Trust, but Verify", description: "Use Read Receipt on a friend.", target: 1, reward: 3, compatibleGames: ALL_GAMES, requiredPower: "scout", match: (id, e) => e.type === "power" && e.playerId === id && e.powerId === "scout" && e.outcome === "info" },
  { id: "quiet-climber", title: "Quiet Climber", description: "Score in two games without taking the round high score.", target: 2, reward: 4, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "round-score" && e.playerId === id && e.points > 0 && !e.highest },
  { id: "power-player", title: "Spend with Purpose", description: "Use powers in two different games.", target: 2, reward: 4, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "power" && e.playerId === id },
  { id: "steady-scorer", title: "Points on the Board", description: "Score points in two different games.", target: 2, reward: 3, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "round-score" && e.playerId === id && e.points > 0 },
  { id: "headliner", title: "Main Character", description: "Finish as the round high scorer in two games.", target: 2, reward: 4, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "round-score" && e.playerId === id && e.highest },
  { id: "stockpile", title: "Chaos Savings", description: "Earn Chaos in three different games.", target: 3, reward: 4, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "chaos-earned" && e.playerId === id && e.amount > 0 },
  { id: "late-bloomer", title: "Last-Minute Plot Twist", description: "Score points in game 5 or the finale.", target: 1, reward: 3, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "round-score" && e.playerId === id && e.gameNumber >= 5 && e.points > 0 },
  { id: "lifeline-keeper", title: "Guardian Angel", description: "Give a successful lifeline.", target: 1, reward: 4, compatibleGames: ["lifeline"], match: (id, e) => e.type === "save" && e.actorId === id && e.successful },
  { id: "ticket-backer", title: "In Your Corner", description: "Back a top-supported player for the golden ticket.", target: 1, reward: 3, compatibleGames: ["golden-ticket"], match: (id, e) => e.type === "support" && e.actorId === id && e.successful },
  { id: "project-carrier", title: "Carried the Team", description: "Carry a group project that succeeds.", target: 1, reward: 4, compatibleGames: ["group-project"], match: (id, e) => e.type === "contribution" && e.playerId === id && e.effort === 2 && e.successful },
  { id: "prison-break", title: "Temptation Won", description: "Defect in the Prisoner's Dilemma.", target: 1, reward: 3, compatibleGames: ["prisoners-dilemma"], match: (id, e) => e.type === "betrayal" && e.playerId === id },
  { id: "friend-saver", title: "I've Got You", description: "Save {friend} with a successful lifeline.", target: 1, reward: 4, compatibleGames: ["lifeline"], requiresFriend: true, match: (id, e, friend) => e.type === "save" && e.actorId === id && e.targetId === friend && e.successful },
  { id: "friend-backer", title: "Hype Person", description: "Back {friend} when they get the golden ticket.", target: 1, reward: 3, compatibleGames: ["golden-ticket"], requiresFriend: true, match: (id, e, friend) => e.type === "support" && e.actorId === id && e.targetId === friend && e.successful },
  { id: "lone-wolf", title: "Out on Your Own", description: "Use Lone Wolf successfully.", target: 1, reward: 3, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "power" && e.playerId === id && e.powerId === "contrarian" && e.outcome === "success" },
  { id: "second-wind", title: "Second Wind", description: "Use Second Wind successfully.", target: 1, reward: 3, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "power" && e.playerId === id && e.powerId === "comeback" && e.outcome === "success" },
  { id: "pocket-change", title: "Sticky Fingers", description: "Use Pocket Change successfully.", target: 1, reward: 3, compatibleGames: ALL_GAMES, match: (id, e) => e.type === "power" && e.playerId === id && e.powerId === "pickpocket" && e.outcome === "success" },
];

export function assignObjectives(seed: string, players: Player[], gameSlots: string[]): Record<string, ObjectiveState> {
  const eligibleFor = (player: Player) => seededShuffle(OBJECTIVES.filter((objective) => objective.compatibleGames.filter((game) => gameSlots.includes(game)).length >= objective.target && (!objective.requiredPower || gameSlots.some((_, index) => powerOffersFor(seed, index + 1, player.id).includes(objective.requiredPower!)))), `${seed}:objective-pool:${player.id}`);
  const eligibleByPlayer = players.map(eligibleFor);
  if (eligibleByPlayer.some((eligible) => !eligible.length)) throw new Error("No objectives are compatible with this session lineup");
  const used = new Set<string>();
  const uniqueAssignments = eligibleByPlayer.map((eligible) => {
    const objective = eligible.find((candidate) => !used.has(candidate.id)) ?? eligible[0];
    used.add(objective.id);
    return objective;
  });
  return Object.fromEntries(players.map((player, index) => {
    const objective = uniqueAssignments[index];
    const friend = objective.requiresFriend ? seededShuffle(players.filter((other) => other.id !== player.id), `${seed}:objective-friend:${player.id}:${objective.id}`)[0] : undefined;
    const description = friend ? objective.description.replaceAll("{friend}", friend.name) : objective.description;
    return [player.id, {
      id: objective.id, title: objective.title, description, progress: 0, target: objective.target,
      completed: false, reward: objective.reward, ...(friend ? { relatedPlayerId: friend.id } : {}), progressedGameIds: [],
    }];
  }));
}

export function advanceObjectives(objectives: Record<string, ObjectiveState>, events: GameEvent[], gameId: string) {
  for (const [playerId, state] of Object.entries(objectives)) {
    if (state.completed) continue;
    const definition = OBJECTIVES.find((item) => item.id === state.id);
    if (!definition?.compatibleGames.includes(gameId)) continue;
    const gained = events.filter((event) => definition.match(playerId, event, state.relatedPlayerId)).length;
    if (!gained) continue;
    state.progressedGameIds ??= [];
    if (state.target > 1) {
      if (state.progressedGameIds.includes(gameId)) continue;
      state.progress += 1;
      state.progressedGameIds.push(gameId);
    } else state.progress = Math.min(state.target, state.progress + gained);
    state.completed = state.progress >= state.target;
  }
}
