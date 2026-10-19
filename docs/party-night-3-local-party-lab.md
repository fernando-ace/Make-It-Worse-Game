# Party Night 3.3 Local Party Lab

The Local Party Lab is the free path to real human playtests. It runs the same Next.js game and the repository's real local Supabase Auth, database, RPC, RLS, and Realtime stack. Phones and laptops use Fernando's private LAN address for both the game and Supabase. It does not use a fake backend or a deployed Vercel environment.

The deployed Vercel Preview remains multiplayer-disabled until Fernando separately approves and provisions isolated cloud infrastructure. No spend is approved. Do not reconnect Preview to Production.

## Prerequisites and network model

- Node.js 22 or newer, npm dependencies installed, Docker Desktop/Engine running, and network access the first time the Supabase CLI and Docker images are downloaded.
- Leave several gigabytes available in Docker's image/data storage for the Supabase containers. A full Docker image store makes first startup fail before the app starts.
- The repository's Supabase CLI config uses API/Kong port `54321`; Auth is `/auth/v1`, REST/RPC is `/rest/v1`, and the Realtime WebSocket is `/realtime/v1/websocket`. Anonymous sign-in is enabled. The database migration chain remains authoritative and `public.cr_rooms` remains the Realtime publication.
- Supabase CLI publishes its local API port from Docker. The operator verifies that API and Realtime answer on the selected LAN address before the game starts. If the installed Docker platform only publishes the port to loopback, the doctor reports failure; do not change the game to localhost URLs for phones.
- The Next.js dev server binds to `0.0.0.0`; participants open `http://<LAN IPv4>:3000`. Its browser client uses `http://<same LAN IPv4>:54321` for Auth, REST/RPC, and Realtime. Service credentials stay in the Next server process and never enter `NEXT_PUBLIC_*` variables.
- After dependencies and images are present, play traffic stays on the LAN. Startup does not call third-party app APIs. Docker/Supabase CLI downloads and package installation can require the Internet; fully offline first setup is not promised.

## Start and doctor

From the repository root:

```sh
npm ci
npm run party
```

The runner checks the production classification, starts only this repository's Supabase stack, applies pending migrations, detects a private IPv4 address, verifies local API/Realtime reachability, and starts Next.js on all interfaces. It prints:

```text
MAKE IT WORSE LOCAL PARTY LAB
Backend: LOCAL SUPABASE
Safety: PRODUCTION BLOCKED
Game: http://192.168.x.x:3000
Share this address with players on the same network.
```

Keep the terminal open. Ctrl+C stops the app; the local Supabase stack and its data remain running. The small `LOCAL · PROD BLOCKED` indicator appears in the landing/lobby only. Normal room invites use the same LAN origin as the phone that created them; copy/share continues to work as usual.

Run preflight separately:

```sh
npm run party -- doctor
npm run party -- doctor --host 192.168.1.50
```

The doctor checks Node, Docker, Supabase CLI, LAN address, local Auth/API reachability, Realtime WebSocket handshake, and whether the chosen Next.js port is free. It never modifies firewall rules. A Supabase failure before first startup is expected; run `npm run party` to start the stack, then run doctor again.

## Host override and Windows

If VPNs, Docker/WSL adapters, multiple NICs, or campus Wi-Fi cause the wrong address to be selected, find the IPv4 address assigned to the computer's Wi-Fi/Ethernet adapter and pass it explicitly:

```sh
npm run party -- --host 192.168.1.50
```

The address must be an RFC1918 private IPv4 address assigned to this computer. The detector prefers Wi-Fi-named adapters and skips common Docker, WSL, VM, and tunnel adapters; it prints candidates when there is more than one. It will not silently advertise a public or loopback address.

Windows PowerShell uses the same npm commands. Docker Desktop must be running with Linux containers. If Windows Firewall blocks the connection, allow Node.js on the Private network profile or ask the network administrator; do not disable the firewall or add a broad rule. Public Wi-Fi client isolation can prevent devices from reaching each other even when they share an SSID. macOS/Linux use the same Node-based runner and Docker requirement.

## Data lifecycle and operator commands

- Before a fresh session, optionally reset disposable local test data:

  ```sh
  npm run party -- reset --confirm
  ```

  This requires a running local stack, repeats the local-only safety check, deletes local database/auth data, and reapplies migrations. It preserves the schema and does not remove Docker volumes. Never run generic SQL against a supplied URL.
- During play, room state, anonymous identities, and feedback exist only in the local Supabase stack.
- After play, export the approved structured evidence and an adjacent local-only operator manifest:

  ```sh
  npm run party -- export --label "Friday group" --players 4 --devices "iPhone/Safari + Android/Chrome + laptop" --group new
  npm run beta:analyze -- work/local-party-evidence.json
  ```

  Optional fields are `--label`, `--players` (2–8), `--devices`, and `--group new|returning|mixed`. They are written only to `work/local-party-evidence.json.manifest.json` and are not sent as telemetry. The evidence export is mode-restricted where supported and stays under ignored `work/`.
- After export, data remains available. Stop the local Supabase containers when convenient:

  ```sh
  npm run party -- stop --confirm
  ```

  Stop preserves local data and stops only this repo's Supabase stack. Ctrl+C stops Next.js but leaves Supabase running for a quick replay. No evidence is deleted automatically.

Evidence contains only the existing allowlisted structured beta events/metrics, including opaque session keys, counts, game sequence, durations, rules, Chaos, powers, objective completion metadata, score movement, reconnect/replay, and error categories. It excludes auth/session tokens, service keys, raw submissions, private objective text, power offers, hints, arbitrary headers, room rows, and unrelated database records. Free-text feedback is deliberately excluded from the analyzer export; keep the brief player answers in Fernando's private field notes and remove identifying details before sharing them.

## Safety model

The operator obtains the API URL/keys from `supabase status -o env` into process memory. It rewrites only a recognized local CLI URL to the selected private IPv4. No `.env.production` or committed config is edited, no local keys are saved, and the service/secret key is passed only to the server-side beta exporter and Next server. The browser receives only the local publishable/anon key.

`lib/environment-safety.mjs` classifies loopback as local under the existing development rules. It classifies an RFC1918 target as local only when explicit Local Party mode is enabled; local export/reset also require development/test classification and a local backend. Production deployment markers, the known production Supabase ref, malformed configuration, and unknown remote hosts are refused. The Preview/Production protections from Party Night 3.1 are retained. Never set `BETA_SUPABASE_PROJECT_REF` to bypass Local Party Lab checks.

## Compact observer protocol

Choose one observer. Let people discover the controls before explaining them. During play, record only a time/game marker and a short code: **?** confusion, **…** long silence, **L** laughter, **A** accusation, **N** negotiation/promise, **B** betrayal/targeting, **P** power reaction, **H** House Rule reaction, **O** objective reveal, **M** mobile friction, **R** replay request. Do not transcribe private choices, objective text, names, or quotes. The [observer card](party-night-local-observer-card.md) is phone-friendly and printable.

After the session, ask only these eight questions: favorite moment/game; weakest game; what was confusing; whether House Rules changed play; whether the secret objective changed behavior; whether Chaos/powers were understandable; whether they would play again now; what they would change first. Then fill in the [results template](beta-results-template.md), keeping automated evidence, human observations, and hypotheses separate.

## Physical-device checklist

Codex cannot validate real phones. Fernando should test:

- iPhone/Safari if available, Android/Chrome if available, and a laptop/desktop in the same room/session; use the room invite link and code.
- First load and join time, 390px and 430px viewports, long player names, keyboard open, scrolling, touch targets, portrait/landscape, and the six-game finale/replay.
- Lock/sleep and resume, background/app resume, Wi-Fi drop/rejoin, page refresh, and backend restart. Confirm the same room and committed choice return where expected.
- VoiceOver/TalkBack, text enlargement, mobile safe areas, and actual device keyboard behavior. These remain human checks.

## Limitations and handoff

Some routers, guest networks, campus networks, and phone hotspots isolate clients. A firewall may need a narrow private-network Node.js allowance. The app requires no external runtime API, but first-time Docker image/CLI/package downloads need the Internet. This milestone does not claim physical-phone testing or human enjoyment evidence. Once a local six-game session can be run, stop the autonomous software loop: Fernando's next step is to invite friends, observe real play, export the sanitized evidence, and return the completed results package before choosing another major gameplay goal.
