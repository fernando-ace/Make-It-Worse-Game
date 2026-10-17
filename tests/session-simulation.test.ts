import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { apply, MINIGAMES, powerOffersFor, POWER_LIST, selectSessionGames, SESSION_GAME_COUNT } from "../lib/engine";
import { OBJECTIVES, assignObjectives } from "../lib/objectives";
import { seededShuffle } from "../lib/seed";
import type { Room } from "../lib/types";

const BASE_TIME = 1_000_000;

function runSeededSession(seed: string, playerCount: number) {
  const players = Array.from({ length: playerCount }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, seenAt: BASE_TIME }));
  const room: Room = { id: "simulation-room", code: "SIM234", hostId: "p0", revision: 0, createdAt: BASE_TIME, players, session: null, processed: [] };
  let now = BASE_TIME;
  let actionIndex = 0;
  const act = (playerId: string, type: string, value?: string | boolean) => {
    now += 1;
    apply(room, playerId, { type, value, beat: room.session?.round?.beat?.index }, now, `simulation:${seed}:${++actionIndex}`);
  };

  act("p0", "start");
  const session = room.session!;
  session.seed = seed;
  session.gameSlots = selectSessionGames(seed);
  session.objectives = assignObjectives(seed, players, session.gameSlots);
  session.gameConfig = MINIGAMES[session.gameSlots[0]].config({ players, gameNumber: 1 });

  for (let gameNumber = 1; gameNumber <= SESSION_GAME_COUNT; gameNumber++) {
    if (gameNumber > 1) act("p0", "continue-session");
    act("p0", "begin-game");
    const round = session.round!;
    const game = MINIGAMES[round.minigameId];
    const commitOrder = round.firstCommitPlayerId
      ? [players.find((player) => player.id === round.firstCommitPlayerId)!, ...players.filter((player) => player.id !== round.firstCommitPlayerId)]
      : players;

    // Exercise the real rotating offer and server-side cost checks with seeded player policies.
    for (const player of commitOrder) {
      const power = powerOffersFor(seed, gameNumber, player.id)
        .map((id) => POWER_LIST.find((definition) => definition.id === id)!)
        .find((definition) => !definition.targetableAfterCommit && definition.cost <= session.chaos[player.id]);
      if (!power) continue;
      const target = power.targetRequired
        ? seededShuffle(players.filter((candidate) => candidate.id !== player.id), `${seed}:power-target:${gameNumber}:${player.id}`)[0].id
        : undefined;
      act(player.id, "use-power", `${power.id}${target ? `:${target}` : ""}`);
    }

    for (let beat = 0; beat < (game.multiBeat ? 2 : 1); beat++) for (const player of commitOrder) {
      const validOptions = round.config.options.filter((option) => game.validate(option.id, { players, playerId: player.id, config: round.config }));
      expect(validOptions.length, `${round.minigameId} must expose a legal action for ${player.id}`).toBeGreaterThan(0);
      const choice = seededShuffle(validOptions, `${seed}:choice:${gameNumber}:${beat}:${player.id}`)[0];
      act(player.id, "submit", choice.id);
    }

    expect(session.phase).toBe("game-results");
    expect(round.result).toBeTruthy();
    if (gameNumber < SESSION_GAME_COUNT) {
      act(session.ruleWinnerId!, "open-rule-selection");
      expect(session.offeredRules.length).toBeGreaterThan(0);
      expect(session.offeredRules.length).toBeLessThanOrEqual(4);
      const futureFamilies = new Set(session.gameSlots.slice(gameNumber).map((id) => MINIGAMES[id].director!.family));
      for (const rule of session.offeredRules) {
        expect(rule.compatibleFamilies?.includes("*") || rule.compatibleFamilies?.some((family) => futureFamilies.has(family))).toBe(true);
      }
      const selected = seededShuffle(session.offeredRules, `${seed}:rule:${gameNumber}`)[0];
      act(session.ruleWinnerId!, "select-rule", selected.id);
    } else {
      expect(() => act(session.ruleWinnerId!, "open-rule-selection")).toThrow("no future game");
      act("p0", "finish-session");
    }
  }

  expect(session.phase).toBe("final-results");
  expect(session.history).toHaveLength(SESSION_GAME_COUNT);
  expect(session.scoreProgression).toHaveLength(SESSION_GAME_COUNT + 1);
  expect(Object.values(session.scores).every(Number.isFinite)).toBe(true);
  expect(Object.values(session.chaos).every((chaos) => Number.isFinite(chaos) && chaos >= 0)).toBe(true);

  for (const player of players) {
    const objective = session.objectives[player.id];
    const definition = OBJECTIVES.find((candidate) => candidate.id === objective.id)!;
    expect(definition.compatibleGames.filter((gameId) => session.gameSlots.includes(gameId)).length).toBeGreaterThanOrEqual(definition.target);
    if (definition.requiredPower) expect(session.gameSlots.some((_, index) => powerOffersFor(seed, index + 1, player.id).includes(definition.requiredPower!))).toBe(true);
  }

  return {
    gameSlots: session.gameSlots,
    history: session.history,
    scores: session.scores,
    scoreProgression: session.scoreProgression,
    objectives: session.objectives,
    chaos: session.chaos,
    activePowers: session.activePowers,
    awards: session.awards,
  };
}

describe("seeded full-session simulations", () => {
  it("completes a deterministic session matrix across 2–8 players and measures key outcomes", () => {
    const sessionCount = Number(process.env.SIMULATION_SESSIONS ?? 1_000);
    const stats = {
      sessions: 0,
      players: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index + 2, 0])) as Record<number, number>,
      gameAppearances: Object.fromEntries(Object.keys(MINIGAMES).map((id) => [id, 0])) as Record<string, number>,
      gameAppearancesByPlayers: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index + 2, Object.fromEntries(Object.keys(MINIGAMES).map(id => [id, 0]))])) as Record<number, Record<string, number>>,
      scoreContributionsByGame: Object.fromEntries(Object.keys(MINIGAMES).map(id => [id, [] as number[]])) as Record<string, number[]>,
      multiBeatByPlayers: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index + 2, 0])) as Record<number, number>,
      objectiveRewards: 0,
      objectiveAssignments: 0,
      familyAdjacencyRepeats: 0,
      finalScoreMin: Number.POSITIVE_INFINITY,
      finalScoreMax: Number.NEGATIVE_INFINITY,
      tiedWinnerSessions: 0,
      finaleComebacks: 0,
      powerUses: 0,
      completedObjectives: 0,
      multiBeatGames: 0,
      leadChanges: 0,
      runaways: 0,
      chaosEarned: 0,
      chaosSpent: 0,
      chaosSaved: 0,
      finaleChaosPoints: 0,
      powerSuccesses: 0,
      powerMisses: 0,
      ruleActivations: 0,
      selectedRules: new Set<string>(),
      uniqueLineups: new Set<string>(),
    };

    for (let index = 0; index < sessionCount; index++) {
      const playerCount = 2 + (index % 7);
      const seed = `full-session:${index}`;
      const result = runSeededSession(seed, playerCount);
      stats.sessions++;
      stats.players[playerCount]++;
      stats.uniqueLineups.add(result.gameSlots.join("|"));
      for (let slot = 0; slot < result.gameSlots.length; slot++) {
        const gameId = result.gameSlots[slot];
        stats.gameAppearances[gameId]++;
        stats.gameAppearancesByPlayers[playerCount][gameId]++;
        if (MINIGAMES[gameId].multiBeat) stats.multiBeatByPlayers[playerCount]++;
        if (slot > 0 && MINIGAMES[gameId].director!.family === MINIGAMES[result.gameSlots[slot - 1]].director!.family) stats.familyAdjacencyRepeats++;
      }
      for (const game of result.history) {
        if (MINIGAMES[game.minigameId].multiBeat) stats.multiBeatGames++;
        stats.scoreContributionsByGame[game.minigameId].push(...Object.values(game.result.points));
        for (const event of game.result.events) {
          if (event.type === "power") {
            stats.powerUses++;
            if (event.outcome === "success") stats.powerSuccesses++;
            if (event.outcome === "miss") stats.powerMisses++;
            stats.chaosSpent += POWER_LIST.find(power => power.id === event.powerId)!.cost;
          }
          if (event.type === "chaos-earned") stats.chaosEarned += event.amount;
        }
        for (const rule of game.rules) stats.selectedRules.add(rule.id);
        if (game.selectedRule) stats.ruleActivations++;
      }
      stats.objectiveAssignments += Object.keys(result.objectives).length;
      stats.completedObjectives += Object.values(result.objectives).filter((objective) => objective.completed).length;
      stats.objectiveRewards += Object.values(result.objectives).filter((objective) => objective.completed).reduce((sum, objective) => sum + objective.reward, 0);
      for (const amount of Object.values(result.chaos)) {
        stats.chaosSaved += amount;
        stats.finaleChaosPoints += Math.min(2, Math.floor(amount / 3));
      }
      if (Object.values(result.history.at(-1)!.result.modifiers).flat().includes("Finale comeback +2")) stats.finaleComebacks++;
      const scores = Object.values(result.scores);
      for (let step = 2; step < result.scoreProgression.length; step++) {
        const playerIds = Object.keys(result.scores);
        const leader = (values: Record<string, number>) => [...playerIds].sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0) || playerIds.indexOf(a) - playerIds.indexOf(b))[0];
        if (leader(result.scoreProgression[step - 1]) !== leader(result.scoreProgression[step])) stats.leadChanges++;
      }
      const rankedScores = [...scores].sort((a,b) => b-a);
      if ((rankedScores[0] ?? 0) - (rankedScores[1] ?? 0) >= 15) stats.runaways++;
      expect(result.scoreProgression.at(-1)).toEqual(result.scores);
      expect(Object.values(result.chaos).every(amount => amount >= 0 && amount <= 8)).toBe(true);
      const highScore = Math.max(...scores);
      if (scores.filter((score) => score === highScore).length > 1) stats.tiedWinnerSessions++;
      stats.finalScoreMin = Math.min(stats.finalScoreMin, ...scores);
      stats.finalScoreMax = Math.max(stats.finalScoreMax, ...scores);

      if (index < 20) expect(runSeededSession(seed, playerCount)).toEqual(result);
    }

    expect(stats.sessions).toBe(sessionCount);
    expect(Object.values(stats.players).reduce((sum, count) => sum + count, 0)).toBe(sessionCount);
    expect(stats.uniqueLineups.size).toBeGreaterThan(100);
    expect(Object.values(stats.gameAppearances).every((count) => count > 0)).toBe(true);
    expect(stats.tiedWinnerSessions).toBeGreaterThan(0);
    expect(stats.finaleComebacks).toBeGreaterThan(0);
    expect(stats.powerUses).toBeGreaterThan(0);
    expect(stats.multiBeatGames).toBeGreaterThan(0);
    expect(stats.leadChanges).toBeGreaterThan(0);
    expect(stats.chaosEarned).toBeGreaterThan(stats.chaosSpent);
    expect(stats.finaleChaosPoints).toBeGreaterThan(0);
    expect(stats.powerSuccesses + stats.powerMisses).toBeGreaterThan(0);
    expect(stats.ruleActivations).toBeGreaterThan(0);
    expect(stats.selectedRules.size).toBeGreaterThanOrEqual(5);
    expect(Number.isFinite(stats.finalScoreMin) && Number.isFinite(stats.finalScoreMax)).toBe(true);

    const scoreDistribution = Object.fromEntries(Object.entries(stats.scoreContributionsByGame).map(([gameId, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      return [gameId, { actions: values.length, mean: values.length ? values.reduce((sum, score) => sum + score, 0) / values.length : null, median, negativeFrequency: values.length ? values.filter(value => value < 0).length / values.length : 0 }];
    }));
    const summary = {
      sessions: stats.sessions,
      players: stats.players,
      uniqueLineups: stats.uniqueLineups.size,
      gameAppearances: stats.gameAppearances,
      gameAppearancesByPlayers: stats.gameAppearancesByPlayers,
      scoreContributionsByGame: scoreDistribution,
      finalScoreRange: [stats.finalScoreMin, stats.finalScoreMax],
      tiedWinnerSessions: stats.tiedWinnerSessions,
      finaleComebacks: stats.finaleComebacks,
      powerUses: stats.powerUses,
      powerOutcomes: { successes: stats.powerSuccesses, misses: stats.powerMisses },
      chaos: { earned: stats.chaosEarned, spent: stats.chaosSpent, heldAtFinale: stats.chaosSaved, finalePoints: stats.finaleChaosPoints },
      multiBeatGames: stats.multiBeatGames,
      multiBeatByPlayers: stats.multiBeatByPlayers,
      leadChanges: stats.leadChanges,
      runawayGaps: stats.runaways,
      familyAdjacencyRepeats: stats.familyAdjacencyRepeats,
      ruleActivations: stats.ruleActivations,
      objectives: { assigned: stats.objectiveAssignments, completed: stats.completedObjectives, completionRate: stats.completedObjectives / stats.objectiveAssignments, rewardPoints: stats.objectiveRewards },
      houseRulesUsed: [...stats.selectedRules].sort(),
    };
    console.info("FULL_SESSION_SIMULATION", JSON.stringify(summary));
    if (process.env.SIMULATION_REPORT_DIR) {
      const directory = resolve(process.env.SIMULATION_REPORT_DIR);
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, `balance-${sessionCount}.json`), `${JSON.stringify(summary, null, 2)}\n`);
      const lines = [
        `# Deterministic balance matrix: ${summary.sessions.toLocaleString()} sessions`,
        "",
        `Synthetic sessions covered 2–8 players and produced ${summary.uniqueLineups.toLocaleString()} distinct six-game lineups.`,
        "",
        `- Multi-beat appearances: ${summary.multiBeatGames.toLocaleString()} (${(summary.multiBeatGames / (summary.sessions * 6) * 100).toFixed(1)}% of game slots)`,
        `- Lead changes: ${summary.leadChanges.toLocaleString()}`,
        `- Sessions with a 15+ point runaway gap: ${summary.runawayGaps.toLocaleString()} (${(summary.runawayGaps / summary.sessions * 100).toFixed(1)}%)`,
        `- Finale comeback bonus: ${summary.finaleComebacks.toLocaleString()} sessions`,
        `- Chaos earned / spent / held: ${summary.chaos.earned.toLocaleString()} / ${summary.chaos.spent.toLocaleString()} / ${summary.chaos.heldAtFinale.toLocaleString()}`,
        `- Chaos finale points: ${summary.chaos.finalePoints.toLocaleString()}`,
        `- Power uses and success / miss outcomes: ${summary.powerUses.toLocaleString()} / ${summary.powerOutcomes.successes.toLocaleString()} / ${summary.powerOutcomes.misses.toLocaleString()}`,
        `- Objectives completed: ${summary.objectives.completed.toLocaleString()} / ${summary.objectives.assigned.toLocaleString()} (${(summary.objectives.completionRate * 100).toFixed(1)}%)`,
        `- Rule activations: ${summary.ruleActivations.toLocaleString()}; rules observed: ${summary.houseRulesUsed.join(", ")}`,
        `- Final score range: ${summary.finalScoreRange.join("–")}`,
        "",
        "## Game selection counts",
        "",
        ...Object.entries(summary.gameAppearances).map(([game, count]) => `- ${game}: ${count.toLocaleString()} / ${(summary.sessions * 6).toLocaleString()} slots (${(count / (summary.sessions * 6) * 100).toFixed(1)}%)`),
        "",
        "## Score contribution by game",
        "",
        ...Object.entries(summary.scoreContributionsByGame).map(([game, row]) => `- ${game}: mean ${row.mean?.toFixed(2)}, median ${row.median}, negative ${(row.negativeFrequency * 100).toFixed(1)}% of player-game outcomes`),
        "",
        "These are descriptive outputs from a deterministic synthetic policy, not estimates of human enjoyment or statistical significance. Review game appearance by player count in the JSON output. No composite quality score is calculated.",
        "",
      ];
      writeFileSync(resolve(directory, `balance-${sessionCount}.md`), `${lines.join("\n")}\n`);
    }
  }, 240_000);
});
