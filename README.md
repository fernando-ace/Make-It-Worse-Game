# Make It Worse

Make It Worse is a browser party game for 2–8 friends. Players join with a short room code or invite link, play six quick social games, and let each round's winner stack House Rules that change what comes next.

## Current game loop

1. A host creates a room. Friends join with the six-character room code or a copied invite link.
2. The host starts once at least two players are present.
3. Play the configured six-game lineup: Split Decision, Make It Worse, Trust Me, Split Decision, Pile On, and Make It Worse.
4. Every player makes a private choice. Choices reveal together when everyone commits or the 45-second timer ends.
5. The round winner selects a server-generated House Rule. Its effect persists into later games, and Double Down can stack.
6. The final screen shows standings and only the social awards supported by recorded session events.

**Split Decision** rewards minority picks. **Make It Worse** rewards calling the room's favorite escalation. **Trust Me** mixes a shared payout, a safe point, a gamble, and a swipe. **Pile On** resolves callouts and shields at once, showing who got targeted and who got through.

## House Rules

House Rules persist through later games:

- **Underdog:** the player in last place earns +1 if they score points in the next round.
- **Bounty:** the server marks a random player. Each other player whose base score beats the marked player's base score earns +2.
- **Double Down:** base points are doubled in later games. Underdog and Bounty bonuses are then applied. Double Down can stack.

The server chooses the offered cards, records the selection in private room state, and applies its scoring effect. The client cannot choose its own score, winner, or active rule.

## Run locally

Requires Node.js 22 or newer, npm, and a Supabase project.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set these values in `.env.local` and in the hosting environment:

| Variable | Purpose | Browser visible |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (legacy anon key also works) | Yes |
| `SUPABASE_SECRET_KEY` | Server-only key used by room API routes | No |

Never commit `.env.local` or expose the server key through a `NEXT_PUBLIC_` variable.

## Supabase setup

1. Enable Anonymous Sign-ins under Authentication → Sign In / Providers. Players use an anonymous Supabase identity and do not see a login screen.
2. Apply the SQL in `supabase/migrations/20261002040000_control_room.sql` and `supabase/migrations/20261006003724_room_membership_removal.sql` to a fresh project. For an existing linked project, inspect its migration history before pushing migrations.
3. Confirm `cr_rooms` is in the `supabase_realtime` publication.
4. Set the three environment variables above.

The included local Supabase config only contains this app's auth settings. Merge those settings into a generated local Supabase config before starting a local Supabase stack.

## Architecture and authority

- `lib/types.ts` defines the shared minigame contract, private round inputs, public reveal, and score events. `lib/games/` contains each registered game and structured prompt data. `lib/engine.ts` owns room transitions, validation, reveal timing, common House Rule scoring, winner selection, and session awards.
- `app/api/room/route.ts` authenticates each request with Supabase `getUser`, checks membership, and commits each change through a revision-checked database RPC. Concurrent actions retry against the newest room revision.
- Canonical room state—including unrevealed choices—stays in the server-only `cr_private.states` table. `snapshot()` returns only the current player's submission status and choice until reveal; other players' choices are omitted from the snapshot until results.
- `cr_rooms` contains room notifications and `cr_members` tracks membership. Existing RLS and service-only RPC boundaries isolate rooms and prevent browser clients from writing authoritative state.
- Supabase Realtime prompts clients to sync; a short polling interval repairs missed notifications. Reopening a browser with its saved anonymous session reconnects the same player. A new player can join only before the host starts.

The registry defines game identity, options, configuration, input validation, authoritative resolution, and reveal output. The server selects six distinct games by shuffling registered IDs with the server-created room ID as the session seed; the same seed reproduces the same order. Game results expose base points and structured events; the common scorer applies House Rules consistently.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
# Requires configured real Supabase credentials and anonymous sign-in:
npm run test:live
npm run test:party
```

Unit/API tests cover every game's validation, privacy, deterministic resolution, scoring, House Rule interaction, and reconnect state. `test:live` uses three isolated browser contexts against the configured Supabase project and completes all six games. `test:party` checks a mobile party flow at 390px and horizontal overflow.
