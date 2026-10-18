# Party Night human field-test kit

## Evidence status

Automated evidence covers the game engine, deterministic UX Lab, simulations, and hosted ephemeral Supabase browser sessions. It cannot answer whether real people laugh, negotiate, bluff, understand the rules, or ask to replay.

**The free human-testing path is the Local Party Lab.** Follow [the setup guide](party-night-3-local-party-lab.md) to start real local Supabase and the actual game on Fernando's computer. Multiple phones join over the same LAN. The deployed Vercel Preview remains multiplayer-disabled until Fernando separately approves and provisions isolated cloud infrastructure. No spend is approved. Never connect Preview to Production or test with production Supabase.

## Before the session

1. Install dependencies once with `npm ci`; start Docker Desktop/Engine.
2. If the stack has already been started before, run `npm run party -- doctor`. On first setup, an unavailable local Supabase check is expected until `party` starts it. If Wi-Fi detection chose the wrong adapter, pass `--host <computer-private-IPv4>` to both commands.
3. Run `npm run party` (or `npm run party -- --host <computer-private-IPv4>`), confirm `Backend: LOCAL SUPABASE` and `Safety: PRODUCTION BLOCKED`, then share the printed URL with people on the same Wi-Fi.
4. Optionally run `npm run party -- reset --confirm` before a fresh test. This clears only local Supabase data and reapplies migrations.
5. Use separate browser profiles when practical so each phone keeps its own anonymous reconnect identity. One observer should use the compact [observer card](party-night-local-observer-card.md).

## During play

Play a full six-game session, including House Rules, Chaos/powers, secret objectives, finale, and same-room replay. Observe first; explain only when someone is blocked. Record just timestamps/game markers for confusion, silence, laughter, accusations, negotiation/promises, betrayal/targeting, power reaction, House Rule reaction, objective reveal, mobile friction, and spontaneous replay request. Do not collect names, contact details, raw choices, private objective text, hints, or identifiable quotes.

## After play

1. Ask the eight short prompts on the observer card.
2. Export the local allowlisted evidence and optional private operator notes:

   ```sh
   npm run party -- export --label "Saturday group" --players 4 --devices "iPhone/Safari + Android/Chrome + laptop" --group new
   npm run beta:analyze -- work/local-party-evidence.json
   ```

3. Complete the [results template](beta-results-template.md). Keep automated evidence, observed behavior, player comments, and hypotheses distinct.
4. Stop Supabase when ready with `npm run party -- stop --confirm`. Exported evidence and local data are preserved; reset is always explicit.

Do not infer enjoyment from session counts or simulation. Review the actual human observations before proposing the next major game change.
