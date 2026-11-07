# YOS — Your Open Shelf

A community book exchange that runs on credits. Members list physical books they own. Other members request them with YOS credits. The sender ships the book directly to the requester and earns a credit once the exchange completes.

> **List a book. Send it to another reader. Earn a credit. Use that credit to request your next read.**

This repository is the website MVP described in the *YOS Global Business & Platform Blueprint* (§24.1). It's a responsive web app built with Next.js 16 (App Router, Server Actions) and PostgreSQL. It has no other runtime dependencies apart from `zod`.

## Quick start

```bash
# 1. PostgreSQL 14+ with a database and role
createuser -P yos          # password: yos
createdb -O yos yos
createdb -O yos yos_test   # for the test suite

# 2. Install, configure, migrate and seed
npm install
cp .env.example .env
npm run db:reset           # applies migrations and loads demo data (development only)

# 3. Run
npm run dev                # http://localhost:3000
npm test                   # test suite (uses yos_test)
npm run check              # lint + import boundaries, tests, build, bundle budget (same as CI)
```

Coding conventions live in `CLAUDE.md`. Frontend work follows the `frontend-architecture` skill. Backend work follows `api-design`, `background-jobs` and `caching`. All four are vendored in `.claude/skills/`.

**Demo accounts** (password `yos-demo-password`):

| Email | Role | Notes |
|---|---|---|
| `admin@yos.local` | Admin | Full admin area |
| `moderator@yos.local` | Moderator | Disputes, reports, support, listing moderation |
| `maya@yos.local` | Member (UK) | Has completed the blueprint's §3.2 example exchange with Alex |
| `alex@yos.local` | Member (UK) | Has a book in transit from Maya |
| `sam@yos.local` | Member (Ireland) | Has a request from Maya waiting for a response |
| `jordan@yos.local` / `priya@yos.local` | Members (US / Canada) | Cross-border exchange, accepted and waiting for dispatch |

In development, email is written to an outbox, not sent. Open `/dev/outbox` to click verification and password-reset links. Set `ENABLE_DEV_OUTBOX=true`; the outbox never works in production.

## Scheduled jobs

Scheduled work is split into small jobs in `src/server/jobs/runner.ts`: two email lanes, expiring requests, missed dispatch, auto-confirmation, completion after the dispute window, reminders, stale listings, address redaction and cache purge. You can trigger them three ways:

- `npm run jobs`, from cron every few minutes, or
- `POST /api/v1/jobs` with the header `x-jobs-secret: $JOBS_SECRET`, or
- **Run all jobs now** in the admin area.

Member pages also trigger them opportunistically, at most once a minute per instance.

These rules come from the background-jobs skill:

- **Safe to repeat.** Each item is handled in its own transaction under `FOR UPDATE SKIP LOCKED` and re-checks its state first, so running an item twice does no harm. Each job also holds a Postgres advisory lock, so only one instance runs it at a time.
- **Poison items can't block the queue.** A failing item is retried on later runs. After 5 failures it's parked in `job_failures` and skipped, and staff can retry or dismiss it under **Admin → Jobs & queues**.
- **Email.** Email is written in the same transaction as the change it describes (outbox pattern). Security mail (verification, password reset) has its own lane. Retries use exponential backoff with jitter. Permanent failures go straight to `dead`.
- **Observability.** Every run writes a structured log line and a `job_runs` row. `GET /api/v1/health` returns 503 when email is stale or dead, items are parked, or exchange deadlines are overdue, so alerts fire on age as well as failures.

## HTTP API

`docs/openapi.yaml` (OpenAPI 3.1) documents the endpoints. It follows the api-design skill: everything is versioned under `/api/v1`, success responses are wrapped in `{ data }`, errors use RFC 9457 `application/problem+json`, and 429s include `Retry-After`. The member-facing site uses Server Actions, which are not a public API. Request idempotency keys are matched against the request they were first used for: replaying the same request returns the original result, and reusing a key for a different request is refused. Catalog search and wallet history use cursor pagination.

## Caching

Following the caching skill, the only cache is in front of a slow, rate-limited upstream: the optional Open Library ISBN lookup (`src/server/cache.ts`). It is cache-aside in Postgres with versioned keys (`isbn:v1:…`), a 7-day TTL plus jitter, 1-hour negative caching, no caching of errors, single-flight for concurrent misses, and hit/miss/error counters shown in the admin area. Country and route lookups are indexed primary-key reads and aren't cached. Request-time eligibility checks always read the database.

## Architecture

```
src/
  app/          Routing, layouts and pages only. Composes features
  features/     One folder per feature. Features never import each other (enforced by ESLint)
    listings/     components/ (BookCard, CopyFields, ListingBadge), api/actions.ts
    exchanges/    components/ (ExchangeList, ExchangeBadge), api/actions.ts
    accounts/     api/ (auth and account actions)
    support/      components/ReportForm, api/actions.ts
    admin/        api/actions.ts
    content/      model/ (FAQ, policy drafts), components/FaqList
  shared/
    ui/           Design-system primitives, ActionForm, Flash toast, book media
    api/          Session/auth, server-action runner (error mapping), problem+json helpers, geo
    lib/          Framework-free helpers (countries, vocabularies, ISBN, formatting)
  server/       Backend. No React or Next.js imports (enforced)
    db.ts, clock.ts, config.ts, rbac.ts, rate-limit.ts, http.ts (outbound client), cache.ts
    domain/       credits, exchanges, listings, routes, users, support, catalog, files, analytics, audit, notifications
    jobs/         runner (locks, dead letters, health), email (outbox delivery), types
db/migrations/  SQL schema
scripts/        migrate, seed, jobs, check-bundle
tests/          Vitest suites against a real PostgreSQL database
```

`npm run lint` enforces the import rules. `bundle-budget.json` sets a brotli budget for each route's client JavaScript, and `npm run bundle:check` fails the build when a route exceeds it. CI (`.github/workflows/ci.yml`) runs lint, tests against PostgreSQL, the build and the bundle budget.

### Credit integrity (§9, §18.5)

- `credit_ledger` is the source of truth. A database trigger rejects every `UPDATE` and `DELETE` on it. Each row stores the event type, the deltas for available and reserved credits, the reason, the actor, the related exchange, and a unique idempotency key.
- `credit_accounts` is a summary that is updated in the same transaction while the row is locked. `CHECK (available >= 0 AND reserved >= 0)` makes a double spend impossible, even if application code has a bug.
- Ledger idempotency keys are derived from the exchange (`reserve:<id>`, `earn:<id>`, …). As a result, a sender earns a credit **exactly once per exchange**.
- Each request locks the listing row, so two concurrent requests can't take the same copy. A partial unique index (`exchanges_one_live_per_listing`) enforces the same rule a second time at the database level.
- Settlement locks both wallets in a fixed order to avoid deadlocks. Transactions retry on serialization failures.
- `reconcile()` compares every wallet with its ledger. The admin credit page and the CSV export show the result.

| Event | available | reserved | When |
|---|---|---|---|
| `credit_reserved` | −1 | +1 | Request submitted |
| `credit_released` | +1 | −1 | Declined / expired / cancelled / sender missed dispatch |
| `credit_spent` | 0 | −1 | Exchange completed (requester) |
| `credit_earned` | +1 | 0 | Exchange completed (sender) |
| `credit_refunded` | +1 | −1 | Dispute resolved for the requester |
| `credit_admin_adjustment` | ±n | 0 | Staff correction (reason + audit log required) |
| `credit_reversed` | −Δ | −Δ | Reverses an earned credit or an adjustment |

### Exchange lifecycle (§10)

```
requested ──accept──▶ accepted ──ship──▶ shipped ──recipient confirms "as described"──▶ completed
   │  │                  │                  │  └─(tracked & delivery window passed / staff)─▶ delivered ──(3-day window)──▶ completed
   │  └─decline/expire   └─sender cancels / misses dispatch (credit released)   └──────── dispute ────────┐
   └─requester cancels                                                         disputed ──▶ completed | refunded
```

The server validates every transition against the table in `src/server/domain/exchanges.ts`. Members can't mark a parcel as carrier-delivered. Only the recipient's own confirmation, a staff action, or the auto-confirm rule for tracked parcels can move an exchange to delivered.

### Countries and routes (§4)

Every ISO country is seeded. Exchanges are **open** in GB, IE, US and CA, and in **limited** preview in AU and NZ. Every other country starts on the **waitlist**. A route is an explicit origin→destination row that has its own settings for tracking, delivery estimate, customs notice, weight limit, risk level and indicative postage. GB↔US is seeded but disabled, so you can see how an unsupported route is labelled. A cross-border route can't be enabled until it has a customs position. Country detection reads common CDN geo headers and falls back to `Accept-Language`. It is only a suggestion, and visitors can always change it.

### Privacy and security

- Passwords are hashed with scrypt. Sessions are random tokens stored as SHA-256 hashes in an httpOnly, SameSite=Lax cookie.
- Server Actions get Next.js's origin check, and every action also re-checks authentication and authorization.
- Addresses are private. A sender sees an address snapshot only after accepting the request. Snapshots are redacted 60 days after the exchange closes.
- Uploads are type-checked by their content (magic bytes), not their file name, and limited to 5 MB. They're served with `nosniff` and a sandbox CSP. Proof of postage and dispute evidence are visible only to the two members in the exchange and to staff.
- Staff have role-based permissions (`src/server/rbac.ts`). Every sensitive staff action requires a reason and is written to the append-only `admin_audit_logs`.
- Members can download their data (`/api/v1/me/export`) and close their account, which anonymizes it while keeping the ledger.
- Rate limits apply to sign-in, registration, requests, listings, messages, reports and tickets.

## Blueprint acceptance checklist (Appendix A)

| Requirement | Where |
|---|---|
| Visitor can choose or correct their country; IP is only a suggestion | Country banner in `app/layout.tsx`, `lib/geo.ts`, profile settings |
| Unsupported routes can't complete a request | `routes.checkEligibility`, test *blocks unsupported routes* |
| Register + verify email | `/signup`, `/verify-email`, test *registers, verifies…* |
| Create, edit, pause and remove listings; format, language, condition and photos required | `/my/books/*`, `listings.publishListing` |
| Search and filter | `/explore`, `listings.searchListings` |
| No request without credits; no double spend; no double reservation | Tests in `tests/exchanges.test.ts` |
| Declined or expired request releases the credit | Tests *ending a request before shipment…* |
| Sender can accept, decline, dispatch and enter tracking | `/exchanges/[id]` |
| No credit for creating a listing; credit awarded once | Test *awards the sender's credit only once* |
| Dispute pauses completion | Test *pauses the normal completion path* |
| Admin adjustments require a reason and an audit record | `credits.adminAdjust`, tests in `tests/credits.test.ts` |
| Addresses visible only for fulfilment | Test *hides the delivery address…* |
| Report listings and members; support cases | `ReportForm`, `/support`, `/admin/reports` |
| Essential notifications | `domain/notifications.ts` (in-site + email outbox; essential types can't be switched off) |
| Admins can disable a country or route | `/admin/countries`, test *lets admins disable a route* |
| Policies published | `/legal/*` (drafts marked as pending legal review) |
| Mobile and desktop | Responsive CSS; no horizontal overflow on phone widths |

## Not in this MVP (by design or still to do)

- **Premium (YOS Plus) and payments.** These are blueprint Phase 2. The data model has `users.plan` and plan-based listing limits.
- **Carrier APIs, label purchase and live rate quotes.** Postage figures are admin-entered *indicative* estimates and are labelled that way.
- **Email provider.** The default `EmailTransport` in `src/server/jobs/email.ts` logs to the console. Implement that interface for a transactional email provider; every send passes an idempotency key the provider can use to deduplicate.
- **Malware scanning.** `files.scan()` is a hook that currently accepts every file.
- **Object storage.** Uploads go to `UPLOAD_DIR` on local disk. Use object storage in production.
- **Shared rate limiting.** The limiter is in memory, which only works on a single instance. Move it to Redis or Postgres when running several instances.
- **More languages.** The launch language is English. The data model and formatting (`Intl`) are ready for localization.
- **Legal review.** Every policy page is a draft pending review by counsel in each market (§20).
