# Session simulation notes

The deterministic Session Director coverage in `tests/engine.test.ts` constructs **1,001 lineups**: 143 seeds at each supported player count from 2 through 8. Every generated lineup is checked for six distinct games, an easy opener, a finale-suitable last game, at least four mechanic families, no adjacent repeated family, and compatibility with the player count. The test also checks reproducibility for a fixed seed and variation across seeds.

`npm run test:simulation` also runs 1,000 complete six-game sessions, distributed evenly across 2–8 players. Each player uses a reproducible policy that picks among their own valid options, spends the first affordable rotating power offered, and never reads another player's choice. House Rules are chosen deterministically from the server-generated compatible offer set. The simulation verifies progression to final results, objective feasibility, legal powers, rule compatibility, score finiteness, and deterministic replay for a subset. It measures tie frequency, finale comeback bonuses, power success/miss, Chaos earned/spent/held at finale, multi-beat appearances, lead changes, large lead gaps, rule activation, final-score range, objective completion, and game distribution. This is a synthetic regression tool, not a model of human behavior or win-rate balance.

The same engine suite validates role-filtered snapshots, each registered game's validation and deterministic result, rule stacking/scoring, power costs and effects, winner-only selection, bounded finale bonuses, event-award tie breaking, and a clean same-room restart. A focused House Rule case checks the four-card offer cap, future-family compatibility, and targeted-move scoring.

Run `npm run test:balance` for a 10,000-session matrix. It uses the same fixed deterministic player policy as the 1,000-session regression, covers 2–8 players, and writes machine-readable JSON plus a human-readable Markdown summary under the ignored local `work/` directory. The test log also prints a `FULL_SESSION_SIMULATION` JSON record. These are descriptive synthetic signals, not player preference estimates.

## Findings and changes

- Uniform random game selection did not provide a deliberate arc. The director now uses game metadata and seeded candidate scoring while preserving reproducible lineups.
- Ten games did not provide enough interaction variety. The registry now has twenty games, preserving all sixteen existing IDs and adding four two-beat social interactions.
- One fixed pool of House Rules could be both repetitive and irrelevant to upcoming games. Offers are capped at four and family-filtered; selected effects are applied by the common scorer and shown in result modifiers.
- Identical, always-available powers offered little session strategy. Players now receive deterministic rotating private offers, with server-enforced affordability and one use per game.
- Objective assignment could produce duplicate or unsupported goals. Assignment now filters against the lineup and available power offers, prefers unique goals, and tracks event progress privately.
- Hosts can choose a Standard or High Chaos start before the session. The server validates and stores the setting, resets starting Chaos correctly on replay, and defaults to Standard without slowing room creation.
- The finale now goes directly from its revealed game result to the staged session recap. The server rejects post-finale House Rule selection, so the winner never chooses a rule with no future round to affect.

## Limits

In the Party Night 2.0 1,000-session run, 973 unique lineups appeared; all 20 games appeared. Sessions played 2,060 multi-beat games, with 2,123 leader changes and 57 sessions ending with a 15-point or larger lead. Final player scores ranged from 0 to 62, 61 sessions tied for top score, and 745 earned a finale comeback bonus. The policy used powers 25,419 times (10,323 successes; 15,096 misses), earned 46,725 Chaos, spent 42,787, and converted 3,041 saved-Chaos points. It completed 1,931 objectives. These values describe the fixed synthetic policy and seed set only; they do not estimate human outcomes. The simulation does not estimate player enjoyment, live network reliability, or win-rate balance. No claim of mathematically optimal balance is made.

## Browser verification

Historical run (2026-10-14): the two-player browser test completed one six-game session in 1.8 minutes at 390px with High Chaos, then checked the final results layout at 430px; neither viewport had horizontal overflow. The configured Supabase test completed two consecutive six-game sessions with three players in 5.3 minutes, including reconnect, private information, rotating powers, objective reveal, awards, score progression, replay reset, and the direct finale-to-recap flow. Final validation passed: 92 Vitest tests including the full-session simulation, ESLint, TypeScript, and the production build. These results are local to this run and do not claim deployed or physical-device evidence.


Current environment check: the required Playwright Chromium executable is absent and no dedicated non-production Supabase configuration is available for live-room tests. Both browser suites stop at browser launch; their multiplayer steps have not been rerun for this change. `npm run build` also remains unverified here: the sandbox rejects child process creation (`EPERM`) in Next.js Turbopack workers, and Next.js Webpack fallback cannot capture the `tsc --showConfig` child output. `npm run typecheck` passes independently.
