# Session simulation notes

The deterministic Session Director coverage in `tests/engine.test.ts` constructs **1,001 lineups**: 143 seeds at each supported player count from 2 through 8. Every generated lineup is checked for six distinct games, an easy opener, a finale-suitable last game, at least four mechanic families, no adjacent repeated family, and compatibility with the player count. The test also checks reproducibility for a fixed seed and variation across seeds.

The same engine suite validates feasible objective assignment from the actual session lineup, role-filtered snapshots, each registered game's validation and deterministic result, rule stacking/scoring, power costs and effects, winner-only selection, bounded finale bonuses, and a clean same-room restart. A focused House Rule case checks the four-card offer cap, future-family compatibility, and targeted-move scoring. These are deterministic regression simulations, not claims of mathematically optimal balance.

## Findings and changes

- Uniform random game selection did not provide a deliberate arc. The director now uses game metadata and seeded candidate scoring while preserving reproducible lineups.
- Ten games did not provide enough interaction variety. The registry now has sixteen distinct social mechanics, with structured events for new interactions.
- One fixed pool of House Rules could be both repetitive and irrelevant to upcoming games. Offers are capped at four and family-filtered; selected effects are applied by the common scorer and shown in result modifiers.
- Identical, always-available powers offered little session strategy. Players now receive deterministic rotating private offers, with server-enforced affordability and one use per game.
- Objective assignment could produce duplicate or unsupported goals. Assignment now filters against the lineup and available power offers, prefers unique goals, and tracks event progress privately.

## Limits

This simulation does not estimate player enjoyment, live network reliability, or win-rate balance. The deterministic checks sample the listed seeds and player counts; live Supabase browser coverage is separate. Public-beta readiness still depends on completing the real multiplayer, reconnect, replay, browser, and responsive validations described in the README.
