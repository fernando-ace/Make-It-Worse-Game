# Party Night 2.2 field-test release

## Release record

- Base branch: `feat/party-night-2-beta-candidate`
- Base tip: `a88f052b1f16043a467b1af95bc7eccf13123903`
- Validated implementation parent: `12b46ae6f831c0092d93d413dab3aaf7d4acd2b2`
- Release branch: `feat/party-night-2-field-test-release`
- Production deployment, production Supabase, production data, production secrets, DNS, and production environment settings: not used.
- Database migrations and runtime dependencies added: none.
- Gameplay content, scoring, powers, House Rules, and balance: unchanged.

The candidate was audited before edits. Its authoritative room is stored behind service-role-only RPCs. A browser action is authenticated with the anonymous Supabase identity, checked for room membership, applied against a read snapshot, and committed with the expected room revision. A revision conflict causes the server to reread and retry. The server owns its clock and generated seed. Browser snapshots filter the seed, full objective map, Chaos balances, active powers, submissions, and private beat reports; each player receives only their own objective, balances, offers, choice, hint, and scout report. Realtime room notifications prompt sync, while polling, foreground/online events, and a reload repair missed notifications.

## State machine and transition authority

```text
LOBBY
  └─ host starts ─> GAME INTRO
                       └─ host begins ─> BEAT 1 OPEN / SINGLE-BEAT OPEN
                            ├─ all submit or server deadline ─> BEAT TRANSITION (two-beat only)
                            │                                    └─> BEAT 2 OPEN
                            │                                           └─ all submit/deadline ─> RESULT
                            └─ all submit/deadline ───────────────────────────────────────────> RESULT
                                 RESULT ─> HOUSE RULE SELECTION ─> INTERMISSION ─> NEXT GAME
                                 finale RESULT ─> FINALE / FINAL RESULTS
                                                   ├─ player reveals objectives ─> OBJECTIVE REVEAL
                                                   ├─ private feedback form (local UI) ─> FEEDBACK
                                                   └─ host restarts ─> REPLAY / GAME INTRO
```

The revision checked room commit remains the authority for actions, scoring, Chaos, objective progress, powers, deadlines, rule selection, and replay. `resolveRound` is guarded by phase/result state, so a repeated sync sees the already-applied resolution. On explicit departure, the member is removed; a departing host is replaced by the first remaining player. A departure does not replace the player or rewrite the running session. Remaining players can continue to submit; if a departed player leaves an incomplete quorum, the existing server deadline resolves it. A two-player room with one departure remains active for the survivor and resolves on that survivor's submission or deadline. API tests exercise host reassignment from both lobby and active play. There is no host migration beyond that simple host reassignment.

## Reconnect coverage

The shared Playwright helpers in `tests/helpers/reconnect.ts` support reload, offline/online interruption, and a fresh browser context seeded from the prior browser storage. Snapshot assertions compare identity, roster, phase, game, beat, deadline, own committed choices, owner hint/report, objective, Chaos, powers/offers, rules, and scores. They also check that role-filtered snapshots omit the server seed, full objective map, and raw submissions.

| Phase or state | Automated coverage added or retained |
| --- | --- |
| Lobby | Real room reload plus browser-context recreation preserving auth and room storage in `live.spec.ts`; single-beat flow also reloads. |
| Game intro | Temporary offline/online recovery; later-game intro reload. |
| Beat 1 before commit | `reconnect.spec.ts` refreshes the active single-beat round before a choice. The two-beat suite covers its own first-beat submission and refresh. |
| Beat 1 after commit | Single-beat host choice and two-beat first choice are restored after refresh. |
| Beat transition | Two-beat browser flow refreshes after the server opens beat 2. |
| Beat 2 before and after commit | Two-beat browser flow checks restoration before the choice and after its own committed second choice. |
| Result | Single-beat and two-beat result snapshots are refreshed and checked. |
| House Rule selection | Winner refreshes while selection is open; offered rules are compared. |
| Intermission / next game | Intermission rules restore; the later-game intro is refreshed. |
| Finale / final results | Finale result and final results are refreshed. |
| Objective reveal | Owner's revealed objective snapshot restores; other players remain role-filtered in API/browser tests. |
| Feedback | Final-results feedback form can be reopened after reload; feedback storage failure is separately tested. |
| Replay | The restarted game intro is refreshed and checked. |

The two-beat browser job still runs `cross-my-heart`, `signal-noise`, `last-seats`, and `breaking-point` individually against ephemeral Supabase. The full session suite retains the gameplay and replay walkthrough. Private data assertions inspect API snapshots, not only rendered UI.

## Deadline and concurrency evidence

Fast deterministic route/API tests advance the server-owned deadline by arranging an expired persisted room state; they do not alter timer semantics. They cover beat-1 expiry, beat-2 expiry, reconnect sync after expiry, five simultaneous syncs at expiry, one-time history/score application, and the revision changing only once for the authoritative deadline transition. Concurrent submissions from three players resolve one game once. A concurrent duplicate power action ID leaves one activation and one spend. The existing engine suite checks repeated powers, stale beats, objective progress, rule transition guards, replay rules, and each game's input validation.

These deterministic API tests use an in-memory RPC fixture. They complement, but do not substitute for, the ephemeral Supabase browser jobs in hosted CI. A separate full-stack browser race at the exact deadline boundary is still useful evidence; it is not claimed as run locally in this workspace.

## Departures and room edges

The API suite now exercises an explicit guest departure during active play, then verifies the one remaining player can submit and the round resolves. Simultaneous submissions from a three-player room resolve once. Existing API tests cover lobby capacity (eight accepted, ninth rejected), membership rejection, duplicate room identity behavior, and room privacy. Host departure/reassignment during an active browser session is not covered by the new local evidence. Temporary disconnection is distinct from explicit leave: a disconnected member retains the room slot and identity; an explicit leave removes membership and prevents reconnecting as that member.

## Privacy and telemetry

API tests assert objective, seed, unrevealed choices, and private power state are absent from other players' payloads. The snapshot tests cover the scout report and private first-beat choice. The multi-beat browser suite checks public beat lines while keeping each player's own first choice and report scoped to that player. Existing request validation rejects invalid target IDs and powers not offered to the caller; production values remain server-derived.

Room telemetry is explicitly best-effort and now has a bounded 1.5 second write wait. The client beta-event route uses the same bounded writer. Runtime metric calculation/serialization/log-sink exceptions are contained after a successful authoritative commit. Tests inject telemetry storage failure, telemetry timeout, runtime metric logging failure, and feedback storage failure, then verify valid room actions remain available. Feedback itself reports that it could not be saved; gameplay remains independent.

Telemetry retains its existing allowlist and opaque session hash. It does not include player names, raw choices, objective text, private hints, auth tokens, IPs, arbitrary payloads, or conversations. The analyzer rejects unapproved or sensitive fields, validates opaque session keys and Party Night 2.0 game IDs, reports reconnects, replay, two-beat durations, rules, powers, and Chaos, and labels samples under 10 and 30 sessions. The expanded fixture covers healthy, reconnect-heavy, abandoned, multi-beat, replay, and high/low Chaos signals, plus a malformed privacy case. Analyzer output is deterministic and contains no combined fun score. The operator uses the private notes label, approximate time, and opaque session key to connect a human observation to sanitized evidence.

## Mobile and accessibility automation

The mobile browser test now checks 390 px normal and reduced height, 430 px, short landscape, tablet, and desktop layouts; exercises 23-character names, a long target list in an eight-player game, and a short-height House Rule screen; and asserts no horizontal overflow and reachable touch targets. It also checks keyboard focus visibility and reduced-motion behavior. Browser tests use semantic button roles and retain disabled-choice assertions. Two-beat tests check the accessible countdown label. No accessibility library was added.

Physical iOS/Android testing is still needed for safe-area insets, touch accuracy, screen reader announcements and focus order under VoiceOver/TalkBack, browser keyboard behavior on mobile, and real-world text scaling. Browser automation does not prove those device behaviors. Review unusually long objectives, modifier stacks, public reveal lines, and owner reports on devices with the actual field-test build.

## CI and simulations

The workflow runs on pushes to both the beta candidate and this release branch, as well as pull requests to `master`. It retains `npm ci`, lint, typecheck, all Vitest tests, 1,000-session simulation, production build, ephemeral Supabase migrations, anonymous auth, Chromium live and mobile suites, and all four two-beat games. It adds the deterministic single-beat reconnect flow and eight-player mobile edge case. Playwright traces and reports upload on failure. The workflow uses local Supabase only and has no deploy step or production secret requirement.

Local validation at the candidate baseline passed lint, typecheck, 128 tests, 1,000 sessions, and build. This hardening pass adds 10 Vitest cases across API race/departure, telemetry, and analyzer evidence. Latest test totals and hosted workflow results are recorded in the release handoff after validation.

Final local code checks: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (139 tests in 9 files), `npm run test:simulation` (1,000 sessions), `npm run test:balance` (10,000 sessions), and `npm run build` all passed. `npx playwright test --list` discovered the six browser tests, but discovery is not an execution result. All 20 registry games appeared in both simulations; 8,054 unique lineups appeared in the 10,000-session run. There were no gameplay, score, Chaos, power, or director changes in this release, so distributions remain governed by the existing candidate math. The simulation is a regression check, not a human preference estimate.

## Known limitations and human checks

- In this workspace, Playwright Chromium download was rejected with HTTP 403 from `cdn.playwright.dev`; the Supabase CLI could not pull ephemeral service images because `public.ecr.aws` returned HTTP 403. Therefore no browser suite is claimed as passed locally. Hosted CI is the intended reproducible environment; its result must be checked before calling the candidate a validated release.
- A physical-device pass remains open for iOS Safari and Android Chrome at 390/430 px, short landscape, safe areas, long text, keyboard and touch interaction, and VoiceOver/TalkBack.
- Human field testing remains open. Run a minimum of three real sessions across 2, 3–4, and 5–6 players; include a 7–8 person session if practical, record device mix and new/returning counts, and complete one results template per session. Do not author gameplay changes from synthetic metrics alone.
- The tests do not claim full coverage of every malformed direct API target manipulation or a full-stack exact-boundary deadline collision. Keep the privacy/API checks and revision conflict behavior as release gates.

Use the short [field test checklist](public-beta-field-test.md#field-test-checklist) during a party and record evidence in the [beta results template](beta-results-template.md). The recommended next milestone is a human-session synthesis after those sessions, with gameplay changes driven by observed moments, confusion, dead time, negotiation, and replay requests.
