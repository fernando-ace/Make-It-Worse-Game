# Party Night beta field-test kit

Use a dedicated non-production build and Supabase project for real groups. Do not use the production URL or production data for validation. Automated CI uses a disposable local Supabase stack; human playtests still need a reachable non-production app configured against a dedicated non-production Supabase project.

## Before

1. Open the approved Party Night beta Preview URL.
2. Run `npm run beta -- doctor` using the approved beta environment. Confirm `deploymentClass` is `preview`, `backendClass` is `beta`, the printed project ref matches the approved beta ref, and production/beta safety is clear. Doctor output contains no secrets.
3. Confirm the Vercel Preview deployment is `READY` and its Supabase URL resolves to that beta ref. If the doctor is unknown, denied, or shows the Production ref, stop without opening the game.
4. Share the invite link/code. Ask each player to use their own browser profile.

## During

Record only:

- Player count, device/browser mix, approximate session time, and opaque session reference
- Confusion, laughter, negotiation, betrayal, waiting/dead time, and memorable reveals
- Create/join, lock/wait, reconnect, or layout problems and the phase where they occurred

Do not write names, room codes, raw private answers, objective text, hints, tokens, or contact details. Use approximate elapsed time and game/phase for notes. Avoid identifiable quotes.

## After

1. Ask the short player feedback questions below and complete one results template.
2. Export with `npm run beta -- export --since <ISO-date> --out work/beta-evidence.json`.
3. Run `npm run beta:analyze -- work/beta-evidence.json` and note the sample sizes and limitations.
4. Keep AUTOMATED EVIDENCE, HUMAN OBSERVATION, and PRODUCT HYPOTHESIS separate. Do not infer enjoyment from simulation or telemetry counts.
5. If the test room is disposable, remove only that room with `npm run beta -- cleanup --room-id <uuid> --room-code <code> --confirm`. Doctor and cleanup must continue to refuse Production.

## Cohorts and setup

- Run separate sessions with 2, 3–4, and 5–6 players. Try 7–8 when the group is available.
- Mix phone and desktop players. At least one phone should be near 390 px wide and one near 430 px.
- Ask one observer to take notes. Have each player use their own browser profile so reconnect identity remains distinct.
- Play a complete six-game session. If time allows, ask the group to replay in the same room.
- Ask one player to refresh or background their browser during an intro, after locking a choice, between beats, and during results.

## Observer instructions

Explain only the controls the UI does not make clear. Record what people do before helping.

Note timestamps and game/phase for:

- Confusion, rereading, or asking what a prompt means
- Dead time and waiting for another player
- Spontaneous negotiation, promises, betrayals, accusations, and targeting
- Reactions, laughter, memorable reveals, and score explanations people question
- Whether someone asks for a rematch without prompting

Do not record names, raw choices, private hints, objective text, or identifiable quotes. Use the separate human observation section in the results template and keep it separate from automated evidence and product hypotheses.

### Party Night 3.0 social UX observations

Let players discover the controls without a walkthrough. For each phase, note where they pause, reread, or ask for help, and whether they look up from the phone to talk.

- Landing: do players understand Create game, Join game, invite links, and room codes without coaching?
- Lobby: can the host tell what blocks starting, and can players spot who is present and who is hosting?
- Decisions: do players understand the prompt and choices, then lock in without reading secondary panels?
- Multi-beat games: do players distinguish public information from their private report, and talk during the transition?
- Waiting: does the aggregate lock count explain what is happening without calling out a specific person?
- Chaos, powers, and objectives: can players find their balance, inspect a power's cost and target, and check their private goal when needed?
- House Rules: can a winner explain what their rule changes and when it starts? Do later reminders help without prompting?
- Results: do players understand who gained points and why? Record reactions to reveals, targeting, betrayals, and score swings.
- Finale: are objective and award reveals clear, does the recap recall a real moment from this session, and is replay easy to find?
- Recovery: after a brief offline period or refresh, can players tell they reconnected and returned to the same phase?

Record the device width and height, whether the keyboard was open, where scrolling occurred, and whether the primary action stayed reachable. Do not record names, raw choices, private hints, objective text, or identifiable quotes.

## Short post-game questions

1. Most fun moment or game?
2. Weakest game?
3. What was confusing?
4. Did House Rules change your decisions?
5. Why did you save or spend Chaos?
6. Did your secret objective change how you played?
7. Would you play again immediately?
8. What would you change first?

## Report a blocker

Treat a session as blocked if a player cannot join or reconnect, hidden choices appear before reveal, committed progress disappears, a player cannot complete a turn, or scores/finale results are wrong. Record app build, device/browser, approximate time, cohort size, and phase. Do not include private answers or identifiers in issue reports.

Complete one [beta results template](beta-results-template.md) per session. Summarize sanitized server-derived exports locally with `npm run beta:analyze -- <sanitized-export.json>`; the analyzer rejects private feedback and unapproved fields. Automated evidence cannot answer which game was fun or whether a player intended a betrayal.
