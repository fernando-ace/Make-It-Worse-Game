# Party Night 3.1 safe beta certification

## Decision and current status

This is a safety and infrastructure milestone for the existing Party Night 3.0 game. It adds no game content or balance changes. The repository-side guardrails, operator commands, evidence schema, and ephemeral CI workflow are prepared. The live multiplayer certification is **blocked pending an isolated Supabase project**. The hosted Preview is intentionally disabled from Supabase so it cannot create anonymous users, rooms, telemetry, or feedback in Production.

The previous Vercel configuration was unsafe: both Preview and Production resolved `NEXT_PUBLIC_SUPABASE_URL` to the same Supabase project, **`jfosecuafntktpudjhyj`**. That ref is Production. No room, user, feedback, telemetry, E2E request, migration, or other beta operation was sent to it during this milestone. Production Supabase URL and key values were not changed.

| Environment | Actual backend / state | Certification status |
| --- | --- | --- |
| Vercel Production | Supabase `jfosecuafntktpudjhyj` | Supabase URL/key values unchanged; a non-secret public `NEXT_PUBLIC_DEPLOYMENT_CLASS=production` marker was added for the client guard. No production deployment or write was performed. |
| Vercel Preview | Supabase variables set to inert `.invalid` / placeholder values | Supabase disconnected and nonfunctional until isolated beta provisioning |
| Beta Supabase | None exists in the authorized account | Blocked: no free project slot; no resource created |
| Local/CI Supabase | Ephemeral local Supabase in GitHub Actions | Workflow is configured to apply migrations and run full-stack browser tests; hosted run evidence is pending |

The connected `fernando-ace’s Org` account already has two active free projects: Make It Worse Production and the unrelated Auburn Marketplace. Its free-project quota rejected creation of a dedicated Make It Worse Beta project. The unrelated Auburn project and other applications were not reused, paused, or modified. A Supabase branch quote was **$0.01344/hour** (about **$9.68/month** if kept running continuously, before any other usage); creating it would incur cost and was not authorized. No production data would be copied by a branch, but no branch was created.

**Operator unblock:** an organization owner must either arrange a dedicated beta project after safely freeing an eligible free-project slot without touching Production or unrelated application data, or explicitly authorize a paid dedicated project/branch. Then provide its project URL, publishable key, and server secret through the approved secret manager, and record its exact project ref in Preview configuration. Do not re-enable Preview using the production ref.

## Environment safety and Vercel

`lib/environment-safety.mjs` centralizes deployment class, parsed Supabase ref, backend classification, and permissions. Runtime writes are allowed only for Production→Production, Preview→explicit Beta, and Development/Test→explicit Test or local Supabase. A Preview pointing at the known production project is refused. Unknown or malformed configuration does not grant permission. `lib/server.ts` and `lib/browser.ts` guard client creation; mutating room, beta, feedback, and cleanup routes reject before database access as well.

`npm run beta` (or `npm run beta -- doctor`) emits only safe metadata and permission flags. Never use environment names alone as proof: inspect the URL hostname/ref without printing keys, compare it with the approved beta ref, and verify Production still points to `jfosecuafntktpudjhyj`. Preview currently has deliberately inert Supabase values. Production Supabase values, domains, aliases, DNS, and deployment were not changed. A non-secret deployment-class marker is configured for future production builds so the client guard can distinguish legitimate Production from Preview. No Preview→Production promotion occurred.

Once a beta resource exists, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SECRET_KEY` for Preview to that project. Set `NEXT_PUBLIC_DEPLOYMENT_CLASS=preview`, `NEXT_PUBLIC_BETA_SUPABASE_PROJECT_REF` and `BETA_SUPABASE_PROJECT_REF` to the exact ref. `SUPABASE_PROJECT_REF` may also be set to catch URL/ref mismatches. Keep Production variable targets unchanged. Rebuild the Preview branch and verify the deployed public URL resolves to the beta ref before opening the app.

## Schema and data security

The repository migration chain is the source of truth. Existing migrations enable anonymous sign-in, keep private session state in `cr_private`, enable RLS, grant game RPCs only to `service_role`, and publish only `public.cr_rooms` to Realtime. Room membership and snapshots remain server-authorized; browser Realtime messages only prompt a sync. Anonymous users do not get direct access to private tables or authoritative game state.

The new `20261018120312_party_night_safe_beta_operator.sql` migration adds a private, RLS-protected server-derived metrics table plus allowlisted record/export RPCs and a one-room cleanup RPC. The metrics schema excludes names, submissions, objective contents, hints, offers, player IDs, auth material, and arbitrary payloads. Evidence export selects fixed columns from private telemetry and metric tables, never feedback free text, room IDs, or private game rows. Cleanup requires one matching room UUID and code and removes only that room plus linked beta feedback/events/metrics. Existing expiry policy removes idle rooms after 14 days, telemetry/metrics after 180 days, and feedback after 365 days.

Static migration/RLS review is complete. Applying migrations, checking actual catalog grants/policies/publications, anonymous sign-in, cross-room rejection, Realtime behavior, and Supabase security advisors against a dedicated non-production project are **not complete** because no such project is available. No claim of live schema certification is made.

## Operator workflow

```sh
npm run beta -- doctor
npm run beta -- export --since 2026-01-01T00:00:00Z --out work/beta-evidence.json
npm run beta:analyze -- work/beta-evidence.json
npm run beta -- cleanup --room-id <uuid> --room-code <code> --confirm
```

The doctor never prints secret values. Export and cleanup require an explicitly classified non-production beta backend and refuse `jfosecuafntktpudjhyj`. Export writes mode-600 JSON under ignored `work/`, revalidates every row against a field allowlist, and excludes private feedback and game state. Cleanup requires explicit `--confirm`, a room UUID and matching six-character code, then uses a narrowly scoped server RPC. There is no generic database wipe/reset command.

## Validation evidence

### Automated evidence completed locally

- `npm ci` passed; no dependency was added.
- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` passed on the corrected implementation. `npm test` passed **151 tests across 11 files**, including environment refusal cases, API privacy behavior, and the 1,000-session deterministic simulation.
- `npm test` passed: **151 tests across 11 files**, including environment refusal cases, API privacy behavior, and the 1,000-session deterministic simulation.
- `npm run test:simulation` passed for **1,000 sessions**; all 20 games were reachable. `npm run test:balance` passed for **10,000 sessions**, covering 8,054 lineups, 50,000 rule activations, and all 20 games. No balance or gameplay math changes were made.
- The local Supabase container startup was attempted, but the registry returned HTTP 403. No live browser test could run locally.

### Live non-production evidence

**No dedicated-beta or deployed-Preview evidence exists.** Preview is deliberately disconnected. The hosted GitHub workflow uses an ephemeral local Supabase stack, applies migrations, and runs Chromium for all four multi-beat games, three-player six-game/replay, two-player mobile, reconnect, deadline, and eight-player mobile. Run `39126434086` (`b2dbb91c158e35105f1fcee4cbb8cebd4244d5ba`) passed `validate` but its five parallel browser jobs failed: Docker Hub rate limiting and obsolete `Connected`/landing assertions. Run `39126793020` (`db796045dbbba699dfdd0b61d340d95a9047984f`) passed `validate`; its browser test reached the app and failed on a stale landing-heading assertion. Run `39127074085` (`bb903c32a5ae549e4794a62a4e3ab807e93ff3e8`) passed `validate`, migration reset, and ephemeral Supabase startup, then found a reconnect test-helper bug: private-field assertions ran on the correctly null lobby session. Run `39127417407` (`3ee4168d70f9c35c8c26baa18d9ce7e81de2a394`) passed `validate`, migration reset, and browser startup, progressed through three-player room creation/join and lobby reconnect, then failed because the test checked a replacement context's API snapshot before its response callback fired. Run `39127693580` (`bd36ad6411154e718656aa492eef2e0158d4570d`) passed the same setup and progressed to reconnecting from lobby into the session intro, but the test helper incorrectly required an unchanged phase while the server advanced. Run `39127953553` (`818f1df9066f1c539e07604320343158f5a77797`) passed validation and ephemeral database setup, then exposed a stale lobby snapshot in the browser assertion; the assertion now waits for the authoritative host and guest intro snapshots before verifying restored identity and game number. Run `39128264288` (`8ce3ba8c7022bec2cf3df5583b16c940651485f4`) passed `validate`, built the local Supabase stack, and passed live three-player play through finale; it exposed that the recap reveal stage reset on refresh even though the caller's objective reveal was persisted. The UI now restores the recap at the objective-revealed stage from the caller-filtered server snapshot. A new hosted rerun is required after this fix.

The following are explicitly outstanding against an isolated beta backend and deployed Preview: full three-player session, 390px/430px two-player session, four-game private payload checks, real Realtime/reconnect, deadline/stale/idempotency, replay, eight-player room, real-state UI review, telemetry inspection/export, and analyzer processing of a real export. A successful hosted ephemeral CI run is automated full-stack evidence, not deployed-preview certification. Synthetic analyzer fixtures, stubs, and simulations do not count as live beta evidence.

### Human evidence and limitations

No human party session has been performed as part of this milestone. After live beta certification and Preview isolation, use [the field-test checklist](public-beta-field-test.md) and [results template](beta-results-template.md). Physical VoiceOver/TalkBack, mobile keyboard behavior, safe-area handling, text scaling, and actual group reactions still require human/device checks. Do not claim physical assistive technology coverage until performed.

## Next milestone

Provision the isolated beta resource without touching Production, apply and inspect migrations, set Preview-only credentials, rebuild and verify the Preview ref, then run the hosted workflow and live certification matrix. Only after evidence passes should the operator share the Preview link with a human group. The next gameplay decisions should come from those sessions, not speculative content or a balance rewrite.
