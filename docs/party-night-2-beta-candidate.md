# Party Night 2.0 beta candidate report

## Base and branch

- Requested base branch: `feat/party-night-2`
- Party Night 2.0 commits verified: `cd1112abc70d443cbbe50daeabc1563edae060d9` (gameplay), `ca263a371479d598fea8aec1f15135f3adfe6189` (documentation)
- Candidate branch: `feat/party-night-2-beta-candidate`
- Master base at audit: `6d8fec7434255420aba6501becec3c05afe94b33`

## Party Night implementation audit

The gameplay diff and the engine/API path were reviewed, including the beat model, action beat checks, transition deadlines, reveal filtering, private hints, power timing, House Rule compatibility, scoring, objectives, Chaos, finale, Director, telemetry, tests, and documentation. No high-confidence gameplay defect requiring a scoring/state-machine change was found in this audit. Existing engine tests include refresh snapshots, duplicate action IDs, stale beat rejection, deadlines, and private information checks for each new game.

No additional gameplay rewrite is justified from this pass. The focused browser suite added here covers one real two-player server/API flow per selected two-beat game, privacy snapshots, a refresh after the beat transition, resolution, and 390/430 px overflow. Broader phase-by-phase reconnect and deadline race coverage is not complete; see limitations.

## Validation architecture

`.github/workflows/party-night-beta.yml` defines clean GitHub-hosted validation. It runs install, lint, typecheck, all Vitest tests, the 1,000-session simulation, and production build. Browser jobs start ephemeral local Supabase, apply repository migrations, install Chromium, and run the existing live/session suites plus a matrix for all four new games. CI has no production secrets and no deployment step. The E2E selector is read only from server environment and is disabled whenever `NODE_ENV=production`; it does not accept seeds or game selection from clients.

## Evidence from this checkout

- `npm ci`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 128 tests passed.
- `npm run test:simulation`: 1,000 deterministic sessions passed.
- Production build: `npm run build` passed locally with Next.js 16.3.8; compilation, TypeScript, page data, and static generation all completed.
- Browser suites: not run. Local Supabase image pulls and Playwright Chromium downloads returned HTTP 403 from this environment. GitHub Actions is configured to run against ephemeral local Supabase and Chromium, but its result is not available in this checkout.

## Simulation reading

The 1,000-session deterministic regression passed across 2–8 players and all 20 games. Its fixed policy produced 973 unique lineups; multi-beat games appeared 2,060 times across 6,000 slots. The 10,000-session extended run also passed: 8,054 unique lineups, 20,586 multi-beat appearances across 60,000 slots, 20,817 lead changes, 609 sessions with a 15+ point final gap, 7,635 finale comeback bonuses, and 19,709 objectives completed from 49,994 assignments (39.4%). Chaos earned/spent/held was 466,799 / 427,774 / 139,013, converting 30,073 finale points. All 20 games appeared, all 13 House Rules were selected, and adjacent family repeats were zero. `Signal / Noise` appeared 6,165 times (10.3%) and `Breaking Point` 5,775 times (9.6%); these are elevated seeded selection rates to monitor, not evidence of enjoyment or scoring dominance. The fixed policy is deterministic and does not estimate human play. `npm run test:balance` writes machine-readable JSON and Markdown into ignored `work/`. No gameplay balance changes are made on synthetic frequency alone.

## Analyzer and privacy

`npm run beta:analyze -- <sanitized-export.json>` creates adjacent JSON and Markdown summaries with sample size guardrails. Input is allowlisted; raw feedback, names, player identifiers, room IDs, submissions, objective text, private hints, tokens, IP addresses, and arbitrary payloads are rejected. Session correlation accepts only 64-character SHA-256 keys. The tool reports operational counts and descriptive metrics; it does not calculate a hidden quality score or claim significance.

The existing server-derived `PARTY_METRICS` output is structured and contains no player names, choices, objective text, or private hints. Existing database telemetry can be exported using its fixed columns. Do not query production for this candidate.

## Mobile and accessibility

The mobile CSS now prioritizes the prompt and choices ahead of powers and session history, keeps active House Rules before the decision, allows long names/copy to wrap, and honors reduced-motion preferences. Existing game UI includes beat labels, a countdown, lock status, public reveal lines, owner-only report, answer counts, and active House Rule descriptions. Keyboard focus styling and native button semantics were present. The new browser suite checks overflow at phone widths after both beats, but browser downloads were blocked in this environment, so rendered measurements, actual touch targets, long-content behavior, and reduced-height layouts remain unverified.

## Human beta preparation

The field-test kit and [results template](beta-results-template.md) cover 2, 3–4, 5–6, and practical 7–8 player cohorts, observer notes, short post-game questions, and separate automated evidence, human observation, and product hypotheses. Human sessions still require a reachable dedicated non-production deployment and real groups.

## Known limitations and remaining evidence

- Final local lint, typecheck, unit/integration tests, 1,000-session simulation, 10,000-session analysis, and production build passed in this checkout.
- Obtain passing GitHub Actions results for the clean production build, existing live suite, existing party suite, and all four new-game browser matrix.
- Expand browser reconnect coverage across lobby, intro, both beats before/after commit, result, House Rule selection, intermission, finale, and replay; add explicit simultaneous deadline race and player departure checks against Supabase.
- Perform visual mobile/accessibility checks on desktop and real iOS/Android devices, including reduced viewport height, long player names/copy, keyboard focus, and touch targets.
- Run actual human cohorts and fill the results template. No synthetic run substitutes for negotiation/reaction/replay observations.
- Balance review should use the completed 10,000-session output plus human evidence. No score or economy change is made in this candidate without high-confidence evidence.

No migration, dependency, production configuration, deployment, or production data change is part of this candidate. The branch has not yet been pushed because the execution environment's GitHub token is invalid; passing hosted CI and remote branch delivery remain outstanding.
