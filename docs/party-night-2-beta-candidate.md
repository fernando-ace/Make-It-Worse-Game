# Party Night 2.0 beta candidate report

## Base and branch

- Requested base branch: `feat/party-night-2`
- Party Night 2.0 commits verified: `cd1112abc70d443cbbe50daeabc1563edae060d9` (gameplay), `ca263a371479d598fea8aec1f15135f3adfe6189` (documentation)
- Candidate branch: `feat/party-night-2-beta-candidate`
- Last hosted validation code commit: `92f7d3c9af4d77124f35875dd79bb891f77f490a`
- Master base at audit: `6d8fec7434255420aba6501becec3c05afe94b33`

Candidate commits after `ca263a3`: `407488f`, `31f4897`, `f183921`, `9c3449f`, `7a28c78`, `a995ef8`, `b130949`, `633fd75`, `92f7d3c`, and the report-only update `bb9859d`. The branch is pushed and is not merged. Hosted validation passed on `92f7d3c`; `bb9859d` only records those results.

## Party Night implementation audit

The gameplay diff and the engine/API path were reviewed, including the beat model, action beat checks, transition deadlines, reveal filtering, private hints, power timing, House Rule compatibility, scoring, objectives, Chaos, finale, Director, telemetry, tests, and documentation. No high-confidence gameplay defect requiring a scoring/state-machine change was found in this audit. Existing engine tests include refresh snapshots, duplicate action IDs, stale beat rejection, deadlines, and private information checks for each new game.

No additional gameplay rewrite is justified from this pass. The focused browser suite covers one real two-player server/API flow per selected two-beat game, privacy snapshots, a refresh after the beat transition and after a beat-two commitment, resolution, and 390/430 px overflow. The live browser suite covers a three-player six-game session and same-room replay. Broader phase-by-phase reconnect and deadline race coverage is not complete; see limitations.

## Validation architecture

`.github/workflows/party-night-beta.yml` defines clean GitHub-hosted validation. It runs install, lint, typecheck, all Vitest tests, the 1,000-session simulation, and production build. Browser jobs start ephemeral local Supabase, apply repository migrations, install Chromium, and run the existing live/session suites plus a matrix for all four new games. CI has no production secrets and no deployment step. The E2E selector is read only from server environment and is disabled whenever `NODE_ENV=production`; it does not accept seeds or game selection from clients.

## Validation evidence

- `npm ci`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 128 tests passed.
- `npm run test:simulation`: 1,000 deterministic sessions passed.
- Production build: `npm run build` passed locally with Next.js 16.3.8. It also passed in clean GitHub-hosted CI on the candidate head; compilation, TypeScript, page data, and static generation completed.
- Hosted CI run `38999928780` on `92f7d3c`: all jobs passed. The `validate` job ran `npm ci`, lint, typecheck, all Vitest tests, the 1,000-session simulation, and `npm run build`.
- Browser jobs passed against ephemeral local Supabase with repository migrations and installed Chromium: the existing three-player live suite (including scoring, House Rules, powers, objectives, finale, and replay), the existing two-player mobile party suite, and the deterministic E2E suite for Cross My Heart, Signal / Noise, Last Seats, and Breaking Point.
- The local executor could not pull Supabase/Chromium images (HTTP 403); the hosted run supplied the full-stack browser evidence instead. No production Supabase configuration or credentials were used.

## Simulation reading

The 1,000-session deterministic regression passed across 2–8 players and all 20 games. Its fixed policy produced 973 unique lineups; multi-beat games appeared 2,060 times across 6,000 slots. The 10,000-session extended run also passed: 8,054 unique lineups, 20,586 multi-beat appearances across 60,000 slots, 20,817 lead changes, 609 sessions with a 15+ point final gap, 7,635 finale comeback bonuses, and 19,709 objectives completed from 49,994 assignments (39.4%). Chaos earned/spent/held was 466,799 / 427,774 / 139,013, converting 30,073 finale points. All 20 games appeared, all 13 House Rules were selected, and adjacent family repeats were zero. `Signal / Noise` appeared 6,165 times (10.3%) and `Breaking Point` 5,775 times (9.6%); these are elevated seeded selection rates to monitor, not evidence of enjoyment or scoring dominance. The fixed policy is deterministic and does not estimate human play. `npm run test:balance` writes machine-readable JSON and Markdown into ignored `work/`. No gameplay balance changes are made on synthetic frequency alone.

## Analyzer and privacy

`npm run beta:analyze -- <sanitized-export.json>` creates adjacent JSON and Markdown summaries with sample size guardrails. Input is allowlisted; raw feedback, names, player identifiers, room IDs, submissions, objective text, private hints, tokens, IP addresses, and arbitrary payloads are rejected. Session correlation accepts only 64-character SHA-256 keys. The tool reports operational counts and descriptive metrics; it does not calculate a hidden quality score or claim significance.

The existing server-derived `PARTY_METRICS` output is structured and contains no player names, choices, objective text, or private hints. Existing database telemetry can be exported using its fixed columns. Do not query production for this candidate.

## Mobile and accessibility

The mobile CSS now prioritizes the prompt and choices ahead of powers and session history, keeps active House Rules before the decision, allows long names/copy to wrap, and honors reduced-motion preferences. Existing game UI includes beat labels, an accessible countdown, lock status, public reveal lines, owner-only report, answer counts, and active House Rule descriptions. Keyboard focus styling and native button semantics were present. Hosted Chromium verified no horizontal overflow at 390 and 430 px during two-beat flows, and at 390, 430, 768, 1024, and 1440 px during the existing full mobile party flow. Physical iOS/Android touch behavior, unusually long content, and reduced-height layouts remain human/device checks.

## Human beta preparation

The field-test kit and [results template](beta-results-template.md) cover 2, 3–4, 5–6, and practical 7–8 player cohorts, observer notes, short post-game questions, and separate automated evidence, human observation, and product hypotheses. Human sessions still require a reachable dedicated non-production deployment and real groups.

## Known limitations and remaining evidence

- Clean hosted CI passed on the pushed candidate head, including production build, all automated tests, live suite, mobile party suite, and four two-beat browser runs.
- Expand browser reconnect coverage across lobby, intro, beat 1 before/after commit, beat transition, beat 2 before/after commit, result, House Rule selection, intermission, finale, and replay; add explicit simultaneous deadline race and player departure checks against Supabase. Existing unit/API tests cover refresh snapshots, stale actions, duplicate actions, deadline advancement and idempotency, but the complete requested phase/departure matrix is not yet exercised in browser CI.
- Perform visual mobile/accessibility checks on real iOS/Android devices, including reduced viewport height, unusually long player names/copy, keyboard focus, and touch targets.
- Run actual human cohorts and fill the results template. No synthetic run substitutes for negotiation/reaction/replay observations.
- Balance review should use the completed 10,000-session output plus human evidence. No score or economy change is made in this candidate without high-confidence evidence.

No migration, dependency, production configuration, deployment, or production data change is part of this candidate. The candidate branch is pushed, CI passed, and the worktree is clean. No merge or production operation was performed.
