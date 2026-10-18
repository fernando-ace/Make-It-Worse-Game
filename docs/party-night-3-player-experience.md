# Party Night 3.2 · Player Experience

## Baseline journey audit (before implementation)

This audit was completed against safe-beta `576e1e69b677cef72a4b6bdc79548db0afbc36cc`. The preceding 3.0 audit in `party-night-3-social-ux.md` records existing rendering evidence; this pass adds a component/source journey review before edits. No real room or production backend was used.

| Stage | Primary question / action | Secondary information | Social opportunity | Confusion risk | Visual / pacing issue |
| --- | --- | --- | --- | --- | --- |
| Landing / name | How do I get my group in? Enter a name, create or join. | Invite prefill, guest connection, privacy. | Name recognition, share link. | Create and join share one form; join is disabled until code complete; an initial connection error can look like a dead end. | Strong wordmark, but many chips and copy compete with two CTAs; create action is visually dominant. |
| Create / join / invite | Create a room or enter six-character code. | Validation and loading. | Invite people immediately. | Error ownership and status can be unclear while identity initializes. | Inputs and actions form one dense card; invite details are not part of the entry journey. |
| Lobby / readiness / host | Who is here, and can we start? Host starts once at least two are present. | Presence heartbeat, host, Chaos intensity. | Arrival, teasing, invite sharing. | “Here” reflects connection heartbeat rather than an explicit ready action; host start constraints are distributed. | Room banner, roster, and setup card compete; Chaos setting has equal visual weight to inviting. |
| Intro / session escalation | What is this game asking, and what changed? Start the round. | Score hint, scenario, active rules, session position, finale bonuses. | Negotiate stakes before committing. | Long instructions and explanation can bury the one action; session 5/6 copy adds density. | Intro uses a large card with several nested explanation panels and no short “do this” summary. |
| Active choice / target selection | What is my decision, and who am I targeting? Choose then lock. | Timer, Chaos/power, objective, current rule, standings/history. | Read friends, bluff, threaten. | Active choice and metadata share the screen; 8-player targeting and consequences require scanning. | Persistent score rail and details keep dashboard context beside the primary decision. |
| Committed / waiting | Did it submit, and what now? Wait for the room. | Aggregate answered count and timer. | Talk without exposing choices. | Lock is shown, but the waiting cue competes with decision controls; no player names should be exposed. | Progress is a thin bar and waiting copy is small; spinner-free status can be more prominent. |
| Two-beat phase 1 / public reveal / private report | What became public or private, and when do I choose again? | Public lines and owner-only hint. | Explicit talk window. | Public and private are text-labelled, but their visual distinction relies heavily on color/small labels. | Board precedes the choice but the phase transition and next action are not one persistent sequence. |
| Phase 2 / powers / objectives | How do I use my clue, power, or objective? | Cost, target, availability and private progress. | Targeted powers create a call-out moment. | Power effect/cost/eligibility can be hidden in an expandable area; private objective is always present. | Secondary systems make the decision surface long on phones. |
| Results / score explanation | What happened, who won, and why did scores move? | Option counts, choices, score reason, modifier. | React to a betrayal or alliance. | Score change is visible, but reason appears as a dense line for every player; the story is not staged. | Reveal groups plus a roster-like breakdown create a table effect. |
| House Rule choice / activation | What twist did I earn, what changes, and when? Choose a rule. | Stackability, target, plain-language effect. | Winner takes control; group reacts. | Similar cards and dense descriptions make consequences hard to compare quickly. | Selection is a form-like grid; activated rules later accumulate in a large list. |
| Intermission / standings | Who leads, what changed, and what is next? Continue. | Rule history, game lineup, swing, score. | Call out a comeback or new rule. | Too many paragraphs compete with next game CTA; standings lack rank-change context. | Intermission and finale reuse card-and-list presentation. |
| Finale / objective reveal / awards / recap | Who won, what secrets land, and what should we remember? Replay. | Records, awards, scores over time, feedback. | Celebrate and retell real moments. | Several staged reveals can delay replay; recap is long and similar in visual weight to the winner. | Winner, objective, awards, records and replay appear in one tall stack; climax is not visually distinct enough. |
| Reconnect / expired / full / invalid / backend failure | Is my room recovering, or do I need a new invite? | Honest retry guidance. | Ask host for fresh link. | Recoverable and terminal conditions may both appear as a generic landing error. | Status remains in a connection label and error block; no unified recovery stage. |

### Representative stress cases

- At 2 players, wording should say “one more friend” and keep invite/start visible. At 4, roster balance matters. At 8, target choices must remain thumb-sized and names must wrap without clipping.
- Long names and copy need intentional wrapping. Scores near one another call for rank changes; runaway scores call for chasing context without implying the game is over.
- Zero/low Chaos, unaffordable power, a used power, and targeted power need distinct availability copy. High Chaos must read as a spendable wallet, not a score.
- Many rules need contextual active-rule reminders and a history disclosure. Private objectives and clues must remain owner-only; aggregate waiting must not identify slow players.
- Responsive review targets are 390, 430, short-height 390×640, landscape-like 844×390, 768, and 1440. Baseline source review found existing breakpoints but no deterministic way to inspect real presentation states without a service-backed room.

## Product principles

- The next player action and its consequence come before session bookkeeping.
- Private information says who can see it in text and iconography, not color alone.
- Waiting uses committed-player totals only; it never names who is slow.
- The UI displays scores, effects, and event history received from the engine. React does not resolve choices or calculate points.
- Fixture controls change only fixture state. The lab never writes storage or calls game services.
- A six-game progress cue and active-rule count make rising stakes visible without adding decorative noise.
- Motion is short and state-specific. The existing reduced-motion preference removes it.

## UX Lab architecture

`/ux-lab?state=<fixture>` is rendered by `app/ux-lab/page.tsx`. The server route returns 404 in production. A labelled fixture selector navigates among deterministic states: landing, invalid/expired join, 2/4/8-player and ready lobbies, intro, choice/selected/locked/waiting, target selection, both multi-beat stages, private objective, power/Chaos availability, House Rule choice, result/swing, intermission, finale/awards, and reconnect/recovery.

The lab uses the real `PlayerRoster`, `InviteActions`, `LandingEntry`, `ObjectiveCard`, `PowerControls`, and shared presentation components (`GameStage`, `SessionProgress`, `ChoiceTile`, `PlayerChip`, `VisibilityLabel`, `LockedState`, `HouseRuleChoice`, and `ScoreReveal`). Fixture content is synthetic and labelled; local preview actions produce status feedback and do not mutate a room or call Supabase. It has no backend client and does not copy gameplay resolution.

Playwright links can address any state directly. `npm run test:ux-lab` checks fixture actions, private/public labels, lock states, objective reopening, unaffordable powers, target selection, keyboard focus, reduced motion, no service calls, and overflow at 390×844, 390×640, 430×932, 844×390, 768×1024, and 1440×1000. Set `UX_LAB_CAPTURE=1` to capture the 18-state responsive review set under ignored `work/ux-lab-review/`.

## Shared component and visual-system changes

Added a small set of domain components rather than a general UI framework. `GameStage` provides a named main region; `SessionProgress` shows the arc and live rule count; `PlayerChip` provides consistent player identity and target affordance; `ChoiceTile` is the shared option button; `VisibilityLabel` names public/private scope with an eye icon; `LockedState` announces commitment and room progress; `ChaosWallet` explains balance and spend/save context; `HouseRuleChoice` standardizes next-game rule choices; and `ScoreReveal` presents engine-authored score reasons.

The palette stays with the established paper, aubergine, lime, and orange identity. New treatments use a six-color player avatar palette, a stripped-back open decision stage, a lime finale progress cue, distinct public/private surfaces, a larger prompt scale, and explicit selected/locked motion. No package, remote font, image asset, or UI framework was added. All motion is CSS and disabled by reduced-motion.

## Landing, lobby, and active game

The landing promise now reads “Friends play short games. Winners change the rules. Every round gets worse.” Create and join remain separate explicit actions, while `LandingEntry` is shared with the UX Lab. Name/code labels and validation association remain intact; mobile text inputs are 16px to avoid unwanted browser zoom, and invite URL prefill remains in the existing parser. Errors keep the existing honest, recoverable room/network copy.

The lobby retains the live host, room, and connected-player rules. Its roster, copy actions, and start eligibility remain real application components; no pretend “ready” state was added because the game currently uses connection presence and host start. Start eligibility still explains the actual blocker. The lab includes fixture-only 2-, 4-, and 8-player layouts and copy actions.

During play, the six-game progress rail sits above the stage. The prompt stays first; the score rail remains collapsible. Existing server-derived House Rule callbacks stay near the decision. Generic options use `ChoiceTile`; options encoding another player (`target:`, `reach:`, `pass:`, `favor:`) use large, thumb-friendly, identity-colored player chips. Selected and unavailable states remain button states; no target is inferred client-side.

## Multi-beat, private objectives, Chaos and powers

Multi-beat screens keep the existing `BEAT 1 OF 2` / `BEAT 2 OF 2` contract and add clear eye-icon labels: “EVERYONE CAN SEE” and “ONLY YOU CAN SEE”. Public context and the private report have distinct text and surfaces. The midpoint says to talk before the next move. The waiting status combines “Locked in” / “Your move” with aggregate `n / total in` and retains no responder names.

Objectives remain a native disclosure with private labeling and progress; the player can reopen and close it. Power controls now put the Chaos wallet amount and finale saving value in the disclosure summary. Each power lists name, effect, target when relevant, and an explicit Chaos cost; an unaffordable power explains how much more is needed. Power choices still submit through the existing server action and use server-returned private intel.

## House Rules, results, finale, and replay

`HouseRuleChoice` gives each choice the same timing label, name, consequence, and action. In later rounds, the most recent rule remains contextual and the accumulated rule/history details stay inspectable. Session progress shows how many rules are shaping the room. No rule effect or scoring has changed.

`ScoreReveal` gives the group a “WHAT HAPPENED” hierarchy, a round-winner marker, each player's selected answer, signed score movement, and the existing engine-authored reason. It does not rebuild or re-total the score. Existing event-backed moment lines and option counts remain visible. The finale retains its real standing, objectives, awards, event records, score progression, and same-room replay CTA; the finale progress state now receives a stronger lime cue. No moment is invented by the production recap.

## Mobile, desktop, accessibility and performance

The visual matrix covers 390px, 430px, short-height 390×640, landscape-like 844×390, 768px, and 1440px. Six/eight-player choices wrap in two columns with long names allowed to break; input and action heights remain touch-sized. Desktop keeps a centered stage and a narrower optional standings rail rather than stretching a phone column across the full window. The Lab suite checks document width against viewport width across representative states.

Controls use native buttons, inputs, disclosures, and selects. Choice and target controls expose `aria-pressed`; fixture tests verify keyboard focus, visible labels, the timer role, public/private scope, and disabled power copy. Reduced-motion is checked in Chromium. Contrast was reviewed visually against the existing dark/light palette; automated color-contrast linting was not added. Physical VoiceOver/TalkBack, actual mobile keyboard resize, device safe-area, and text scaling still need devices.

No dependency or image was added. New player and score components are small; there is no animation library or client-side scoring. Production build emits a server-rendered `/ux-lab` route guarded by a production 404. A detailed before/after bundle-size comparison is unavailable because the baseline did not retain build artifacts; build output and client bundle size are recorded after final validation.

## Validation and remaining limits

The UX Lab has a repeatable browser matrix and screenshot capture mode. Its fixture screenshots validate layout and interaction feedback, not successful multiplayer or human enjoyment. Hosted ephemeral Supabase CI is the source of actual API-backed full-stack evidence for the three-player six-game/replay, two-player mobile, four two-beat games, privacy/reconnect/deadline, and eight-player target flow. This branch extends that workflow and adds the UX Lab suite.

The engine and scoring were not changed. Validation completed on branch `feat/party-night-3-player-experience`, based on `origin/feat/party-night-3-safe-beta` at `576e1e69b677cef72a4b6bdc79548db0afbc36cc`:

- `npm ci`, lint, typecheck, and four complete unit-suite invocations passed (151 tests each).
- Production build passed. `/ux-lab` returned HTTP 404 under `next start` with `NODE_ENV=production`.
- Local Chromium UX Lab suite passed 6 tests; its screenshot-only test is opt-in and was run separately, capturing 108 state/viewport images for visual review.
- Responsive overflow and fixture state review covered 18 states at 390×844, 390×640, 430×932, 844×390, 768×1024, and 1440×1000. The shared landing, eight-player target picker, and desktop finale were visually reviewed.
- The 1,000-session simulation passed with all 20 games reachable. The 10,000-session analysis passed with 8,054 distinct six-game lineups, 20,586 multi-beat appearances, 50,000 rule activations, and all 20 games represented.
- Generated static client chunks total approximately 1.0 MB (`.next/static/chunks`). No baseline artifact was retained for a before/after comparison; no new dependency or large asset was introduced.
- Hosted ephemeral Supabase browser CI is pending the branch push. Its final run ID, commit SHA, and outcome will be recorded after it completes; that run is the full-stack evidence for multiplayer scenarios, not the fixture suite.

Preview multiplayer is intentionally disconnected. The known production project is `jfosecuafntktpudjhyj`; there is no unused free Supabase project slot, and a branch would cost about `$0.01344/hour`. No spend is approved. No production service was used for this work. The field-test handoff distinguishes automated fixture/full-stack evidence from blocked deployed-beta evidence and still-needed physical-device/human sessions. Remaining human checks are physical phone safe areas, keyboard resizing, text scaling, VoiceOver/TalkBack, and observation of real group negotiation, reactions, and replay intent.
