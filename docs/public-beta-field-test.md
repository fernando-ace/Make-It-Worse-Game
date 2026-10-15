# Make It Worse public beta field test

**Production:** https://control-room-orcin.vercel.app

## Try it with a group

- Start with 3–6 people. One host creates a room and shares the invite link; everyone else joins from the link or six-character code.
- Use a mix of iPhone Safari, Android Chrome, and a laptop if available. Try at least one player refreshing during a round and reconnecting.
- Play the full six games, including House Rules, private objectives, powers, the staged finale, optional feedback, and same-room replay.
- Have players submit feedback privately. Beta events and feedback are in `cr_private.beta_events` and `cr_private.beta_feedback` in the linked Supabase project's SQL editor; queries are in the README.

## Ask afterward

1. Which moment was the most fun, and which game was the least fun?
2. Was anything unclear or awkward to do on your phone?
3. Would you play another session with this group?

## Report a serious issue

Treat a session as blocked if a player cannot join or reconnect, private choices appear before reveal, a room loses committed progress, a player cannot complete a turn, or scores/finale results are wrong. Save the approximate time, device/browser, room code, and what the player was doing; do not share private answers publicly.

## Known limits

Players use anonymous browser sessions rather than persistent accounts. Clearing browser storage may lose the identity used to reconnect. Automated browser testing is not a substitute for physical-device and real-group feedback.
