# Make It Worse

Make It Worse is a browser party game for 2–8 friends. Players join with a room code or invite link, play six short social games, and let choices, rivalries, alliances, private goals, and House Rules shape the whole session. The server runs the game; each player's hidden information is delivered only to that player until the reveal.

## A session

1. A host creates a room and shares the invite link or six-character code. Friends join without creating an account; Supabase anonymous auth preserves identity on reconnect.
2. The host keeps the Standard Chaos setting or chooses High to give everyone 3 starting Chaos instead of 2. The setting is validated and stored server-side, then preserved on replay. When everyone is ready, a deterministic Session Director builds a six-game arc from the server's session seed. It balances intensity, mechanic families, social information, player count, and finale suitability. A fresh replay seed avoids repeating the previous lineup.
3. Players read a short contextual instruction, choose privately, and reveal together when everyone locks in or the round timer expires.
4. Recorded events update scores, private objectives, Chaos, and session callbacks. The round winner chooses one of up to four server-selected House Rules compatible with upcoming games; the finale skips a rule that would never take effect.
5. Chaos is earned through play and spent on rotating, privately offered powers. Each player can use one power per game; choices and outcomes remain server-authoritative.
6. The final game uses standings and earned progress for a bounded lead/comeback bonus. Results reveal objectives, event-backed awards, session moments, and score progression in stages. The host can replay in the same room with player identities preserved.

## Game registry

Sixteen games cover prediction, social targeting, alliances, risk, bluffing, passing danger, protection, shared effort, and group incentives. New games live in `lib/games/` and register through `lib/games/index.ts` or `lib/games/party.ts`.

Each `MinigameDefinition` supplies an id, short instructions, options/configuration, input validation, deterministic resolution, and structured events. Add `GameDirectorMetadata` for mechanic family, social intensity, information visibility, betrayal potential, coordination, randomness, player range, expected duration, session suitability, House Rule tags, and finale suitability. Emit structured events for any interaction that should affect scoring, objectives, or the recap. Do not derive authoritative state in the UI.

## Session systems

- **Session Director:** `lib/director.ts` deterministically chooses a distinct, paced arc. Tests cover 1,001 seeded lineups across player counts 2–8.
- **House Rules:** `HOUSE_RULES` and common scoring are in `lib/engine.ts`. Rules declare compatible future game families, stacking behavior, activation timing, and explicit effects. Each scoring modifier is retained in the result so players can see why points changed. Add a rule by updating the `HouseRuleEffect` union, registry/compatibility, server-side scoring, explanation copy, and focused engine tests.
- **Objectives:** `lib/objectives.ts` assigns unique feasible goals from the actual lineup and power offers. Progress is based on recorded events and retained privately per player. Add an objective with compatible games, target/reward, optional friend or power constraints, and an event matcher.
- **Chaos and powers:** `lib/powers.ts` defines costs, intent, target requirements, and rotating deterministic offers. The engine checks eligibility, affordability, and once-per-game limits, then applies effects in an explicit server-side order. Add a power with its event/outcome semantics, private offer rules, privacy tests, and result messaging.
- **Awards and recap:** `lib/games/index.ts` resolves awards from session events. Unsupported categories stay absent; ties are resolved by stable player order. `sessionRecap` in `components/control-room.tsx` renders event-backed callbacks and score progression.

## Authority and privacy

`lib/engine.ts` owns room transitions, session progression, input validation, deterministic outcomes, scoring, Chaos, powers, and objective progress. `snapshot()` returns a role-filtered view: canonical seeds, objectives, active powers, unrevealed submissions, and other players' private intel stay server-side. A reconnect receives the same player's permitted state. Do not move identity, time, outcomes, or canonical scores to client input.

`app/api/room/route.ts` authenticates each request with Supabase `getUser`, checks room membership, and commits through the revision-checked database RPC. Supabase Realtime prompts clients to sync; polling repairs missed notifications. Existing SQL boundaries and migrations are sufficient; no schema change is needed for the session systems.

## Running locally

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

Never commit `.env.local` or expose the server key through a `NEXT_PUBLIC_` variable. Enable Anonymous Sign-ins, apply the migrations in `supabase/migrations/`, and confirm `cr_rooms` is in the `supabase_realtime` publication. For an existing linked project, inspect its migration history before changing it.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run test:simulation
npm run build
# Requires configured real Supabase credentials and anonymous sign-in:
npm run test:live
npm run test:party
```

Vitest covers game input/resolution, privacy, deterministic scoring, 1,001 Session Director lineups, objectives, powers, replay, and API behavior. `test:simulation` runs 1,000 complete seeded sessions across 2–8 players. `test:live` completes two consecutive six-game, three-player sessions against the configured Supabase project, including reconnect, private state, powers, awards, and same-room replay. `test:party` completes a six-game, two-player session at 390px and checks horizontal overflow after every round. These live checks create temporary test rooms/users and clean them up.

See [docs/session-simulation.md](docs/session-simulation.md) for the deterministic simulation coverage and findings.
