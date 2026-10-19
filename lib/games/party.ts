import type { GameEvent, MinigameDefinition, MinigameResolution } from "../types";

function makeResult(choices: Record<string, string>, points: Record<string, number>, reasons: Record<string, string>, reveal: string, events: GameEvent[] = []): Omit<MinigameResolution, "points" | "modifiers" | "optionCounts"> {
  return { choices, basePoints: points, reasons, reveal, events };
}
function counts(players: { id: string }[], submissions: Record<string, string>, options: string[]) {
  return Object.fromEntries(options.map((id) => [id, players.filter((player) => submissions[player.id] === id).length]));
}
const bidOptions = [0, 1, 2, 3].map((bid) => ({ id: `bid:${bid}`, label: bid === 0 ? "PASS" : `BID ${bid}`, detail: bid === 0 ? "Keep your score safe." : "You pay this even if someone outbids you." }));
export const auctionHouse: MinigameDefinition = {
  id: "auction-house", displayName: "Auction House", interaction: "risk", finaleSuitable: true, difficulty: 2, expansion: true,
  instructions: "Bid in secret for one prize; the highest unique bidder wins, but every bid costs points.",
  options: () => bidOptions,
  config: () => ({ title: "One prize. No second chances.", prompt: "Bid secretly. The highest unique bid takes the prize; every bid is paid whether it wins or not.", options: bidOptions, scoreHint: "A unique high bid earns 5 minus your bid. All other bids lose their bid amount. Passing costs nothing." }),
  validate: (choice) => bidOptions.some((option) => option.id === choice),
  resolve({ players, submissions }) {
    const bids = Object.fromEntries(players.map((player) => [player.id, Number(submissions[player.id]?.slice(4) ?? 0)]));
    const highest = Math.max(0, ...Object.values(bids));
    const winners = highest > 0 ? players.filter((player) => bids[player.id] === highest) : [];
    const uniqueWinner = winners.length === 1 ? winners[0].id : null;
    const points = Object.fromEntries(players.map((player) => [player.id, uniqueWinner === player.id ? 5 - bids[player.id] : -bids[player.id]]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, !bids[player.id] ? "You passed and kept your points." : uniqueWinner === player.id ? `Your unique bid of ${bids[player.id]} won the prize. +${5 - bids[player.id]}.` : winners.length > 1 && bids[player.id] === highest ? `The high bid tied. Your ${bids[player.id]} point bid is lost.` : `Your bid of ${bids[player.id]} did not win. −${bids[player.id]}.` ]));
    const events = players.filter((player) => bids[player.id] > 0).map((player): GameEvent => ({ type: "gamble", playerId: player.id, result: uniqueWinner === player.id ? "won" : "lost" }));
    return { ...makeResult(submissions, points, reasons, uniqueWinner ? `${players.find((player) => player.id === uniqueWinner)?.name} won the prize.` : highest ? "The prize went unclaimed after a tied bid." : "Nobody bid on the prize.", events), optionCounts: counts(players, submissions, bidOptions.map((option) => option.id)) };
  },
};

export const lifeline: MinigameDefinition = {
  id: "lifeline", displayName: "Lifeline", interaction: "alliance", finaleSuitable: true, difficulty: 2, expansion: true,
  instructions: "Give your lifeline to one friend; the most-supported players are protected and their supporters get a point.",
  options: ({ players }) => players.map((player) => ({ id: `save:${player.id}`, label: `SAVE ${player.name}`, detail: "Top-supported players gain 2; their supporters gain 1." })),
  config: ({ players }) => ({ title: "Someone gets a lifeline.", prompt: "Choose one person to protect. Your vote stays private until every lifeline lands.", options: lifeline.options({ players, gameNumber: 0 }), scoreHint: "Each player with the most save votes gains +2. Anyone who voted for a top-supported player gains +1." }),
  validate: (choice, { players }) => choice.startsWith("save:") && players.some((player) => player.id === choice.slice(5)),
  resolve({ players, submissions }) {
    const votes = Object.fromEntries(players.map((player) => [player.id, players.filter((voter) => submissions[voter.id] === `save:${player.id}`).length]));
    const high = Math.max(0, ...Object.values(votes));
    const protectedIds = new Set(players.filter((player) => votes[player.id] === high && high > 0).map((player) => player.id));
    const points = Object.fromEntries(players.map((player) => [player.id, (protectedIds.has(player.id) ? 2 : 0) + (protectedIds.has(submissions[player.id]?.slice(5) ?? "") ? 1 : 0)]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, `${protectedIds.has(player.id) ? "You received a lifeline. +2. " : ""}${protectedIds.has(submissions[player.id]?.slice(5) ?? "") ? "Your vote backed a protected player. +1." : "Your vote did not land on a protected player."}`.trim()]));
    const events = players.flatMap((player): GameEvent[] => {
      const targetId = submissions[player.id]?.slice(5);
      return targetId && players.some((candidate) => candidate.id === targetId) ? [{ type: "save", actorId: player.id, targetId, successful: protectedIds.has(targetId) }] : [];
    });
    return { ...makeResult(submissions, points, reasons, protectedIds.size ? `${[...protectedIds].map((id) => players.find((player) => player.id === id)?.name).join(" and ")} got the lifeline.` : "No lifeline was cast.", events), optionCounts: votes };
  },
};

const effortOptions = [0, 1, 2].map((effort) => ({ id: `effort:${effort}`, label: ["SKIP", "HELP", "CARRY"][effort], detail: ["If the project fails, skipping earns +1.", "A successful project earns +2; failure costs 1.", "A successful project earns +3; failure costs 2."][effort] }));
export const groupProject: MinigameDefinition = {
  id: "group-project", displayName: "Group Project", interaction: "negotiate", finaleSuitable: true, difficulty: 2, expansion: true,
  instructions: "Choose how much effort to contribute; the whole group succeeds or fails together.",
  options: () => effortOptions,
  config: ({ players }) => ({ title: "The deadline is tonight.", prompt: `${players.length} people, one group project. Secretly choose how much effort you will put in.`, options: effortOptions, scoreHint: `The group needs ${Math.ceil(players.length * 1.5)} effort. If it succeeds, HELP earns +2 and CARRY +3. If it fails, helpers lose 1, carriers lose 2, and skippers earn +1.` }),
  validate: (choice) => effortOptions.some((option) => option.id === choice),
  resolve({ players, submissions }) {
    const effort = Object.fromEntries(players.map((player) => [player.id, Number(submissions[player.id]?.slice(7) ?? 0)]));
    const total = Object.values(effort).reduce((sum, value) => sum + value, 0);
    const success = total >= Math.ceil(players.length * 1.5);
    const points = Object.fromEntries(players.map((player) => [player.id, success ? effort[player.id] ? effort[player.id] + 1 : 0 : effort[player.id] ? -effort[player.id] : 1]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, success ? effort[player.id] ? `The group project cleared the bar. Your effort earned +${effort[player.id] + 1}.` : "The project succeeded while you skipped; no points this time." : effort[player.id] ? `The project missed the bar. Your effort cost ${effort[player.id]}.` : "The project missed the bar; your skip earned +1."]));
    const events = players.filter((player) => effort[player.id] > 0).map((player): GameEvent => ({ type: "contribution", playerId: player.id, effort: effort[player.id], successful: success }));
    return { ...makeResult(submissions, points, reasons, success ? `The group contributed ${total}; the project made it.` : `The group contributed ${total}; the project missed its ${Math.ceil(players.length * 1.5)} effort target.`, events), optionCounts: counts(players, submissions, effortOptions.map((option) => option.id)) };
  },
};

export const prisonersDilemma: MinigameDefinition = {
  id: "prisoners-dilemma", displayName: "Prisoner's Dilemma", interaction: "trust", finaleSuitable: true, difficulty: 2, expansion: true,
  instructions: "Cooperate for a solid shared payout, or defect for a tempting personal edge that punishes trust.",
  options: () => [{ id: "cooperate", label: "COOPERATE", detail: "Everyone earns +3 if nobody defects." }, { id: "defect", label: "DEFECT", detail: "A lone defector earns +4; a group of defectors earns +1 each." }],
  config: ({ players }) => ({ title: "The room makes the call.", prompt: `${players.length} people can cooperate or defect. Your choice stays hidden until everyone commits.`, options: prisonersDilemma.options({ players, gameNumber: 0 }), scoreHint: "If everyone cooperates, all earn +3. A lone defector earns +4 and cooperators get 0. If multiple defect, they get +1 each and cooperators lose 1." }),
  validate: (choice) => choice === "cooperate" || choice === "defect",
  resolve({ players, submissions }) {
    const defectors = players.filter((player) => submissions[player.id] === "defect");
    const allCooperate = defectors.length === 0;
    const points = Object.fromEntries(players.map((player) => [player.id, !submissions[player.id] ? 0 : allCooperate ? 3 : submissions[player.id] === "defect" ? defectors.length === 1 ? 4 : 1 : defectors.length === 1 ? 0 : -1]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, allCooperate ? "Everyone cooperated. The room earned +3 each." : submissions[player.id] === "defect" ? defectors.length === 1 ? "You defected alone and took the personal payout. +4." : "Several people defected; the trust bonus disappeared. +1." : defectors.length === 1 ? "One person defected, but you avoided a loss." : "The room defected together. Your cooperation cost 1."]));
    const events = defectors.map((player): GameEvent => ({ type: "betrayal", playerId: player.id }));
    return { ...makeResult(submissions, points, reasons, allCooperate ? "The whole room cooperated." : `${defectors.length} ${defectors.length === 1 ? "person defected" : "people defected"}.`, events), optionCounts: counts(players, submissions, ["cooperate", "defect"]) };
  },
};

const numberOptions = [0, 1, 2, 3, 4].map((value) => ({ id: `number:${value}`, label: `${value}`, detail: "The room's average becomes the target." }));
export const splitTheDifference: MinigameDefinition = {
  id: "split-the-difference", displayName: "Split the Difference", interaction: "negotiate", finaleSuitable: true, difficulty: 1, expansion: true,
  instructions: "Pick a number; the closer your choice is to the room's average, the more you score.",
  options: () => numberOptions,
  config: () => ({ title: "Meet somewhere in the middle.", prompt: "Choose a number from 0 to 4. The room's average becomes the target, so try to coordinate without talking in the app.", options: numberOptions, scoreHint: "Start at +4, then lose 2 points per whole-number step from the group's average. Scores cannot go below 0." }),
  validate: (choice) => numberOptions.some((option) => option.id === choice),
  resolve({ players, submissions }) {
    const values = Object.fromEntries(players.map((player) => [player.id, Number(submissions[player.id]?.slice(7) ?? 0)]));
    const average = Object.values(values).reduce((sum, value) => sum + value, 0) / Math.max(1, players.length);
    const points = Object.fromEntries(players.map((player) => [player.id, !submissions[player.id] ? 0 : Math.max(0, 4 - Math.round(Math.abs(values[player.id] - average) * 2))]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, `You chose ${values[player.id]}; the room's average was ${average.toFixed(1)}. +${points[player.id]}.`]));
    return { ...makeResult(submissions, points, reasons, `The room settled at an average of ${average.toFixed(1)}.`), optionCounts: counts(players, submissions, numberOptions.map((option) => option.id)) };
  },
};

export const goldenTicket: MinigameDefinition = {
  id: "golden-ticket", displayName: "Golden Ticket", interaction: "target", finaleSuitable: true, difficulty: 1, expansion: true,
  instructions: "Vote for one friend to get the golden ticket; the most-supported players and their voters both score.",
  options: ({ players }) => players.map((player) => ({ id: `ticket:${player.id}`, label: `BACK ${player.name}`, detail: "Top-supported players get +2; their voters get +1." })),
  config: ({ players }) => ({ title: "One golden ticket.", prompt: "Give your ticket to one person. You may back yourself, but the reveal shows where the room's support went.", options: goldenTicket.options({ players, gameNumber: 0 }), scoreHint: "Each player tied for the most tickets gains +2. Anyone who voted for a top-supported player gains +1." }),
  validate: (choice, { players }) => choice.startsWith("ticket:") && players.some((player) => player.id === choice.slice(7)),
  resolve({ players, submissions }) {
    const votes = Object.fromEntries(players.map((player) => [player.id, players.filter((voter) => submissions[voter.id] === `ticket:${player.id}`).length]));
    const high = Math.max(0, ...Object.values(votes));
    const supported = new Set(players.filter((player) => votes[player.id] === high && high > 0).map((player) => player.id));
    const points = Object.fromEntries(players.map((player) => [player.id, (supported.has(player.id) ? 2 : 0) + (supported.has(submissions[player.id]?.slice(7) ?? "") ? 1 : 0)]));
    const reasons = Object.fromEntries(players.map((player) => [player.id, `${supported.has(player.id) ? "The room backed you. +2. " : ""}${supported.has(submissions[player.id]?.slice(7) ?? "") ? "Your vote backed a top-supported player. +1." : "Your vote missed the top spot."}`.trim()]));
    const events = players.flatMap((player): GameEvent[] => {
      const targetId = submissions[player.id]?.slice(7);
      return targetId && players.some((candidate) => candidate.id === targetId) ? [{ type: "support", actorId: player.id, targetId, successful: supported.has(targetId) }] : [];
    });
    return { ...makeResult(submissions, points, reasons, supported.size ? `${[...supported].map((id) => players.find((player) => player.id === id)?.name).join(" and ")} got the golden ticket.` : "Nobody got the golden ticket.", events), optionCounts: votes };
  },
};

export const PARTY_GAMES: MinigameDefinition[] = [auctionHouse, lifeline, groupProject, prisonersDilemma, splitTheDifference, goldenTicket];
