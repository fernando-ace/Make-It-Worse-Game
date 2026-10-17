# Party Night 2.0 audit and beta guide

## Baseline audit

The registry had 16 games, 11 registered mechanic families, broad House Rule tags, rotating private powers, server-owned objectives and scores, reconnect snapshots, event-derived awards, a six-slot seeded Director, and deterministic 1,000-session simulations. All 16 used one simultaneous submission and one reveal. The missing interaction vocabulary was public commitments, usable private information, and sequential pressure with a chance to talk between decisions. Some games also confused missing submissions with real votes, and Group Tab treated a two-way tie as a majority.

The table is an implementation audit rather than a claim that mechanic names alone predict social quality. Complexity and social scores are 1 (low) to 3 (high); conversation potential is expected opportunity, not validated human behavior. “Public” means all submitted choices appear after resolution; the four new games disclose the first beat before the second. Chaos/action denotes meaningful spend or risk; baseline games use existing power offers and rules unless noted.

| Game | Family / interaction | Players | Complexity | Talk | Betray / coordinate | Visibility | Random | Pace | Similarity / fit / finale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Split Decision | prediction / crowd read | 2–8 | 1 | 1 | 1 / 1 | simultaneous | 2 | quick | Make It Worse; opener/read |
| Make It Worse | prediction / crowd read | 2–8 | 1 | 1 | 1 / 1 | simultaneous | 1 | quick | Split Decision; opener/read |
| Trust Me | trust / bluff | 2–8 | 2 | 3 | 3 / 2 | simultaneous | 2 | medium | Prisoner's Dilemma, Group Tab; high-stakes |
| Pile On | targeting / pile-on | 2–8 | 2 | 3 | 3 / 2 | simultaneous | 2 | medium | Lifeline, Golden Ticket; targeting |
| Secret Handshake | alliance / coordination | 2–8 | 2 | 3 | 2 / 3 | simultaneous | 1 | medium | Favor Bank; pact |
| Hot Potato | pass / escape | 2–8 | 2 | 2 | 3 / 3 | simultaneous | 2 | medium | Pile On; targeting |
| Group Tab | negotiation / split | 2–8 | 1 | 3 | 3 / 2 | simultaneous | 2 | medium | Trust Me / Dilemma; payoff varied by majority fix |
| Escalation Ladder | risk / matching | 2–8 | 2 | 2 | 2 / 2 | simultaneous | 2 | medium | Auction; risk |
| Bluff Check | bluff / read | 2–8 | 1 | 2 | 2 / 1 | simultaneous | 2 | quick | crowd reads; finale |
| Favor Bank | alliance / reciprocal target | 2–8 | 2 | 3 | 3 / 2 | simultaneous | 1 | medium | Secret Handshake; finale |
| Auction House | auction / paid bid | 2–8 | 2 | 2 | 1 / 2 | simultaneous | 2 | medium | Escalation; finale |
| Lifeline | protection / popularity | 2–8 | 2 | 3 | 1 / 2 | simultaneous | 2 | medium | Golden Ticket; finale |
| Group Project | shared effort / threshold | 2–8 | 2 | 2 | 2 / 3 | simultaneous | 1 | medium | cooperative effort; chaos |
| Prisoner's Dilemma | trust / cooperate-defect | 2–8 | 2 | 3 | 3 / 2 | simultaneous | 1 | medium | Trust Me; finale |
| Split the Difference | number coordination | 2–8 | 1 | 1 | 1 / 3 | simultaneous | 1 | quick | crowd reads; opener |
| Golden Ticket | popularity / support | 2–8 | 1 | 2 | 1 / 2 | simultaneous | 2 | quick | Lifeline; finale |
| Cross My Heart | promise / private response | 2–8 | 2 | 3 | 3 / 3 | public, then private | 1 | two beats | distinct commitment; finale |
| Signal / Noise | asymmetric report / social prediction | 2–8 | 2 | 3 | 3 / 3 | public forecast, private witness report | seeded | two beats | distinct information trust; finale |
| Last Seats | resource allocation / negotiation | 2–8 | 2 | 3 | 2 / 3 | public reservations, private allocation | 1 | two beats | distinct limited capacity; no finale |
| Breaking Point | sequential risk / capacity | 2–8 | 2 | 3 | 3 / 3 | public pressure, private response | seeded | two beats | distinct pressure; finale |

Baseline strengths retained: anonymous Supabase identity, server-authoritative state and clock, revision-checked writes, private snapshots, deterministic resolution and offers, all 16 existing IDs, event-backed awards, objective owner/reveal privacy, six games, replay, and the existing Playwright suites. House Rule, objective, and power systems were extended without schema changes. The 20-game field matrix records mechanic, players, decision complexity, talk, betrayal/coordination, visibility, randomness, pace, similarity, rule fit, and finale fit.

## New encounters

**Cross My Heart:** promise a route, see all promises, then privately keep or break yours. Keeping the promise adds a point and a broken promise emits a betrayal event; a quiet route scores more, so the promise creates a real social cost without forcing compliance.

**Signal / Noise:** everyone forecasts safe/danger before a seeded witness receives the true route report. The witness can persuade or bluff; each player privately sends cargo or keeps it home. The witness has a capped bonus for others who send, so the source has an incentive and listeners have a reason to doubt it.

**Last Seats:** players publicly reserve a venue, then privately allocate to limited capacity after talking. A crowded stage/roof costs points; staying home banks a point. Allocation tokens are round-specific and distinct from Chaos.

**Breaking Point:** players set a public low/high pressure dial; high adds to the pot and reduces capacity. Then everyone decides whether to ride or step off. Survivors share a capped payoff only if the ride stays within capacity.

All four are deterministic, accept 2–8 players, emit structured scoring events, have two timed beats, and use normal House Rule, power, objective, Chaos, scoring, reconnect, and replay pipelines.

## Changes and reasons

- All new game IDs are registered in the existing engine; old IDs remain intact.
- Group Tab now requires a strict majority, not half the players, to activate its shared payout. Missing players no longer count as challengers in Bluff Check or as choices in Prisoner's Dilemma / Split the Difference. Pile On tolerates absent choices safely.
- The two-beat state is a small optional field on the round. Beat 1 stores private choices; `advance` explicitly returns public lines, owner-specific hints, and beat-2 config; beat 2 resolves against both maps. Every action includes the current beat number. Repeated action IDs remain idempotent; stale beat actions are rejected. Deadline sync advances an expired first beat with no extra time and resolves an expired second beat with missing players left absent.
- The Director stays seeded, supports player count, avoids adjacent family repeats, bounds estimated decision time, and selects two or three multi-beat games when the registry supports them.
- `Your Word Matters` applies +2 for kept promises and −1 for broken promises after multipliers. `Talk It Out` adds 15 seconds per beat to compatible games. Offers are restricted to future compatible families.
- Behavioral objectives reward deliberate actions: promise keeping/breaking and power use are explicitly matchable; passive score/being-targeted objectives are excluded from new assignments. Power-specific objectives require the corresponding power to be offered in the lineup.
- Chaos earning now respects the cap exactly. Turn It Up costs one for a conditional point. A successful Take the Hit rescue gains the rescuer one point. Each three Chaos saved becomes one finale point, capped at two.
- Server logs emit a narrow numeric metric allowlist after committed transitions; no new database columns or event names are needed.

## Privacy, telemetry, and validation

Beat-1 submissions remain in server state. A snapshot contains only its owner's `myFirstChoice` and `myHint`, plus public lines. Other players' first choices and every player's private hint are omitted. The server seed stays out of snapshots. The existing private scout follows the current beat or the owner's own prior-beat target only. No client score, identity, deadline, power outcome, or progress is canonical.

Party metrics include pseudonymous session hash, game ID/number, player count, action duration, score spread, aggregate event counts, Chaos earned/spent, power ID used, power success/miss counts, selected rule ID and count, rule applications, promise counts, replay start, objective completion count, game decision duration, session duration, and score spread. They omit names, player IDs, submissions, objective IDs/text, offers, report contents, and event payloads. Selected power and rule IDs come only from the server validated action. They are operational server logs, not a dashboard or a claim of behavioral outcomes; enforce small-sample aggregation at the collection/analysis layer.

Automated evidence: `npm ci`; `npm run lint`; `npm run typecheck`; `npm test`; `npm run test:simulation`; `npm run build`. The deterministic simulation covers 1,000 complete sessions, distributed over 2–8 players, checking legal actions, completion, rules, powers, objectives, score ranges, and lineup diversity. Focused tests cover every new game at each supported player count, both deadlines, stale retries, owner-only reports, scoring order, and metrics redaction.

Service browser checks require dedicated non-production Supabase credentials. None are configured in this environment. Both Playwright suites require a local web server; this container also blocks child-process creation, so automated browser sessions could not start. Do not point the suites at production. Live 3-player sessions, 2-player mobile sessions, browser reconnect during each beat, rule/power/objective reveal, finale and replay, and 390/430/desktop rendered inspection remain human/environment validation tasks.

## Beta protocol

Test 2; 3–4; 5–6; and 7–8 player sessions. Include a replay and at least one session with public promises, an asymmetric report, a selected House Rule, a power, and final objective reveal. Capture direct quotes and visible behavior, not inferred intent: laughter, negotiation, accusation, promises, targeting, confusion, slow transitions, reveals retold, favorite/least favorite games, and immediate rematch requests. Ask: What was unclear? Which choice started the most talk? Did a rule change your move? Why did you save or spend Chaos? Which moment do you remember? Would you play again now?

Separate results into **AUTOMATED EVIDENCE**, **HUMAN OBSERVATION**, and **PRODUCT HYPOTHESIS**. Automated simulations cannot establish fun. Use a small first wave to find confusing instructions and broken decisions, then test whether specific fixes create more conversation and replay.
