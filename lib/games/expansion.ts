import type { GameEvent, MinigameDefinition, MinigameResolution } from "../types";

function result(choices: Record<string, string>, points: Record<string, number>, reasons: Record<string, string>, reveal: string, events: GameEvent[] = []): Omit<MinigameResolution, "points" | "modifiers" | "optionCounts"> {
  return { choices, basePoints: points, reasons, reveal, events };
}

export const groupTab: MinigameDefinition = {
  id: "group-tab", displayName: "The Group Tab", interaction: "negotiate", finaleSuitable: true, difficulty: 1, expansion: true,
  instructions: "The room has one tab to split. Share, grab a little extra, or burn your own receipt.",
  options: () => [{ id: "share", label: "SPLIT IT FAIR", detail: "A majority share earns 2." }, { id: "grab", label: "TAKE THE BIG SLICE", detail: "Earn 3 if anyone chooses to share." }, { id: "burn", label: "BURN YOUR RECEIPT", detail: "A safe point, even if the deal falls apart." }],
  config: ({ players }) => ({ title: "Who pays for the last round?", prompt: `There are ${players.length} friends and one very suspicious bill. Decide what the group deserves.`, options: groupTab.options({ players, gameNumber: 0 }), scoreHint: "A majority choosing Split earns +2. Grab earns +3 if anyone shares; otherwise 0. Burn always earns +1 and prevents a Grab payout if nobody shares." }),
  validate: (choice, { config }) => config.options.some((option) => option.id === choice),
  resolve({ players, submissions }) {
    const counts = Object.fromEntries(["share", "grab", "burn"].map((id) => [id, players.filter((p) => submissions[p.id] === id).length]));
    const majority = counts.share >= Math.ceil(players.length / 2);
    const hasShare = counts.share > 0;
    const points: Record<string, number> = {}; const reasons: Record<string, string> = {}; const events: GameEvent[] = [];
    for (const player of players) {
      const choice = submissions[player.id];
      if (choice === "share") { points[player.id] = majority ? 2 : 0; reasons[player.id] = majority ? "Enough friends split the bill. +2." : "Not enough friends shared the tab."; }
      else if (choice === "grab") { points[player.id] = hasShare ? 3 : 0; reasons[player.id] = hasShare ? "You grabbed extra while someone shared. +3." : "Nobody shared, so there was no big slice to take."; events.push({ type: "betrayal", playerId: player.id }); }
      else if (choice === "burn") { points[player.id] = 1; reasons[player.id] = "You burned your receipt and kept a safe point."; }
      else { points[player.id] = 0; reasons[player.id] = "No decision before time ran out."; }
    }
    return { ...result(submissions, points, reasons, majority ? "The majority split the tab." : "The room could not agree to share.", events), optionCounts: counts };
  },
};

export const escalationLadder: MinigameDefinition = {
  id: "escalation-ladder", displayName: "Escalation Ladder", interaction: "risk", finaleSuitable: true, difficulty: 2, expansion: true,
  instructions: "Choose how far to take the risk. A bold call pays only when at least one other person joins you.",
  options: () => [1, 2, 3].map((stake) => ({ id: `stake:${stake}`, label: `RISK ${stake}`, detail: stake === 1 ? "Small upside, easy to match." : `Earn ${stake + 1} if someone matches; otherwise lose ${stake}.` })),
  config: ({ players }) => ({ title: "How far are you willing to go?", prompt: `${players.length} people are watching. Lock in a risk level; matching is the only thing that makes the bigger bets safe.`, options: escalationLadder.options({ players, gameNumber: 0 }), scoreHint: "Risk 1 earns +1. Risk 2 earns +3 if matched, otherwise −2. Risk 3 earns +4 if matched, otherwise −3. A matching choice shares the payoff; successful bets emit a gamble event." }),
  validate: (choice, { config }) => config.options.some((option) => option.id === choice),
  resolve({ players, submissions, config }) {
    const counts = Object.fromEntries(config.options.map(({ id }) => [id, players.filter((p) => submissions[p.id] === id).length]));
    const points: Record<string, number> = {}; const reasons: Record<string, string> = {}; const events: GameEvent[] = [];
    for (const player of players) {
      const choice = submissions[player.id]; const stake = Number(choice?.slice(6)); const matched = stake === 1 || counts[choice] > 1;
      points[player.id] = !choice ? 0 : stake === 1 ? 1 : matched ? stake + 1 : -stake;
      reasons[player.id] = !choice ? "No risk before time ran out." : stake === 1 ? "You took the steady +1." : matched ? `Someone matched your risk ${stake}. +${stake + 1}.` : `Your risk ${stake} had no backup. −${stake}.`;
      if (stake > 1) events.push({ type: "gamble", playerId: player.id, result: matched ? "won" : "lost" });
    }
    return { ...result(submissions, points, reasons, "The risk levels are on the table.", events), optionCounts: counts };
  },
};

export const bluffCheck: MinigameDefinition = {
  id: "bluff-check", displayName: "Bluff Check", interaction: "read", finaleSuitable: true, difficulty: 1, expansion: true,
  instructions: "Everyone makes the same suspicious claim. Decide whether to stand by it or call the room's bluff.",
  options: () => [{ id: "claim", label: "TOTALLY TRUE", detail: "Earn 2 if nobody challenges." }, { id: "challenge", label: "CALL THE BLUFF", detail: "Earn 2 if anyone stands by the claim." }],
  config: ({ players }) => ({ title: "The story sounds fake.", prompt: `Someone says ${players.length} friends all agreed on the same thing. Do you back the claim or challenge it?`, options: bluffCheck.options({ players, gameNumber: 0 }), scoreHint: "A claim earns +2 if nobody challenges, otherwise −1. A challenge earns +2 when at least one person claims; if everyone challenges, each challenger gets +1." }),
  validate: (choice, { config }) => config.options.some((option) => option.id === choice),
  resolve({ players, submissions }) {
    const claims = players.filter((p) => submissions[p.id] === "claim").length; const challenges = players.length - claims;
    const points = Object.fromEntries(players.map((p) => [p.id, submissions[p.id] === "claim" ? challenges === 0 ? 2 : -1 : claims > 0 ? 2 : 1]));
    const reasons = Object.fromEntries(players.map((p) => [p.id, !submissions[p.id] ? "No answer before time ran out." : submissions[p.id] === "claim" ? challenges === 0 ? "Nobody called the bluff. +2." : "The room challenged the story. −1." : claims > 0 ? "You caught someone standing by the claim. +2." : "Everyone challenged; the safe read earns +1." ]));
    const events = players.filter((p) => submissions[p.id]).map((p): GameEvent => ({ type: "read", playerId: p.id, accurate: submissions[p.id] === "claim" ? challenges === 0 : claims > 0 }));
    return { ...result(submissions, points, reasons, claims ? `${claims} stood by the story; ${challenges} challenged it.` : "Nobody backed the story.", events), optionCounts: { claim: claims, challenge: challenges } };
  },
};

export const favorBank: MinigameDefinition = {
  id: "favor-bank", displayName: "Favor Bank", interaction: "alliance", finaleSuitable: true, difficulty: 2, expansion: true,
  instructions: "Call in a favor from one friend. A returned favor pays both; a one-sided ask leaves a very public IOU.",
  options: ({ players }) => [{ id: "keep", label: "KEEP YOUR OWN COUNSEL", detail: "No favor, no debt." }, ...players.map((p) => ({ id: `favor:${p.id}`, label: `BACK ${p.name}`, detail: "A returned favor earns 3 each." }))],
  config: ({ players }) => ({ title: "Who owes you one?", prompt: "Call in a favor or keep your own counsel. Every favor is private until the whole bank opens.", options: favorBank.options({ players, gameNumber: 0 }), scoreHint: "A mutual favor earns +3 each. An unanswered favor costs the asker 1 and gives the target +1 for the social capital." }),
  validate: (choice, { players, playerId, config }) => config.options.some((option) => option.id === choice) && (!choice.startsWith("favor:") || choice.slice(6) !== playerId && players.some((p) => p.id === choice.slice(6))),
  resolve({ players, submissions }) {
    const points: Record<string, number> = {}; const reasons: Record<string, string> = {}; const events: GameEvent[] = [];
    const counts = Object.fromEntries(players.map((p) => [p.id, 0]));
    for (const player of players) {
      const target = submissions[player.id]?.startsWith("favor:") ? submissions[player.id].slice(6) : "";
      if (!target) { points[player.id] = 0; reasons[player.id] = submissions[player.id] === "keep" ? "You kept your own counsel." : "No favor was called."; continue; }
      counts[target]++;
      const mutual = submissions[target] === `favor:${player.id}`;
      points[player.id] = mutual ? 3 : -1;
      reasons[player.id] = mutual ? `The favor came back from ${players.find((p) => p.id === target)?.name}. +3.` : `${players.find((p) => p.id === target)?.name} did not return the favor. −1.`;
      events.push({ type: "alliance", playerId: player.id, targetId: target, mutual });
      if (!mutual) events.push({ type: "betrayed", playerId: target, targetId: player.id });
    }
    for (const player of players) for (const asker of players) if (submissions[asker.id] === `favor:${player.id}` && submissions[player.id] !== `favor:${asker.id}`) {
      points[player.id] = (points[player.id] ?? 0) + 1; reasons[player.id] += " An unanswered favor still earned +1 social capital.";
    }
    return { ...result(submissions, points, reasons, "Every favor and IOU is now on the table.", events), optionCounts: { ...counts, keep: players.filter((p) => submissions[p.id] === "keep").length } };
  },
};

export const EXPANSION_GAMES: MinigameDefinition[] = [groupTab, escalationLadder, bluffCheck, favorBank];
