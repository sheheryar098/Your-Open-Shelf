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
npm test                   # domain test suite (uses yos_test)
```

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

Deadlines, auto-confirmation, completion after the dispute window, reminders, stale-listing pauses, address redaction and email delivery all run in `runJobs()`. You can trigger it three ways:

- `npm run jobs`, from cron every few minutes, or
- `POST /api/jobs` with the header `x-jobs-secret: $JOBS_SECRET`, or
- the **Run now** button in the admin overview.

Member pages also trigger it opportunistically, at most once a minute, so deadlines are still enforced if the scheduler is down.

## Architecture

```
src/
  domain/        Business logic. Pure server code with no framework imports; the tests exercise it directly
    credits.ts     Append-only ledger + wallet summary, reserve/release/spend/earn/refund/adjust/reverse
    exchanges.ts   Exchange state machine, deadlines, disputes, messages, reviews, scheduled processing
    listings.ts    Listing lifecycle, publish rules, search, wish-list alerts, moderation
    routes.ts      Country status + route matrix + eligibility checks
    users.ts       Registration, sessions, verification, profile, privacy export/closure, staff actions
    support.ts     Addresses, reports, support tickets, public profiles
    catalog.ts     Shared catalog records (one per ISBN), optional Open Library metadata lookup
    files.ts       Uploads (content-sniffed, size-limited, access-controlled), malware-scan hook
    analytics.ts   Admin overview and KPIs (north star: successful exchanges per month)
  app/           Pages, layouts, route handlers and server actions (thin wrappers around domain/)
  lib/           db, auth/session, RBAC, rate limiting, clock, formatting, vocabularies
db/migrations/   SQL schema
scripts/         migrate, seed (reference + demo data), jobs
tests/           Vitest suites against a real PostgreSQL database
```

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

The server validates every transition against the table in `exchanges.ts`. Members can't mark a parcel as carrier-delivered. Only the recipient's own confirmation, a staff action, or the auto-confirm rule for tracked parcels can move an exchange to delivered.

### Countries and routes (§4)

Every ISO country is seeded. Exchanges are **open** in GB, IE, US and CA, and in **limited** preview in AU and NZ. Every other country starts on the **waitlist**. A route is an explicit origin→destination row that has its own settings for tracking, delivery estimate, customs notice, weight limit, risk level and indicative postage. GB↔US is seeded but disabled, so you can see how an unsupported route is labelled. A cross-border route can't be enabled until it has a customs position. Country detection reads common CDN geo headers and falls back to `Accept-Language`. It is only a suggestion, and visitors can always change it.

### Privacy and security

- Passwords are hashed with scrypt. Sessions are random tokens stored as SHA-256 hashes in an httpOnly, SameSite=Lax cookie.
- Server Actions get Next.js's origin check, and every action also re-checks authentication and authorization.
- Addresses are private. A sender sees an address snapshot only after accepting the request. Snapshots are redacted 60 days after the exchange closes.
- Uploads are type-checked by their content (magic bytes), not their file name, and limited to 5 MB. They're served with `nosniff` and a sandbox CSP. Proof of postage and dispute evidence are visible only to the two members in the exchange and to staff.
- Staff have role-based permissions (`src/lib/rbac.ts`). Every sensitive staff action requires a reason and is written to the append-only `admin_audit_logs`.
- Members can download their data (`/api/me/export`) and close their account, which anonymizes it while keeping the ledger.
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
- **Email provider.** `deliverQueuedEmail()` logs to the console. Connect a transactional email provider there.
- **Malware scanning.** `files.scan()` is a hook that currently accepts every file.
- **Object storage.** Uploads go to `UPLOAD_DIR` on local disk. Use object storage in production.
- **Shared rate limiting.** The limiter is in memory, which only works on a single instance. Move it to Redis or Postgres when running several instances.
- **More languages.** The launch language is English. The data model and formatting (`Intl`) are ready for localization.
- **Legal review.** Every policy page is a draft pending review by counsel in each market (§20).
