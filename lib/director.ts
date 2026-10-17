import type { GameDirectorMetadata, MinigameDefinition } from "./types";
import { seededShuffle } from "./seed";

const commonRules = ["scoring", "information", "targeting", "risk", "chaos", "powers", "finale"];
export const GAME_DIRECTOR_METADATA: Record<string, GameDirectorMetadata> = {
  "split-decision": { family: "prediction", socialIntensity: 1, informationVisibility: "simultaneous-secret", betrayalPotential: 1, coordination: 1, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 75, sessionTags: ["opener", "read"], houseRuleTags: commonRules },
  "make-it-worse": { family: "prediction", socialIntensity: 1, informationVisibility: "simultaneous-secret", betrayalPotential: 1, coordination: 1, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 90, sessionTags: ["opener", "read", "social"], houseRuleTags: commonRules },
  "trust-me": { family: "trust", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 3, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 105, sessionTags: ["social", "stakes", "finale"], houseRuleTags: commonRules },
  "pile-on": { family: "targeting", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 3, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 100, sessionTags: ["social", "stakes", "chaos"], houseRuleTags: commonRules },
  "secret-handshake": { family: "alliance", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 2, coordination: 2, randomness: 1, minPlayers: 2, maxPlayers: 8, expectedSeconds: 100, sessionTags: ["social", "stakes"], houseRuleTags: commonRules },
  "hot-potato": { family: "passing-risk", socialIntensity: 2, informationVisibility: "simultaneous-secret", betrayalPotential: 3, coordination: 3, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 95, sessionTags: ["stakes", "chaos", "finale"], houseRuleTags: commonRules },
  "group-tab": { family: "negotiation", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 3, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 100, sessionTags: ["social", "stakes", "chaos"], houseRuleTags: commonRules },
  "escalation-ladder": { family: "risk", socialIntensity: 2, informationVisibility: "simultaneous-secret", betrayalPotential: 2, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 90, sessionTags: ["stakes", "chaos", "finale"], houseRuleTags: commonRules },
  "bluff-check": { family: "bluff", socialIntensity: 2, informationVisibility: "simultaneous-secret", betrayalPotential: 2, coordination: 1, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 85, sessionTags: ["read", "social", "finale"], houseRuleTags: commonRules },
  "favor-bank": { family: "alliance", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 3, coordination: 2, randomness: 1, minPlayers: 2, maxPlayers: 8, expectedSeconds: 100, sessionTags: ["social", "stakes", "finale"], houseRuleTags: commonRules },
  "auction-house": { family: "auction", socialIntensity: 2, informationVisibility: "simultaneous-secret", betrayalPotential: 1, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 95, sessionTags: ["stakes", "chaos", "finale"], houseRuleTags: commonRules },
  lifeline: { family: "protection-vote", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 1, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 95, sessionTags: ["social", "stakes", "finale"], houseRuleTags: commonRules },
  "group-project": { family: "shared-effort", socialIntensity: 2, informationVisibility: "simultaneous-secret", betrayalPotential: 2, coordination: 3, randomness: 1, minPlayers: 2, maxPlayers: 8, expectedSeconds: 100, sessionTags: ["social", "stakes", "chaos"], houseRuleTags: commonRules },
  "prisoners-dilemma": { family: "prisoners-dilemma", socialIntensity: 3, informationVisibility: "simultaneous-secret", betrayalPotential: 3, coordination: 2, randomness: 1, minPlayers: 2, maxPlayers: 8, expectedSeconds: 95, sessionTags: ["social", "stakes", "finale"], houseRuleTags: commonRules },
  "split-the-difference": { family: "number-coordination", socialIntensity: 1, informationVisibility: "simultaneous-secret", betrayalPotential: 1, coordination: 3, randomness: 1, minPlayers: 2, maxPlayers: 8, expectedSeconds: 80, sessionTags: ["opener", "read", "social"], houseRuleTags: commonRules },
  "golden-ticket": { family: "popularity-vote", socialIntensity: 2, informationVisibility: "simultaneous-secret", betrayalPotential: 1, coordination: 2, randomness: 2, minPlayers: 2, maxPlayers: 8, expectedSeconds: 90, sessionTags: ["social", "stakes", "finale"], houseRuleTags: commonRules },
};

export function withDirectorMetadata(game: MinigameDefinition): MinigameDefinition {
  const metadata = game.director ?? GAME_DIRECTOR_METADATA[game.id] ?? {
    family: game.interaction ?? game.id, socialIntensity: game.difficulty ?? 2,
    informationVisibility: "simultaneous-secret" as const, betrayalPotential: 1 as const,
    coordination: 1 as const, randomness: 2 as const, minPlayers: 2, maxPlayers: 8,
    expectedSeconds: 90, sessionTags: ["social"] as GameDirectorMetadata["sessionTags"], houseRuleTags: commonRules,
  };
  game.director = metadata;
  return game;
}

const arc = ["opener", "social", "read", "stakes", "chaos", "finale"] as const;

/** Deterministically fills a paced six-slot arc from any compatible game registry. */
export function directSessionGames(seed: string, registry: Record<string, MinigameDefinition>, playerCount = 3): string[] {
  const games = Object.values(registry).map(withDirectorMetadata).filter((game) => playerCount >= game.director!.minPlayers && playerCount <= game.director!.maxPlayers);
  if (games.length < arc.length) throw new Error(`At least ${arc.length} compatible minigames must be registered`);
  const ordered = arc.map((tag, slot) => seededShuffle(games.filter((game) => game.director!.sessionTags.includes(tag)), `${seed}:arc:${slot}:${tag}`));
  const selected: MinigameDefinition[] = [];
  const search = (slot: number): boolean => {
    if (slot === arc.length) {
      const multi = selected.filter(game => game.multiBeat).length;
      const supportsBeats = games.filter(game => game.multiBeat).length >= 3;
      return new Set(selected.map((game) => game.director!.family)).size >= 4
        && (!supportsBeats || multi >= 2 && multi <= 3)
        && selected.reduce((n, game) => n + game.director!.expectedSeconds, 0) <= 700;
    }
    for (const game of ordered[slot]) {
      const meta = game.director!;
      if (selected.some((chosen) => chosen.id === game.id)) continue;
      if (slot === 0 && meta.socialIntensity > 1) continue;
      if (slot === 5 && !game.finaleSuitable) continue;
      if (selected.at(-1)?.director!.family === meta.family) continue;
      if (selected.filter((chosen) => chosen.director!.family === meta.family).length >= 2) continue;
      selected.push(game);
      if (search(slot + 1)) return true;
      selected.pop();
    }
    return false;
  };
  if (!search(0)) throw new Error("Could not construct a paced session from the compatible game registry");
  return selected.map((game) => game.id);
}
