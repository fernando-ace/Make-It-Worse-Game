# Party Night beta field-test kit

Use a dedicated non-production build and Supabase project for real groups. Do not use the production URL or production data for validation. Automated CI uses a disposable local Supabase stack; human playtests still need a reachable non-production app configured against a dedicated non-production Supabase project.

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

## Field test checklist

1. Use the approved non-production build; confirm each player has a separate browser profile.
2. Note the build, approximate start time, opaque session key, player count, and device/browser mix.
3. Play through the finale. Observe confusion, waiting, negotiation, reactions, and requests to replay without coaching the group.
4. If someone refreshes or briefly loses network, confirm they return to the same player and phase. Record any lost choice or unexpected private information as a blocker.
5. Ask the short post-game questions and complete one results template. Keep observations separate from hypotheses.
6. Export only approved sanitized evidence. Keep the key/time cross-reference and raw notes private; never attach participant identity or private answers.
