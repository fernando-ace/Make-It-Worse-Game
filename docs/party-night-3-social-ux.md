# Party Night 3.0 · Social UX

## Starting point and consolidation

- New work branch: `feat/party-night-3-social-ux`.
- Base `master`: `6d8fec7434255420aba6501becec3c05afe94b33`.
- Consolidated Party Night 2.x tip: `944993bff95982fb41a666c3de54edc8b938764d`.
- The current 2.x field-test tip is a strict descendant of `master`; the new branch was created from `origin/master` and fast-forwarded to that tip. No Party Night 2.x code was reimplemented.
- The 2.x branch history retains its 20 registered games, four multi-beat games, server-authoritative scoring, reconnection work, privacy-filtered snapshots, simulation suite, and the ephemeral Supabase/Playwright workflow.

The 2.2 handoff says hosted browser status was not obtained in the prior environment because GitHub API calls returned HTTP 403. The combined status available for `944993b` reports Vercel success only, and the Actions connector returned no workflow run for that commit. No browser validation is claimed from that release record.

## Baseline UX audit

The 2.x landing page was rendered at 1440 × 1000, 390 × 844, 430 × 932, 390 × 640, 768 × 1024, and 844 × 390. It had a strong amount of empty vertical space, a subdued headline, and one merged form whose create/join behavior depended on whether the optional room-code input was filled. The local Supabase endpoint was not yet available during this capture: the screen showed its recoverable connection message and disabled entry action. This baseline screenshot therefore documents layout, not a successful room flow.

The source audit also identified persistent standings, rule, objective, power, history, and responder-name surfaces around the active decision. That made secondary information compete with the choice and exposed the identities of players who had committed. Two-beat information had a public/private split, but the labels did not have a consistent, explicit visual treatment. Existing results and recap already include structured score reasons, events, awards, objective reveals, score journey, and replay; the redesign keeps those canonical records intact.

## Design principles and visual system

- Lead with the game name, a short social promise, and the two room actions.
- Use the phone as the default decision surface; keep the current prompt and options visually ahead of session chrome.
- Give public and private information both distinct color and explicit text labels.
- Keep round progress aggregate. Do not name the players who have or have not committed.
- Let players open standings, accumulated rules, powers, and objectives when they need them.
- Use motion only as a brief state cue and honor `prefers-reduced-motion`.

The shared CSS tokens define ink, white paper, soft surfaces, violet, acid lime, coral, blue, and orange; a 4–48 px spacing rhythm; three radii; semantic success/warning/danger colors; and one soft shadow. Impact/Arial system fonts create a bold poster headline without a remote font request. Buttons, choices, visibility labels, status, and focus each have consistent states. No UI library, font, animation dependency, or other package was added.

## Component architecture

`ControlRoom` remains responsible for orchestration and sending actions to the server. UI helpers own no canonical game state and compute no scoring. The roster is now a presentational `PlayerRoster`; existing `InviteActions`, `ObjectiveCard`, `ObjectiveReveal`, `PowerControls`, `FeedbackForm`, and the local `OptionCard` remain focused pieces. CSS now uses a single tokenized stylesheet instead of accumulated override blocks.

The room API and engine still own identity, time, deadlines, legal actions, revisions, points, Chaos, powers, objective progress, rules, and outcomes. There are no backend or migration changes in this UX pass.

## Flow changes

### Landing, create, and join

The first screen now says what the game is, who it is for, that one person creates a room, that others join with a code or link, and that no account is needed. `Create game` and `Join game` are separately labeled actions. Join requires a full six-character code; the name and code inputs retain labels, use nickname and mobile keyboard hints, and associate errors with both fields. Enter submits create or join based on the filled code. Invite query strings continue to populate the join code through the existing parser.

### Lobby and party formation

Room code and copy actions are grouped in a lime share strip. `PlayerRoster` shows count, host, and presence (`HERE`/`RECONNECTING`) from the existing `seenAt` heartbeat. The host's Chaos setting and start button remain together, and the disabled start button explains whether the room needs one more player or a reconnection. No separate readiness state is invented; current game rules use room presence and the host's start action.

### Decisions, waiting, and two-beat games

The prompt, large choice targets, and timer now precede the secondary controls. Chaos balance stays visible in the decision context; power offers collapse into a wallet that names its cost rules and opens on demand. The secret objective collapses to a one-line private summary and progress; its description expands on tap. Scores and rule stack are available from a compact session-status disclosure. The latest active House Rule stays contextual; earlier rules and history are tucked behind session details.

Waiting states show `X / Y in`, acknowledge the player's own lock, and encourage conversation. Aggregate progress segments are based on the count only; they are not mapped to player names. The four two-beat games use a consistent `BEAT X OF 2`, `PUBLIC TO EVERYONE`, and `ONLY YOU CAN SEE THIS` label pattern. The first beat prompts players to talk before the second decision.

### House Rules, results, finale, and replay

The House Rule chooser tells the winner they earned the next twist, says when it starts, and gives each option a plain-language description and action cue. The existing score breakdown and event-backed reveal moments remain inspectable. The final-results sequence keeps objective, award, and session-record steps and its same-room replay action; it continues to use recorded events and score history rather than invented callbacks.

### Recovery and accessibility

Recoverable room/network messages avoid Supabase implementation detail. The connection state uses an announced status; field errors use `role="alert"`; lock-in feedback uses a polite status announcement. Choice buttons expose `aria-pressed`; the player roster uses list semantics; icons are hidden from assistive technology where their adjacent text already explains them. Focus rings remain visible, important controls are at least 40–48 px tall, and the page supports safe-area insets, short landscape, and reduced motion. Physical VoiceOver/TalkBack, mobile keyboard, safe-area, and text-scaling checks still require real devices.

## Performance and dependencies

The change uses CSS, native disclosure elements, and the repository's existing Lucide set. No dependency, remote asset, database migration, gameplay change, or balance adjustment was made. Motion is CSS-only, short, and disabled under reduced motion. Choice and recap data remain derived from the server snapshot; the client does not become an authority.

## Validation record

At the consolidated baseline, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (139 tests), `npm run test:simulation` (1,000 sessions), `npm run test:balance` (10,000 sessions), and `npm run build` passed. All 20 games appeared in both simulation runs. The balance run reported 8,054 unique lineups and did not indicate a gameplay change.

After the UI edits, lint, typecheck, all 139 unit/API tests, a production build, and the 10,000-session balance run passed again. The balance run covered 20 games, 8,054 unique lineups, and 50,000 rule activations. The UI-only rendering smoke used system Chromium 154 through Playwright because the Playwright Chromium CDN returned HTTP 403. The landing page showed no horizontal overflow at 390, 430, 768, or 1440 px, nor at 844 × 390. Production screenshots of desktop, 390 px mobile, an invite-code URL, and a simulated recoverable 503 entry error were reviewed against the generated visual concept. The error message was clear and recoverable; the invite code prefilled. Auth and telemetry responses were stubbed, so this validates rendering and client feedback only, not successful room creation or joining.

The real local Supabase stack could not start: the container registry request was denied and Docker later failed to register the Postgres image layer because its container storage ran out of space. Thus the full local end-to-end browser suite was not run here. No connected lobby, decision, results, or finale screen was visually audited in this UI pass.

The branch's GitHub Actions workflow is configured to run on pushes to this Party Night 3.0 branch. Its full evidence must be recorded here after the workflow completes: the 3-player six-game/replay session, 2-player session, four multi-beat game matrix, reconnect, deadline/concurrency, eight-player mobile, privacy, departure, and telemetry-failure suites. Until a completed hosted run is available, hosted browser validation remains pending. The prior `944993b` release did not have a recorded Actions run.

The Vercel preview for `2804e32` reached `READY`, and its server-rendered landing page returned HTTP 200. A read-only inspection of its static JavaScript bundle found the public Supabase project URL `https://jfosecuafntktpudjhyj.supabase.co`. Deployment metadata did not identify whether that is a non-production project. The preview's client code was not executed and no room/auth request was sent, because loading the app could create an anonymous auth session. Confirm the Supabase project/environment before interactive preview testing. Production deployment was not requested or performed.

## Branch consolidation and remaining beta work

The `feat/party-night-2`, `feat/party-night-2-beta-candidate`, and `feat/party-night-2-field-test-release` tips were all ancestors of the new branch; each had no unique commits at the integrated baseline. With no open pull requests using them, the three redundant remote references were removed after the new branch was pushed. `master` is not changed or merged.

Use [the field-test checklist](public-beta-field-test.md) with groups of 2, 3–4, and 5–6 players, mixing 390 px and 430 px phones with desktop. The observer should note hesitation, whether instructions are read, whether players look up and talk, public/private confusion, Chaos/power/objective use, waiting frustration, reveal reactions, House Rule understanding, finale clarity, and immediate replay requests. Browser checks cannot substitute for physical-device screen reader, mobile keyboard, text zoom, and touch testing or for observing actual group conversation. A non-production Supabase project must be confirmed before interactive preview and human group sessions; production remains untouched.

## Party Night 3.1 safe beta follow-up

The follow-up added `docs/party-night-3-safe-beta.md`, centralized environment guards, beta operator commands, server-derived telemetry storage/export, and a narrowly scoped cleanup migration. Vercel Preview and Production had shared Production Supabase project `jfosecuafntktpudjhyj`; Preview Supabase variables are now inert pending isolation. A dedicated beta project could not be created because the account has no free project slot, and the quoted branch compute would cost $0.01344/hour. Therefore no real Preview state, multiplayer flow, telemetry export, or human session is certified in this branch. See the follow-up report for exact evidence and the operator unblock; the 3.0 UX observations above remain layout/design review only.
