# Session simulation notes

The deterministic Session Director coverage in `tests/engine.test.ts` constructs **1,001 lineups**: 143 seeds at each supported player count from 2 through 8. Every generated lineup is checked for six distinct games, an easy opener, a finale-suitable last game, at least four mechanic families, no adjacent repeated family, and compatibility with the player count. The test also checks reproducibility for a fixed seed and variation across seeds.

`npm run test:simulation` also runs 1,000 complete six-game sessions, distributed evenly across 2–8 players. Each player uses a reproducible policy that picks among their own valid options, spends the first affordable rotating power offered, and never reads another player's choice. House Rules are chosen deterministically from the server-generated compatible offer set. The simulation verifies progression to final results, objective feasibility, legal powers, rule compatibility, score finiteness, and deterministic replay for a subset. It measures tie frequency, finale-comeback bonuses, power use, final-score range, objective completion, and game distribution. This is a synthetic regression tool, not a model of human behavior or win-rate balance.

The same engine suite validates role-filtered snapshots, each registered game's validation and deterministic result, rule stacking/scoring, power costs and effects, winner-only selection, bounded finale bonuses, event-award tie breaking, and a clean same-room restart. A focused House Rule case checks the four-card offer cap, future-family compatibility, and targeted-move scoring.

## Findings and changes

- Uniform random game selection did not provide a deliberate arc. The director now uses game metadata and seeded candidate scoring while preserving reproducible lineups.
- Ten games did not provide enough interaction variety. The registry now has sixteen distinct social mechanics, with structured events for new interactions.
- One fixed pool of House Rules could be both repetitive and irrelevant to upcoming games. Offers are capped at four and family-filtered; selected effects are applied by the common scorer and shown in result modifiers.
- Identical, always-available powers offered little session strategy. Players now receive deterministic rotating private offers, with server-enforced affordability and one use per game.
- Objective assignment could produce duplicate or unsupported goals. Assignment now filters against the lineup and available power offers, prefers unique goals, and tracks event progress privately.

## Limits

Across the 1,000 full-session run, the test observed 985 unique lineups; all 16 games appeared. Final player scores ranged from 0 to 51, 82 sessions had tied top scores, and 591 awarded a finale comeback bonus. The policies used powers 20,608 times and completed 2,365 objectives among 4,997 player-objectives (47.3%). These values describe the fixed synthetic policy and seed set only; they do not estimate human outcomes. The simulation does not estimate player enjoyment, live network reliability, or win-rate balance. No claim of mathematically optimal balance is made.

## Browser verification

On 2026-10-14, the two-player 390px browser test completed one six-game session in 57.8 seconds. The configured Supabase test completed two consecutive six-game sessions with three players in 2.8 minutes, including reconnect, private information, rotating powers, objective reveal, awards, score progression, and replay reset checks. The final source validation passed: 90 Vitest tests including the full-session simulation, ESLint, TypeScript, and the production build. These results are local to this run and do not claim deployed or physical-device evidence.
