# Architecture

This document explains how YOS is put together and why. For setup, see the [README](../README.md).

- [Code layout](#code-layout)
- [Credits](#credits)
- [Exchanges](#exchanges)
- [Countries and shipping routes](#countries-and-shipping-routes)
- [Background jobs](#background-jobs)
- [HTTP API](#http-api)
- [Caching](#caching)
- [Privacy and security](#privacy-and-security)
- [Launch checklist coverage](#launch-checklist-coverage)

## Code layout

```
src/
  app/          Routes, layouts and pages. Pages compose features and call server functions.
  features/     One folder per feature: components/, api/ (server actions), model/
    accounts/     sign-up, sign-in and account actions
    listings/     book cards, listing forms, listing details, wish list
    exchanges/    request panel, sender and requester panels, message thread, timeline
    support/      report form, tickets
    admin/        staff actions, route form
    content/      FAQ and policy text
  shared/
    ui/           design-system primitives, ActionForm, toast, book covers
    api/          session, server-action runner, problem+json helpers, country detection
    lib/          framework-free helpers: countries, vocabularies, ISBN, formatting, ids
  server/       Everything that talks to the database. No React or Next.js imports.
    domain/       business rules: credits, listings, routes, users, support, catalog, files, ...
      exchanges/    core (state machine), request, response, shipping, completion,
                    disputes, staff, conversation, jobs, queries
    queries/      read models for pages: admin, member, site
    jobs/         scheduled work: runner, email delivery
db/migrations/  SQL migrations, applied in filename order
scripts/        migrate, seed, jobs, bundle budget check
tests/          Vitest suites that run against a real PostgreSQL database
```

ESLint enforces the boundaries, so they don't drift:

- A feature never imports another feature. Shared code moves to `src/shared`.
- `src/shared` never imports from `src/features` or `src/app`.
- `src/server` only uses `src/shared/lib`, and never React or Next.js.
- Only `src/server` imports the database client. Pages and actions call a query or domain function.
- No barrel (`index.ts`) files.

Server data is loaded in Server Components, and mutations are Server Actions. There's no client-side data store. After a successful action the page re-renders on the server, and a short-lived cookie carries the confirmation message to a toast in the root layout.

Every route has a client JavaScript budget in `bundle-budget.json` (brotli-compressed). `npm run bundle:check` reads the build manifests and fails when a route goes over.

## Credits

A credit isn't money. It's an internal unit for requesting books, with no cash value, and members can't transfer it.

`credit_ledger` is the source of truth. A trigger rejects every `UPDATE` and `DELETE` on it, so history can only grow. `credit_accounts` holds each member's available and reserved balances. It's updated in the same transaction as the ledger row, under a row lock, and `CHECK (available >= 0 AND reserved >= 0)` makes a double spend impossible even if application code has a bug.

| Event                     | Available | Reserved | When                                                   |
| ------------------------- | --------- | -------- | ------------------------------------------------------ |
| `credit_reserved`         | −1        | +1       | A member requests a book                               |
| `credit_released`         | +1        | −1       | Declined, expired, cancelled, or the sender didn't ship |
| `credit_spent`            | 0         | −1       | The exchange completes (requester)                     |
| `credit_earned`           | +1        | 0        | The exchange completes (sender)                        |
| `credit_refunded`         | +1        | −1       | A dispute is decided for the requester                 |
| `credit_admin_adjustment` | ±n        | 0        | Staff correction, with a reason and an audit record    |
| `credit_reversed`         | −Δ        | −Δ       | Undoes an earned credit or an adjustment               |

Ledger rows carry an idempotency key derived from the exchange (`reserve:<id>`, `earn:<id>`, ...). The key is unique, so a sender earns a credit exactly once per exchange. If a key is replayed with different values, the write is refused rather than silently ignored.

When an exchange settles, both wallets are locked in a fixed order so two settlements can't deadlock, and transactions retry on serialization failures. `reconcile()` compares every wallet with its ledger. The admin credit page shows the result, and the CSV export lists every member side by side.

## Exchanges

A request is an exchange in the `requested` state. Transitions are validated on the server against a table in `src/server/domain/exchanges/core.ts`, and every change is written to `exchange_events`, which members see as a timeline.

```
requested ──accept──▶ accepted ──ship──▶ shipped ──recipient confirms──────────────────▶ completed
   │  │                  │                  │
   │  │                  │                  └─ tracked parcel past its delivery window,
   │  │                  │                     or staff ──▶ delivered ──3 days──▶ completed
   │  │                  │
   │  └ decline/expire   └ sender cancels or misses dispatch (credit released)
   └ requester cancels

shipped or delivered ──dispute──▶ disputed ──▶ completed | refunded
```

- Requesting a book locks the listing row, and a partial unique index allows at most one live exchange per copy. Two members can't reserve the same book.
- A request form carries a one-time key. Submitting twice returns the same exchange; reusing the key for a different book is refused.
- Members can't mark a parcel as delivered by the carrier. Delivery comes from the recipient's confirmation, a staff action, or the auto-confirm rule for tracked parcels.
- Opening a dispute stops the completion clock until staff decide. The decision and its reason go to both members and to the audit log.

Deadlines live in `src/server/config.ts`: 3 days to respond, 5 business days to dispatch, and a 3-day window after delivery to report a problem.

## Countries and shipping routes

Every ISO country is seeded. Exchanges are open in the UK, Ireland, the US and Canada, and in limited preview in Australia and New Zealand. Every other country starts on the waitlist, where people can sign up and draft listings but can't exchange.

A route is an explicit origin to destination row with its own tracking rule, delivery estimate, customs notice, weight limit, risk level and indicative postage. UK to US and back is seeded but disabled, so you can see how an unsupported route looks. A cross-border route can't be enabled until it has a customs notice.

The country banner reads common CDN geolocation headers and falls back to the browser's language. It's only a suggestion, and visitors can always change it.

## Background jobs

`src/server/jobs/runner.ts` runs small, single-purpose jobs: two email lanes, expiring requests, cancelling missed dispatches, auto-confirming tracked deliveries, completing exchanges after the dispute window, deadline reminders, pausing stale listings, redacting old addresses and purging the cache.

- **Safe to run twice.** Each item is processed in its own transaction under `FOR UPDATE SKIP LOCKED` and re-checks its state first. Each job also holds a Postgres advisory lock, so only one server runs it at a time.
- **One bad item can't block the rest.** A failing item is retried on later runs. After 5 failures it's parked in `job_failures`, and staff can retry or dismiss it under Admin → Jobs & queues.
- **Email.** Messages are written to `email_outbox` in the same transaction as the change they describe, so the email worker can never pick up a message for a change that was rolled back. Verification and password-reset mail has its own lane. Retries use exponential backoff with jitter, and permanent failures are marked dead.
- **Visibility.** Each run writes a structured log line and a `job_runs` row. `GET /api/v1/health` returns 503 when email is stale or dead, items are parked, or deadlines are overdue.

Run the jobs every few minutes with `npm run jobs` from cron, or `POST /api/v1/jobs` with the `x-jobs-secret` header. Member pages also trigger them at most once a minute, so deadlines are still enforced if the scheduler stops.

## HTTP API

The member site uses Server Actions, which aren't a public API. The HTTP endpoints are for operations, monitoring and data requests, and are documented in [`openapi.yaml`](openapi.yaml):

| Endpoint                 | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `GET /api/v1/health`     | Uptime check. 503 when degraded.                    |
| `POST /api/v1/jobs`      | Run scheduled jobs. Needs `x-jobs-secret`.          |
| `GET /api/v1/me/export`  | Download everything YOS holds about the member.     |
| `GET /files/{id}`        | Listing photos, avatars, proof of postage, evidence |

Responses are wrapped in `{ data }`, errors use RFC 9457 `application/problem+json`, and 429 responses include `Retry-After`. Catalog search and wallet history use cursor pagination, so pages stay stable while new rows arrive.

## Caching

There's one cache, in front of the optional Open Library ISBN lookup, because that's an external, rate-limited service. It's cache-aside in Postgres (`src/server/cache.ts`):

- Keys are versioned (`isbn:v1:…`), so bumping the version clears a namespace.
- Entries live 7 days, plus up to a day of jitter so they don't all expire together.
- "Not found" is cached for an hour. Errors are never cached.
- Concurrent misses for the same key share one upstream call.
- Hit, miss and error counts appear on the admin jobs page.

Everything else reads straight from the database. Country and route lookups are indexed primary-key reads, and the eligibility check made when a request is submitted always reads fresh data.

## Privacy and security

- Passwords are hashed with scrypt. Sessions are random tokens, stored as SHA-256 hashes, in an httpOnly, SameSite=Lax cookie.
- Next.js checks the origin of every Server Action, and every action also checks who is signed in and what they're allowed to do.
- A sender sees the delivery address only after accepting the request. Address snapshots are redacted 60 days after the exchange closes.
- Uploads are checked by their content, not their file name, and limited to 5 MB. They're served with `nosniff` and a sandboxed content security policy. Proof of postage and dispute evidence are visible only to the two members and to staff.
- Staff permissions are role-based (`src/server/rbac.ts`). Every sensitive staff action needs a reason and is written to the append-only `admin_audit_logs`.
- Members can download their data and close their account. Closing anonymizes the account but keeps the ledger.
- Sign-in, sign-up, requests, listings, messages, reports and tickets are rate limited.

## Launch checklist coverage

How the launch checklist from the product plan maps to the code:

| Requirement                                                            | Where                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Visitors can choose or correct their country; IP is only a suggestion | Country banner in `src/app/layout.tsx`, profile settings |
| Unsupported routes can't complete a request                            | `checkEligibility`, test *blocks unsupported routes*     |
| Register and verify email                                              | `/signup`, `/verify-email`                               |
| Create, edit, pause and remove listings with format, condition, photos | `/my/books`, `publishListing`                            |
| Search and filter                                                      | `/explore`, `searchListings`                             |
| No request without credits, no double spend, no double reservation     | `tests/exchanges.test.ts`                                |
| Declined or expired requests release the credit                       | `tests/exchanges.test.ts`, `tests/jobs.test.ts`          |
| Credit is earned once, never for listing                               | test *awards the sender's credit only once*              |
| A dispute pauses completion                                            | test *pauses the normal completion path*                 |
| Admin adjustments need a reason and an audit record                    | `adminAdjust`, `tests/credits.test.ts`                   |
| Addresses visible only for fulfilment                                  | test *hides the delivery address*                        |
| Reports and support tickets                                            | `ReportForm`, `/support`, `/admin/reports`               |
| Admins can disable a country or route                                  | `/admin/countries`                                       |
| Policies published                                                     | `/legal` (drafts awaiting legal review)                  |
| Works on mobile and desktop                                            | Responsive CSS, no horizontal scrolling on phones        |
