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

`app/api/room/route.ts` authenticates each request with Supabase `getUser`, checks room membership, and commits through the revision-checked database RPC. Supabase Realtime prompts clients to sync; polling repairs missed notifications. The public beta adds server-recorded lifecycle telemetry, private post-game feedback, and scheduled expiration for abandoned room state.

## Public beta data

Telemetry is stored in the non-exposed `cr_private.beta_events` table. Database timestamps and an opaque session hash correlate events; player IDs, names, game answers, objective contents, auth tokens, and arbitrary client payloads are never stored. Server-verified lifecycle events include room creation/join, lobby reach, session and round progression, game completion, Chaos settings, House Rules, powers, objective completion/reveal, reconnects, departures, finale/completion, replay, feedback, and coarse runtime-error categories. A browser can send only landing, reconnect, feedback-open, and error-category events; the server derives the rest, including objective reveals, from committed game state.

Feedback is stored separately in `cr_private.beta_feedback`, never returned to other players, and keyed for duplicate prevention by a session-scoped HMAC. It captures a 1–5 fun rating, replay intent, favorite and least-favorite game, confusion notes, and optional comments. The form asks players not to include names, contact details, or private game choices; email addresses, phone-like strings, and URLs in free text are redacted before storage.

The Vercel Cron Job calls `/api/cron/cleanup` daily using the production-only `CRON_SECRET`. It removes room state after 14 days without activity, telemetry after 180 days, and feedback after 365 days. Active rooms keep updating their activity timestamp; expired invite links lead back to the normal “room not available” recovery flow.

For a quick beta readout, open the Supabase SQL editor for the configured project and run:

```sql
select event_name, date_trunc('day', occurred_at) as day,
       count(*) as events, count(distinct session_key) as sessions
from cr_private.beta_events
where occurred_at >= now() - interval '30 days'
group by 1, 2 order by 2 desc, 1;

select fun_rating, play_again, favorite_game, least_favorite_game,
       confusion, comment, created_at
from cr_private.beta_feedback
where created_at >= now() - interval '30 days'
order by created_at desc;
```

The event table has a fixed payload shape: `event_name`, database `occurred_at`, optional opaque `session_key`, optional `room_id` (only on room-specific records), `game_id`, `game_number`, `player_count`, `chaos_intensity`, `house_rule_id`, `power_id`, and coarse `error_code`. No player or auth identifiers, names, answers, objective text, or free-form event properties are accepted. The session key is SHA-256 of the room ID and server-only session seed. Automated live tests can also create lifecycle telemetry and should be excluded from product conclusions by their validation window.

| Event | Meaning |
| --- | --- |
| `landing_viewed` | A browser loaded the landing page in this tab session. |
| `room_created` | The server created a room. |
| `room_joined` | A new member joined a room. |
| `lobby_reached` | The server observed a member in the lobby. |
| `session_started` | The room began a game session. |
| `chaos_intensity_selected` | The committed room setting changed. |
| `game_started` | A round entered active play. |
| `session_round_reached` | The session advanced to a round number. |
| `game_completed` | A round result was committed. |
| `house_rule_selected` | A House Rule was committed for a round. |
| `power_used` | A power action was committed. |
| `objective_completed` | The server counted an objective completion without recording its text. |
| `objective_revealed` | A member explicitly requested their post-game objective reveal. |
| `reconnect_attempted` | A browser began its reconnect flow. |
| `reconnect_succeeded` / `reconnect_failed` | The reconnect flow recovered or failed, by coarse error category. |
| `player_left` | A member left or was removed from the room. |
| `finale_reached` | The session entered its finale. |
| `session_completed` | The final result was committed. |
| `replay_started` | A completed room started another session. |
| `feedback_opened` | A revealed player opened the optional feedback form. |
| `feedback_submitted` | The server stored the member's optional feedback. |
| `runtime_error` | The browser reported a coarse auth, network, server, or unknown error category. |

The feedback query above is for authorized project operators; do not export or share free-text responses without reviewing them for identifying details.

## Running locally

Requires Node.js 22 or newer and npm. Install local dependencies with `npm ci`; the local validation checks below do not require a Supabase project. Running the multiplayer app requires a dedicated non-production Supabase project configured as described below.

```sh
npm ci
cp .env.example .env.local
```

Set these values in `.env.local` and in the hosting environment:

| Variable | Purpose | Browser visible |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (legacy anon key also works) | Yes |
| `SUPABASE_SECRET_KEY` | Server-only key used by room API routes | No |
| `CRON_SECRET` | Vercel Cron bearer secret used by the cleanup route | No |

Never commit `.env.local` or expose the server key or cron secret through a `NEXT_PUBLIC_` variable. Enable Anonymous Sign-ins, apply the migrations in `supabase/migrations/`, and confirm `cr_rooms` is in the `supabase_realtime` publication. For an existing linked project, inspect its migration history before changing it.

After configuring the dedicated development project, run `npm run dev` and open `http://localhost:3000`. The script runs `next dev --hostname 0.0.0.0`. To serve a local production build, run `npm run build` followed by `npm start` (`next start --hostname 0.0.0.0`).

## Validation

### Local checks (no Supabase or browser required)

After `npm ci`, run the configured checks from the repository root:

```sh
npm run lint
npm run typecheck
npm test
npm run test:simulation
npm run build
```

| Command | Configured script | Coverage |
| --- | --- | --- |
| `npm run lint` | `eslint .` | Repository lint checks |
| `npm run typecheck` | `tsc --noEmit` | TypeScript checks |
| `npm test` | `vitest run` | All `tests/**/*.test.ts` tests, including the simulation suite |
| `npm run test:simulation` | `vitest run tests/session-simulation.test.ts` | Focused deterministic simulation run |
| `npm run build` | `next build` | Production build |

These checks use local dependencies and do not need Supabase credentials, a running Supabase service, or Playwright browsers. Vitest covers game input/resolution, privacy, deterministic scoring, 1,001 Session Director lineups, objectives, powers, replay, and API behavior with mocked services. The simulation runs 1,000 complete seeded sessions across 2–8 players; running it separately repeats the simulation coverage included in `npm test`.

See [docs/session-simulation.md](docs/session-simulation.md) for the deterministic simulation coverage and findings.

### Service-dependent browser checks

Use a dedicated non-production Supabase project with Anonymous Sign-ins enabled, the reviewed migrations applied, and `cr_rooms` in the `supabase_realtime` publication, as described above. Configure its URL, publishable key, and server-only key in `.env.local` (both browser suites load this file) or the test process environment. Never point these checks at production: they create test rooms and anonymous users and attempt to delete them afterward; live tests can also leave beta telemetry.

Install Playwright's Chromium browser and the operating-system dependencies it requires before running:

```sh
npx playwright install --with-deps chromium
npm run test:live
npm run test:party
```

- `test:live` runs `playwright test tests/live.spec.ts`: two consecutive six-game, three-player sessions, including reconnect, private state, powers, awards, and same-room replay.
- `test:party` runs `playwright test tests/party.spec.ts`: a six-game, two-player session at 390px, checking horizontal overflow after every round.

By default, Playwright starts `npm run dev` at `http://localhost:3000` or reuses a server already running there. Ensure any reused server uses the same dedicated test project. To test an existing non-production app server, set `PLAYWRIGHT_BASE_URL`; this disables automatic server startup. That server and the test process must use the same dedicated Supabase project.

Report these browser checks separately from local validation. A skipped test (including `test:live` when credentials are missing) is not evidence that live multiplayer passed.

## Production release and field testing

The production Vercel project is connected to the `master` branch. Before release, inspect the exact commit and migration history, run the validation suite above, apply only reviewed pending migrations, and push the reviewed commit to `master`. Verify the resulting Vercel production deployment, smoke test the public URL and multiplayer flows, and inspect Vercel function logs. If a release is broken, roll back to the last known-good production deployment and then fix forward. Keep preview deployments protected; production must remain publicly reachable.

Use [docs/public-beta-field-test.md](docs/public-beta-field-test.md) for a short group play test, device checklist, questions, and issue severity guide.
