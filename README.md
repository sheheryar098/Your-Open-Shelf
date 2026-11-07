# YOS: Your Open Shelf

[![CI](https://github.com/sheheryar098/Your-Open-Shelf/actions/workflows/ci.yml/badge.svg)](https://github.com/sheheryar098/Your-Open-Shelf/actions/workflows/ci.yml)

**List a book. Send it to another reader. Earn a credit. Use that credit to request your next read.**

YOS is a community book exchange. Members list physical books they own, other members request them with credits, and the owner posts the book directly to the reader. When the exchange completes, the sender earns a credit to spend on any other book on the shelf. Nobody has to find someone who wants their exact book.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Running in production](#running-in-production)
- [Status and roadmap](#status-and-roadmap)
- [Contributing](#contributing)

## Features

**For members**

- Browse and search by title, author, ISBN, category, format, language and condition, filtered to books that can actually ship to you
- List a book from the catalog or by hand, with photos of your own copy and an honest condition note
- Request books with credits, choose a delivery address, and follow each exchange through accepted, shipped and delivered
- A wallet showing available, reserved and pending credits, with the full history behind every change
- Messages between the two members of an exchange, feedback once it completes, and disputes when something goes wrong
- A wish list that alerts you when a copy that can reach you is listed
- Country-aware from the first visit, with exchanges limited to shipping routes we support
- Download your data or close your account at any time

**For the team running it**

- Queues for disputes, reports and support tickets
- Member, listing and exchange management, with restrictions, suspensions and deadline extensions
- A credit ledger that can't be edited after the fact, with reconciliation and a CSV export
- Country and shipping-route controls: tracking rules, delivery estimates, customs notices, weight limits
- Analytics on completed exchanges, dispatch times, disputes and route performance
- Job and email monitoring, plus an audit log of every staff action

## Tech stack

- [Next.js 16](https://nextjs.org) with the App Router, Server Components and Server Actions
- [PostgreSQL](https://www.postgresql.org) 14 or later, accessed with plain SQL through [`pg`](https://node-postgres.com)
- TypeScript, [Zod](https://zod.dev) for input validation
- [Vitest](https://vitest.dev) for integration tests against a real database
- ESLint and Prettier, with GitHub Actions running lint, tests, build and a bundle-size budget

There's no ORM and no CSS framework. The styles are a single stylesheet with light and dark themes.

## Getting started

You'll need Node.js 20 or later and PostgreSQL 14 or later.

```bash
# 1. Create a database user and two databases (one for the app, one for tests)
createuser -P yos            # enter the password "yos"
createdb -O yos yos
createdb -O yos yos_test

# 2. Install and configure
git clone https://github.com/sheheryar098/Your-Open-Shelf.git
cd Your-Open-Shelf
npm install
cp .env.example .env

# 3. Create the schema and load demo data
npm run db:reset

# 4. Start the app
npm run dev
```

Open http://localhost:3000 and sign in with one of the demo accounts. They all use the password `yos-demo-password`.

| Email                 | Who                                                          |
| --------------------- | ------------------------------------------------------------ |
| `admin@yos.local`     | Administrator, with the full admin area                       |
| `moderator@yos.local` | Moderator: disputes, reports, support and listings            |
| `maya@yos.local`      | UK member who has sent a book to Alex and requested one from Sam |
| `alex@yos.local`      | UK member with a book on its way from Maya                    |
| `sam@yos.local`       | Irish member with Maya's request waiting for a response       |
| `jordan@yos.local`    | US member waiting for a book from Priya in Canada             |
| `priya@yos.local`     | Canadian member who has accepted Jordan's request             |

In development, emails aren't sent. They're stored in an outbox you can read at http://localhost:3000/dev/outbox, so you can click verification and password-reset links.

## Configuration

Settings come from environment variables. `.env.example` has working defaults for local development.

| Variable            | Default                                    | Purpose                                                           |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`      | `postgres://yos:yos@localhost:5432/yos`    | PostgreSQL connection string                                      |
| `APP_URL`           | `http://localhost:3000`                    | Public URL, used in email links                                   |
| `UPLOAD_DIR`        | `storage/uploads`                          | Where photos and evidence are stored                              |
| `JOBS_SECRET`       | `change-me`                                | Secret for `POST /api/v1/jobs`. The endpoint is off until you change it. |
| `ENABLE_DEV_OUTBOX` | `true`                                     | Shows `/dev/outbox`. It never works in production builds.         |
| `CATALOG_LOOKUP`    | empty                                      | Set to `openlibrary` to fill in book details from an ISBN         |
| `TEST_DATABASE_URL` | `postgres://yos:yos@localhost:5432/yos_test` | Database used by `npm test`. It's wiped on every run.           |

Deadlines, limits and other business rules live in [`src/server/config.ts`](src/server/config.ts).

## Scripts

| Command                | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | Start the development server                                    |
| `npm run build`        | Production build                                                |
| `npm start`            | Serve the production build                                      |
| `npm test`             | Run the test suite against `TEST_DATABASE_URL`                  |
| `npm run lint`         | Check formatting, lint rules (including import boundaries) and types |
| `npm run format`       | Format everything with Prettier                                 |
| `npm run bundle:check` | Fail if any page's JavaScript is over its budget (run after a build) |
| `npm run check`        | Everything CI runs: lint, tests, build and the bundle check     |
| `npm run db:migrate`   | Apply new migrations                                            |
| `npm run db:seed`      | Load reference data and demo accounts                           |
| `npm run db:reset`     | Drop everything, migrate and seed. Development only.            |
| `npm run jobs`         | Run the scheduled jobs once                                     |

## Project structure

```
src/
  app/        pages and layouts
  features/   one folder per feature (accounts, listings, exchanges, support, admin, content)
  shared/     UI primitives, session helpers and small utilities
  server/     business rules, database queries and background jobs
db/           SQL migrations
docs/         architecture notes, OpenAPI spec
scripts/      migrate, seed, jobs and the bundle budget check
tests/        integration tests
```

[`docs/architecture.md`](docs/architecture.md) covers the design in depth: how credits stay consistent, the exchange state machine, shipping routes, background jobs, the HTTP API and the security model.

## Running in production

The app runs anywhere Node.js and PostgreSQL do. On top of `npm run build && npm start` you'll want to:

1. **Schedule the jobs.** Call `POST /api/v1/jobs` with the `x-jobs-secret` header every few minutes, or run `npm run jobs` from cron. This expires unanswered requests, cancels missed dispatches, completes exchanges and sends email.
2. **Connect an email provider.** The default sender only logs. Implement the `EmailTransport` interface in [`src/server/jobs/email.ts`](src/server/jobs/email.ts).
3. **Use object storage** for uploads instead of the local `UPLOAD_DIR`, and add a malware scanner to the hook in [`src/server/domain/files.ts`](src/server/domain/files.ts).
4. **Monitor `GET /api/v1/health`.** It returns 503 when the database is down or background work is falling behind.
5. **Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`** to the same value on every server if you run more than one, and move rate limiting to a shared store.

## Status and roadmap

This is the first version: the complete exchange loop, the admin tools and the policy pages. It's ready for a closed beta, with these gaps:

- Email delivery, object storage and malware scanning need wiring to real services (see above)
- The policy pages are drafts and need legal review in each market
- Not built yet: a premium membership and payments, carrier tracking and shipping labels, more languages, recommendations, a referral program, and a community blog

## Contributing

1. Create a branch from `main`.
2. Make your change, following the project's conventions: where code goes, what may import what, and how credits and staff actions are handled.
3. Run `npm run check` and make sure it passes.
4. Open a pull request. CI runs the same checks against PostgreSQL.

This repository doesn't have a license yet, so all rights are reserved by the owner.
