import type { GameEvent, GameOption, MinigameConfig, MinigameDefinition, Player } from "../types";
import { seededShuffle } from "../seed";

const options = (items: Array<[string, string, string]>): GameOption[] => items.map(([id, label, detail]) => ({ id, label, detail }));
const config = (title: string, prompt: string, picks: GameOption[], scoreHint: string): MinigameConfig => ({ title, prompt, options: picks, scoreHint });
const outcome = (players: Player[], choices: Record<string, string>, evaluate: (id: string, events: GameEvent[]) => [number, string], reveal: string) => {
  const events: GameEvent[] = [];
  const basePoints: Record<string, number> = {}, reasons: Record<string, string> = {};
  for (const p of players) {
    const [points, reason] = choices[p.id] ? evaluate(p.id, events) : [0, "No response before the deadline. No points."] as const;
    basePoints[p.id] = points; reasons[p.id] = reason;
  }
  return { choices: { ...choices }, basePoints, reasons, events, reveal };
};
const metadata = (family: string, visibility: "public" | "asymmetric", tags: Array<"social" | "read" | "stakes" | "chaos" | "finale">) => ({ family, socialIntensity: 3 as const, informationVisibility: visibility, betrayalPotential: 3 as const, coordination: 3 as const, randomness: 1 as const, minPlayers: 2, maxPlayers: 8, expectedSeconds: 125, sessionTags: tags, houseRuleTags: ["scoring", "information", "risk", "chaos", "powers", "multi-beat"] });
function definition(input: Omit<MinigameDefinition, "options" | "validate" | "resolve">): MinigameDefinition {
  return { ...input, options: args => input.config(args).options,
    validate: (choice, { config }) => config.options.some(o => o.id === choice),
    // Direct resolution remains deterministic for tooling; the engine supplies beat-one state.
    resolve: ({ players, submissions }) => input.multiBeat!.resolve({ players, submissions, firstChoices: {}, seed: "preview" }),
  };
}

const pledges = options([["promise:left", "PROMISE LEFT", "Tell the room which route you will take."], ["promise:right", "PROMISE RIGHT", "Promises become public before the real decision."]]);
const routes = options([["route:left", "TAKE LEFT", "A route with at most half the room earns +3; crowded earns 0."], ["route:right", "TAKE RIGHT", "Keep your public promise for +1, even when crowded."]]);
export const crossMyHeart = definition({
  id: "cross-my-heart", displayName: "Cross My Heart", interaction: "negotiate", difficulty: 2, finaleSuitable: true,
  director: metadata("public-commitment", "public", ["social", "stakes", "finale"]),
  instructions: "Promise a route, then see everyone's promises. Negotiate space before privately taking your real route: a quiet route pays, but keeping your word pays too.",
  config: () => config("Put your promise on the record.", "Promise LEFT or RIGHT. After the promises open, you may keep your word or switch.", pledges, "Final route: +3 if at most half the players take it, otherwise 0. Keep your promise: +1. A broken promise is recorded."),
  multiBeat: { seconds: [30, 40], advance: ({ players, submissions }) => ({ config: config("Promises are public. Now choose.", "Talk it out. Your final route stays private until everyone responds.", routes, "Quiet route +3 (at most half the room); kept promise +1."), publicLines: players.map(p => `${p.name}: ${submissions[p.id]?.slice(8).toUpperCase() ?? "NO PROMISE"}`) }),
    resolve: ({ players, submissions, firstChoices }) => outcome(players, submissions, (id, events) => {
      const route = submissions[id].slice(6), count = players.filter(p => submissions[p.id] === submissions[id]).length;
      const kept = firstChoices[id] === `promise:${route}`;
      if (firstChoices[id]) events.push({ type: "promise", playerId: id, kept });
      if (firstChoices[id] && !kept) events.push({ type: "betrayal", playerId: id }, { type: "chaos", playerId: id });
      const points = (count <= players.length / 2 ? 3 : 0) + (kept ? 1 : 0);
      return [points, `${count} took ${route}. ${kept ? "You kept your public promise (+1)." : firstChoices[id] ? "You broke your public promise." : "You made no promise."} Total ${points}.`];
    }, "The routes open. Who kept their word?") },
});

const claims = options([["claim:safe", "SAY: SAFE", "You will receive a private route report. Claim what you want."], ["claim:danger", "SAY: DANGER", "The report arrives with your first decision; your claim may be a bluff."]]);
const cargo = options([["cargo:go", "SEND THE CARGO", "Safe route: +4. Dangerous route: −2."], ["cargo:stay", "KEEP IT HERE", "Bank +1 regardless of the report."]]);
// Everyone receives a truthful private fragment. Only the designated witness sees the actual route.
export const signalNoise = definition({
  id: "signal-noise", displayName: "Signal / Noise", interaction: "read", difficulty: 2, finaleSuitable: true,
  director: metadata("asymmetric-report", "asymmetric", ["read", "social", "stakes", "finale"]),
  instructions: "One witness receives the true route report. Everyone publicly claims safe or dangerous, then decides whether to trust the witness with their cargo.",
  config: () => config("Make a public forecast.", "One witness will get the true report after forecasts open. Claim SAFE or DANGER; then the witness can bargain or bluff aloud.", claims, "Send cargo: +4 if safe, −2 if dangerous. Keep: +1. The witness earns +1 per cargo sent (cap 2), so has a reason to persuade."),
  multiBeat: { seconds: [25, 45], advance: ({ players, submissions, seed }) => {
      const witness = seededShuffle(players, `${seed}:witness`)[0];
      const safe = seededShuffle([true, false], `${seed}:route`)[0];
      return { config: config("Ask the witness. Risk your cargo?", `${witness.name} has the true report. They earn a bonus when you send cargo. Talk before locking.`, cargo, "Send: safe +4 / danger −2. Keep +1. Witness bonus: +1 per OTHER sender, cap 2."), publicLines: players.map(p => `${p.name}: ${submissions[p.id]?.slice(6).toUpperCase() ?? "NO FORECAST"}`), privateHints: Object.fromEntries(players.map(p => [p.id, p.id === witness.id ? `YOU ARE THE WITNESS. True route: ${safe ? "SAFE" : "DANGER"}. You may tell the truth or bluff.` : `${witness.name} knows the route. Their public forecast was made before seeing the report.`])) };
    }, resolve: ({ players, submissions, firstChoices, seed }) => {
      const witness = seededShuffle(players, `${seed}:witness`)[0], safe = seededShuffle([true, false], `${seed}:route`)[0];
      const result = outcome(players, submissions, (id, events) => {
        const send = submissions[id] === "cargo:go", bonus = id === witness.id ? Math.min(2, players.filter(p => p.id !== id && submissions[p.id] === "cargo:go").length) : 0;
        if (send) events.push({ type: "gamble", playerId: id, result: safe ? "won" : "lost" });
        events.push({ type: "read", playerId: id, accurate: send === safe });
        return [(send ? safe ? 4 : -2 : 1) + bonus, `${send ? safe ? "Cargo arrived: +4." : "Danger took your cargo: −2." : "Cargo stayed home: +1."}${bonus ? ` Witness persuasion +${bonus}.` : ""}`];
      }, `The true route was ${safe ? "SAFE" : "DANGER"}. ${witness.name} knew.`);
      const accurateForecasts = players.filter(p => firstChoices[p.id] === `claim:${safe ? "safe" : "danger"}`).length;
      result.reveal += ` ${accurateForecasts} forecast${accurateForecasts === 1 ? " was" : "s were"} right.`;
      for (const player of players) if (firstChoices[player.id]) {
        const accurate = firstChoices[player.id] === `claim:${safe ? "safe" : "danger"}`;
        result.events.push({ type: "read", playerId: player.id, accurate });
        if (accurate) { result.basePoints[player.id]++; result.reasons[player.id] += " Accurate public forecast +1."; }
      }
      return result;
    } },
});

const lanes = options([["reserve:stage", "RESERVE THE STAGE", "Each venue holds one player. Reservations become public."], ["reserve:roof", "RESERVE THE ROOF", "Negotiate who moves before the final allocation."], ["reserve:yard", "RESERVE THE YARD", "No venue can pay more than one guest."]]);
const venues = options([["allocate:stage", "STAGE: SPEND 2 TOKENS", "Alone +6 minus 2 tokens = +4; crowded lose 2."], ["allocate:roof", "ROOF: SPEND 1 TOKEN", "Alone +4 minus 1 token = +3; crowded lose 1."], ["allocate:yard", "YARD: FREE ENTRY", "Alone +2; crowded 0."], ["allocate:home", "STAY HOME", "Save one token as +1 point; no venue bonus."]]);
export const lastSeats = definition({
  id: "last-seats", displayName: "Last Seats", interaction: "negotiate", difficulty: 2, finaleSuitable: false,
  director: metadata("resource-allocation", "public", ["social", "stakes", "chaos"]),
  instructions: "Reserve a venue, see the reservation list, then negotiate who gets the limited space. Allocate your round tokens to a final venue or stay home for a safe point.",
  config: () => config("Reserve your night out.", "Three venues, one paid spot at each. Reservations are promises, not guaranteed seats.", lanes, "Stage alone +4 / crowded −2. Roof alone +3 / crowded −1. Yard alone +2 / crowded 0. Stay home +1. Round tokens are separate from Chaos."),
  multiBeat: { seconds: [25, 45], advance: ({ players, submissions }) => ({ config: config("The guest list is open. Make a deal.", "Your reservation is not binding. Decide your final venue in private. Can you convince someone to stay home?", venues, "Stage +4/−2, roof +3/−1, yard +2/0 (alone/crowded). Home +1."), publicLines: players.map(p => `${p.name}: ${submissions[p.id]?.slice(8).toUpperCase() ?? "NO RESERVATION"}`) }),
    resolve: ({ players, submissions, firstChoices }) => outcome(players, submissions, (id, events) => {
      const venue = submissions[id].slice(9), count = players.filter(p => submissions[p.id] === submissions[id]).length;
      const points = venue === "home" ? 1 : venue === "stage" ? count === 1 ? 4 : -2 : venue === "roof" ? count === 1 ? 3 : -1 : count === 1 ? 2 : 0;
      if (venue !== "home") events.push({ type: "gamble", playerId: id, result: count === 1 ? "won" : "lost" });
      if (firstChoices[id]) {
        const kept = firstChoices[id] === `reserve:${venue}`;
        events.push({ type: "promise", playerId: id, kept });
        if (!kept) events.push({ type: "betrayal", playerId: id });
      }
      return [points, venue === "home" ? "You saved a round token. +1." : `${count} at ${venue}; entry cost included. ${points > 0 ? "+" : ""}${points}.`];
    }, "Reservations were not guarantees. The final guest list is open.") },
});

const pressure = options([["pressure:low", "SET LOW PRESSURE", "A low dial adds 1 to the shared pot."], ["pressure:high", "CRANK IT UP", "A high dial adds 2, but lowers the safe number of riders."]]);
const ride = options([["ride:stay", "STAY ON", "Share the pot if the ride survives; lose 2 if it overloads."], ["ride:leave", "STEP OFF", "Safe +1. Leaving makes room for the others."]]);
export const breakingPoint = definition({
  id: "breaking-point", displayName: "Breaking Point", interaction: "risk", difficulty: 2, finaleSuitable: true,
  director: metadata("sequential-pressure", "public", ["stakes", "chaos", "finale"]),
  instructions: "Set the pressure together, then see exactly how many people the ride can hold. Negotiate who steps off; the survivors share the pot only if you leave enough room.",
  config: () => config("Set the pressure.", "Each LOW adds 1 to the pot. Each HIGH adds 2 but reduces capacity. After the dials open, decide who stays on.", pressure, "Capacity = players − ceil(HIGH/2), minimum 1. Survivors split pot (rounded down, cap +5 each). Overload −2. Step off +1."),
  multiBeat: { seconds: [25, 40], advance: ({ players, submissions }) => {
      const high = Object.values(submissions).filter(c => c === "pressure:high").length, capacity = Math.max(1, players.length - Math.ceil(high / 2));
      const pot = Object.values(submissions).reduce((n,c) => n + (c === "pressure:high" ? 2 : 1), 0);
      return { config: config("Who is getting off?", `Pot: ${pot}. Capacity: ${capacity} riders. More riders means everyone still on loses 2. Make your promises aloud.`, ride, "Safe ride: floor(pot / riders), cap +5. Overload −2. Step off +1."), publicLines: players.map(p => `${p.name}: ${submissions[p.id]?.slice(9).toUpperCase() ?? "NO DIAL"}`) };
    }, resolve: ({ players, submissions, firstChoices }) => {
      const high = Object.values(firstChoices).filter(c => c === "pressure:high").length, capacity = Math.max(1, players.length - Math.ceil(high / 2));
      const pot = Object.values(firstChoices).reduce((n,c) => n + (c === "pressure:high" ? 2 : 1), 0), riders = Object.values(submissions).filter(c => c === "ride:stay").length;
      return outcome(players, submissions, (id, events) => {
        const stay = submissions[id] === "ride:stay", won = riders <= capacity;
        if (stay) events.push({ type: "gamble", playerId: id, result: won ? "won" : "lost" });
        if (firstChoices[id] === "pressure:high") events.push({ type: "chaos", playerId: id });
        return [stay ? won ? Math.min(5, Math.floor(pot / Math.max(1, riders))) : -2 : 1, stay ? `${riders}/${capacity} riders. ${won ? "The ride survived; you shared the pot." : "Overloaded. −2."}` : "You stepped off and banked +1."];
      }, `${riders} stayed on a ${capacity}-person ride. ${riders > capacity ? "It broke." : "It held."}`);
    } },
});
export const ENCOUNTER_GAMES = [crossMyHeart, signalNoise, lastSeats, breakingPoint];
