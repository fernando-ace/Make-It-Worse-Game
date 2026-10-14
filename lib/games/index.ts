import type { GameEvent, MinigameDefinition, MinigameResolution, Player } from "../types";
import { MAKE_IT_WORSE_PROMPTS, TRUST_ME_OPTIONS } from "./content";

function emptyResult(choices: Record<string, string>, points: Record<string, number>, reasons: Record<string, string>, reveal: string, events: GameEvent[] = []): Omit<MinigameResolution, "points" | "modifiers" | "optionCounts"> {
  return { choices, basePoints: points, reasons, reveal, events };
}

export const splitDecision: MinigameDefinition = {
  id: "split-decision",
  displayName: "Split Decision",
  instructions: "Choose the side you think fewer friends will pick. Your choice stays secret until the reveal.",
  options: () => [{ id: "RED", label: "RED" }, { id: "BLUE", label: "BLUE" }],
  config: ({ players, gameNumber }) => ({ title: "Pick your side.", prompt: "Choose the color you think the fewest people will choose.", options: splitDecision.options({ players, gameNumber }), scoreHint: "Minority pick: +2. A tie: +1 each. Pick the majority: −1." }),
  validate: (choice, { config }) => config.options.some((option) => option.id === choice),
  resolve({ players, submissions }) {
    const counts = Object.fromEntries(["RED", "BLUE"].map((id) => [id, players.filter((player) => submissions[player.id] === id).length]));
    const tied = counts.RED === counts.BLUE;
    const minority = tied ? null : counts.RED < counts.BLUE ? "RED" : "BLUE";
    const base: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    for (const player of players) {
      const choice = submissions[player.id];
      base[player.id] = !choice ? 0 : tied ? 1 : choice === minority ? 2 : -1;
      reasons[player.id] = !choice ? "No pick before time ran out." : tied ? "The room split evenly." : choice === minority ? "You read the room and picked the minority." : "You picked the crowded side. −1.";
    }
    const events = players.filter((player) => submissions[player.id]).flatMap((player): GameEvent[] => {
      const accurate = tied || submissions[player.id] === minority;
      return [{ type: "read", playerId: player.id, accurate }, ...(!accurate ? [{ type: "chaos", playerId: player.id } as const] : [])];
    });
    return { ...emptyResult(submissions, base, reasons, tied ? "Perfectly split." : `${minority} was the minority.`, events), optionCounts: counts };
  },
};

export const makeItWorse: MinigameDefinition = {
  id: "make-it-worse",
  displayName: "Make It Worse",
  instructions: "Pick the escalation you think your friends will choose most. Read the room; the reveal decides the points.",
  options: ({ gameNumber }) => {
    const prompt = MAKE_IT_WORSE_PROMPTS[(gameNumber - 1) % MAKE_IT_WORSE_PROMPTS.length];
    return prompt.options.map((label, index) => ({ id: `${prompt.id}-${index}`, label }));
  },
  config: ({ gameNumber }) => {
    const prompt = MAKE_IT_WORSE_PROMPTS[(gameNumber - 1) % MAKE_IT_WORSE_PROMPTS.length];
    return { title: "What makes it worse?", prompt: prompt.prompt, promptId: prompt.id, options: prompt.options.map((label, index) => ({ id: `${prompt.id}-${index}`, label })), scoreHint: "Pick a crowd favorite: +2. Miss the room: −1." };
  },
  validate: (choice, { config }) => config.options.some((option) => option.id === choice),
  resolve({ players, submissions, config }) {
    const optionCounts = Object.fromEntries(config.options.map(({ id }) => [id, players.filter((player) => submissions[player.id] === id).length]));
    const max = Math.max(0, ...Object.values(optionCounts));
    const topIds = new Set(Object.entries(optionCounts).filter(([, count]) => count === max && count > 0).map(([id]) => id));
    const base = Object.fromEntries(players.map((player) => [player.id, !submissions[player.id] ? 0 : topIds.has(submissions[player.id]) ? 2 : -1]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, !submissions[player.id] ? "No pick before time ran out." : topIds.has(submissions[player.id]) ? "You read the room: your pick tied for the crowd favorite." : "The room went for a different escalation. −1."]));
    const topLabels = config.options.filter(({ id }) => topIds.has(id)).map(({ label }) => `“${label}”`);
    const events = players.filter((player) => submissions[player.id]).flatMap((player): GameEvent[] => {
      const accurate = topIds.has(submissions[player.id]);
      return [{ type: "read", playerId: player.id, accurate }, ...(!accurate ? [{ type: "chaos", playerId: player.id } as const] : [])];
    });
    return { ...emptyResult(submissions, base, reasons, topLabels.length ? `The room made it worse with ${topLabels.join(" / ")}.` : "Nobody picked an escalation." , events), optionCounts };
  },
};

export const trustMe: MinigameDefinition = {
  id: "trust-me",
  displayName: "Trust Me",
  instructions: "A bag of surprise cash is on the table. Pick your move in secret; the group decides who walks away smiling.",
  options: () => TRUST_ME_OPTIONS.map((option) => ({ ...option })),
  config: () => ({ title: "There’s a bag on the table.", prompt: "It only works if the group can trust each other. What’s your move?", options: TRUST_ME_OPTIONS.map((option) => ({ ...option })), scoreHint: "Pool: +3 each only if everyone pools. Pocket: safe +1. Risk: +3 if another risks too, otherwise −1. Swipe: +2 if anyone pools." }),
  validate: (choice) => TRUST_ME_OPTIONS.some((option) => option.id === choice),
  resolve({ players, submissions, config }) {
    const optionCounts = Object.fromEntries(config.options.map(({ id }) => [id, players.filter((player) => submissions[player.id] === id).length]));
    const swiped = optionCounts.swipe > 0;
    const pooled = optionCounts.pool > 0;
    const base: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    const events: GameEvent[] = [];
    for (const player of players) {
      const choice = submissions[player.id];
      if (choice === "pool") {
        base[player.id] = !swiped && optionCounts.pool === players.length ? 3 : 0;
        reasons[player.id] = swiped ? "Someone swiped the bag; the pool came up empty." : optionCounts.pool === players.length ? "Everyone trusted the pool. +3." : "The group split; the pool did not pay out.";
      } else if (choice === "pocket") { base[player.id] = 1; reasons[player.id] = "You took the guaranteed point."; }
      else if (choice === "risk") {
        const won = optionCounts.risk >= 2;
        base[player.id] = won ? 3 : -1;
        reasons[player.id] = won ? "Someone else risked it too. +3." : "You were the only one to risk it. −1.";
        events.push({ type: "gamble", playerId: player.id, result: won ? "won" : "lost" });
      } else if (choice === "swipe") {
        base[player.id] = pooled ? 2 : 0;
        reasons[player.id] = pooled ? "You swiped while someone pooled. +2." : "No one pooled, so there was nothing to swipe.";
        events.push({ type: "betrayal", playerId: player.id }, { type: "chaos", playerId: player.id });
      } else { base[player.id] = 0; reasons[player.id] = "No move before time ran out."; }
    }
    const reveal = swiped ? "Someone broke the trust. The pool was gone." : optionCounts.pool === players.length ? "Everybody trusted the group. Everybody wins." : "The bag split the room.";
    return { ...emptyResult(submissions, base, reasons, reveal, events), optionCounts };
  },
};

export const pileOn: MinigameDefinition = {
  id: "pile-on",
  displayName: "Pile On",
  instructions: "Spend your spotlight: call out one friend, duck for cover, or take a safe point. All moves land together.",
  options: ({ players }) => [
    ...players.filter((player) => player.id !== `__none__`).map((player) => ({ id: `target:${player.id}`, label: `CALL OUT ${player.name}`, detail: "A hit scores 1; each target can only take two hits." })),
    { id: "shield", label: "DUCK FOR COVER", detail: "Block the first callout aimed at you." },
    { id: "cash", label: "TAKE A SAFE POINT", detail: "Keep your head down and bank 1." },
  ],
  config: ({ players, gameNumber }) => ({ title: "Spend your spotlight.", prompt: "Call out one friend, duck for cover, or take a safe point. Nobody sees the pile-on until everyone commits.", options: pileOn.options({ players, gameNumber }), scoreHint: "A callout scores 1 if it lands; the first hit on each person is blocked by a shield. Targets take 1 per hit, up to 2." }),
  validate: (choice, { players, playerId, config }) => config.options.some((option) => option.id === choice) && (!choice.startsWith("target:") || (choice.slice(7) !== playerId && players.some((player) => player.id === choice.slice(7)))),
  resolve({ players, submissions }) {
    const targetCounts: Record<string, number> = Object.fromEntries(players.map(({ id }) => [id, 0]));
    for (const choice of Object.values(submissions)) if (choice.startsWith("target:")) targetCounts[choice.slice(7)]++;
    const shields = new Set(players.filter((player) => submissions[player.id] === "shield").map(({ id }) => id));
    const optionCounts: Record<string, number> = Object.fromEntries(players.map(({ id }) => [id, 0]));
    for (const choice of Object.values(submissions)) optionCounts[choice] = (optionCounts[choice] ?? 0) + 1;
    const base: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    const events: GameEvent[] = [];
    for (const player of players) {
      const choice = submissions[player.id];
      if (choice.startsWith("target:")) {
        const targetId = choice.slice(7);
        const hit = Math.min(2, Math.max(0, targetCounts[targetId] - (shields.has(targetId) ? 1 : 0)));
        base[player.id] = hit ? 1 : 0;
        reasons[player.id] = hit ? `Your callout landed. ${players.find((p) => p.id === targetId)?.name ?? "Your target"} took ${hit} hit${hit === 1 ? "" : "s"}.` : "Your target ducked the pile-on.";
        events.push({ type: "target", actorId: player.id, targetId }, { type: "chaos", playerId: player.id });
      } else if (choice === "shield") {
        const hit = targetCounts[player.id] > 0;
        base[player.id] = hit ? 0 : 0;
        reasons[player.id] = hit ? "You dodged a callout." : "You kept your shield in your pocket.";
      } else if (choice === "cash") { base[player.id] = 1; reasons[player.id] = "You took the safe point."; }
      else { base[player.id] = 0; reasons[player.id] = "No move before time ran out."; }
      if (choice !== "shield" && choice !== "cash" && targetCounts[player.id] > 0) {
        const hits = Math.min(2, targetCounts[player.id] - (shields.has(player.id) ? 1 : 0));
        base[player.id] -= Math.max(0, hits);
        if (hits) reasons[player.id] += ` Pile-on: −${hits}.`;
      }
    }
    const attacked = Object.values(targetCounts).some((count) => count > 0);
    return { ...emptyResult(submissions, base, reasons, attacked ? "The callouts landed all at once." : "Nobody called anyone out.", events), optionCounts };
  },
};

export const secretHandshake: MinigameDefinition = {
  id: "secret-handshake",
  displayName: "Secret Handshake",
  instructions: "Pick one friend to trust with a secret pact. A mutual reach pays both; a one-sided reach leaves someone exposed.",
  options: ({ players }) => [
    ...players.map((player) => ({ id: `reach:${player.id}`, label: `REACH FOR ${player.name}`, detail: "A mutual pact pays 3 each." })),
    { id: "solo", label: "GO SOLO", detail: "No pact, no risk." },
  ],
  config: ({ players }) => ({ title: "Who would reach back?", prompt: "Choose one person for a private pact, or go solo. Nobody sees the pact until every hand is shown.", options: secretHandshake.options({ players, gameNumber: 0 }), scoreHint: "Mutual pact: +3 each. A one-sided reach: the reaching player −1, the person they picked +1." }),
  validate: (choice, { players, playerId }) => choice === "solo" || (choice.startsWith("reach:") && choice.slice(6) !== playerId && players.some((player) => player.id === choice.slice(6))),
  resolve({ players, submissions }) {
    const base: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    const events: GameEvent[] = [];
    const reciprocal = new Set<string>();
    for (const player of players) {
      const targetId = submissions[player.id]?.startsWith("reach:") ? submissions[player.id].slice(6) : "";
      if (targetId && submissions[targetId] === `reach:${player.id}`) reciprocal.add(player.id);
    }
    for (const player of players) {
      const choice = submissions[player.id];
      const targetId = choice?.startsWith("reach:") ? choice.slice(6) : "";
      if (!targetId) { base[player.id] = 0; reasons[player.id] = choice === "solo" ? "You kept your hands clean." : "No pact before time ran out."; continue; }
      const mutual = reciprocal.has(player.id);
      if (mutual) { base[player.id] = 3; reasons[player.id] = `The pact was mutual with ${players.find((item) => item.id === targetId)?.name ?? "your friend"}. +3.`; }
      else { base[player.id] = -1; reasons[player.id] = `${players.find((item) => item.id === targetId)?.name ?? "Your friend"} reached elsewhere. −1.`; }
      events.push({ type: "alliance", playerId: player.id, targetId, mutual });
      if (!mutual) events.push({ type: "betrayed", playerId: targetId, targetId: player.id }, { type: "chaos", playerId: player.id });
    }
    for (const player of players) {
      const incoming = players.filter((sender) => submissions[sender.id] === `reach:${player.id}`);
      for (const sender of incoming) if (!reciprocal.has(sender.id)) {
        base[player.id] = (base[player.id] ?? 0) + 1;
        reasons[player.id] = `${reasons[player.id] ?? ""} ${sender.name} reached for you; you got +1.`.trim();
      }
    }
    const pairs = players.filter((player) => reciprocal.has(player.id) && player.id < submissions[player.id].slice(6)).map((player) => `${player.name} + ${players.find((item) => item.id === submissions[player.id].slice(6))?.name ?? "friend"}`);
    const reveal = pairs.length ? `The pact held: ${pairs.join(", ")}.` : "Nobody made a mutual pact.";
    return { choices: submissions, basePoints: base, reasons, reveal, events };
  },
};

export const hotPotato: MinigameDefinition = {
  id: "hot-potato",
  displayName: "Hot Potato",
  instructions: "Pass the mess to one friend or take the heat yourself. A pass only pays if your target sends it to somebody else.",
  options: ({ players }) => [
    ...players.map((player) => ({ id: `pass:${player.id}`, label: `PASS TO ${player.name}`, detail: "Earn 2 if they pass it forward." })),
    { id: "hold", label: "TAKE THE HEAT", detail: "Earn 1, then lose 1 per pass aimed at you (max 2)." },
  ],
  config: ({ players }) => ({ title: "The mess is getting hot.", prompt: "Pass it to one friend or hold it. A pass back earns nothing. All passes land together.", options: hotPotato.options({ players, gameNumber: 0 }), scoreHint: "Pass: +2 if your target passes to someone else; a pass back earns nothing. Hold: +1, then −1 per pass received (up to −2)." }),
  validate: (choice, { players, playerId }) => choice === "hold" || (choice.startsWith("pass:") && choice.slice(5) !== playerId && players.some((player) => player.id === choice.slice(5))),
  resolve({ players, submissions }) {
    const incoming = Object.fromEntries(players.map((player) => [player.id, players.filter((sender) => submissions[sender.id] === `pass:${player.id}`)]));
    const base: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    const events: GameEvent[] = [];
    for (const player of players) {
      const choice = submissions[player.id];
      const targetId = choice?.startsWith("pass:") ? choice.slice(5) : "";
      const received = incoming[player.id].length;
      if (targetId) {
        const escaped = Boolean(submissions[targetId]?.startsWith("pass:") && submissions[targetId] !== `pass:${player.id}`);
        base[player.id] = escaped ? 2 : 0;
        reasons[player.id] = escaped ? `You passed it to ${players.find((item) => item.id === targetId)?.name ?? "a friend"}; they passed it forward. +2.` : submissions[targetId]?.startsWith("pass:") ? `${players.find((item) => item.id === targetId)?.name ?? "Your target"} sent it straight back. No points.` : `${players.find((item) => item.id === targetId)?.name ?? "Your target"} held the heat, so your pass paid nothing.`;
        events.push({ type: "target", actorId: player.id, targetId }, { type: "chaos", playerId: player.id });
      } else if (choice === "hold") {
        const penalty = Math.min(2, received);
        base[player.id] = 1 - penalty;
        reasons[player.id] = `You took the heat: +1${penalty ? `, then −${penalty} for incoming passes` : ", with no passes aimed at you"}.`;
      } else { base[player.id] = 0; reasons[player.id] = "No move before time ran out."; }
    }
    for (const player of players) for (const sender of incoming[player.id]) {
      if (submissions[player.id] === "hold") events.push({ type: "betrayed", playerId: player.id, targetId: sender.id });
    }
    const holders = players.filter((player) => submissions[player.id] === "hold");
    const reveal = holders.length ? `${holders.map((player) => player.name).join(", ")} took the heat.` : "Nobody held the hot potato.";
    return { choices: submissions, basePoints: base, reasons, reveal, events };
  },
};

export const MINIGAMES: Record<string, MinigameDefinition> = Object.fromEntries([splitDecision, makeItWorse, trustMe, pileOn, secretHandshake, hotPotato].map((game) => [game.id, game]));

export function registerMinigame(definition: MinigameDefinition) {
  if (!definition.id.trim() || MINIGAMES[definition.id]) throw new Error("A minigame with that ID is already registered");
  MINIGAMES[definition.id] = definition;
}

export function resolveAwards(history: Array<{ result: MinigameResolution }>, players: Player[]) {
  const candidates: Array<{ id: "most-targeted" | "biggest-gambler" | "best-read" | "worst-ally" | "chaos-agent" | "most-betrayed" | "best-ally"; name: string; count: (playerId: string) => number; detail: string }> = [
    { id: "most-targeted", name: "Most Targeted", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "target" && event.targetId === id).length, detail: "callouts received" },
    { id: "biggest-gambler", name: "Biggest Gambler", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "gamble" && event.playerId === id).length, detail: "double-or-nothing risks" },
    { id: "best-read", name: "Best Read", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "read" && event.playerId === id && event.accurate).length, detail: "crowd favorites called" },
    { id: "worst-ally", name: "Worst Ally", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "betrayal" ? event.playerId === id : event.type === "betrayed" && event.targetId === id).length, detail: "betrayals and dirty moves" },
    { id: "chaos-agent", name: "Chaos Agent", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "chaos" && event.playerId === id).length, detail: "moves that shook the room" },
    { id: "most-betrayed", name: "Most Betrayed", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "betrayed" && event.playerId === id).length, detail: "times left holding the bag" },
    { id: "best-ally", name: "Best Ally", count: (id) => history.flatMap((item) => item.result.events).filter((event) => event.type === "alliance" && event.mutual && event.playerId === id && event.playerId < event.targetId).length, detail: "mutual pacts made" },
  ];
  return candidates.flatMap((award) => {
    const ranked = players.map((player, index) => ({ player, count: award.count(player.id), index })).sort((a, b) => b.count - a.count || a.index - b.index);
    const leader = ranked[0];
    return leader && leader.count > 0 ? [{ id: award.id, name: award.name, playerId: leader.player.id, count: leader.count, detail: award.detail }] : [];
  });
}
