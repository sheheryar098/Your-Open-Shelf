# YOS — Your Open Shelf

Next.js 16 (App Router, Server Actions) + PostgreSQL. Read `README.md` for setup and the domain model.
This Next.js version differs from older training data: check `node_modules/next/dist/docs/` before using an API you're unsure of.

## Required skills

- **Frontend code** (`src/app`, `src/features`, `src/shared`, CSS, client components): load and follow the `frontend-architecture` skill in `.claude/skills/` before writing code.
- **Backend code** (`src/server`, route handlers, migrations, scripts): load and follow the relevant backend skill before writing code:
  - `api-design` for any HTTP endpoint (route handlers, error shapes, pagination, idempotency)
  - `background-jobs` for scheduled or asynchronous work (`src/server/jobs`)
  - `caching` before adding any cache

## Layout and import rules (enforced by `npm run lint`)

```
src/
  app/        routing, layouts and pages only; composes features
  features/   one folder per feature: components/, api/ (server actions), model/
  shared/     ui/ (design-system primitives), api/ (session, action runner), lib/ (cross-cutting helpers)
  server/     backend: db, auth, rbac, domain modules, jobs, outbound http. No React, no next/navigation
```

- A feature must not import another feature. If two features need something, move it to `shared/`.
- `shared/` must not import from `features/` or `app/`. `server/` must not import from `features/`, `shared/` or `app/`.
- No barrel (`index.ts`) files. Import from the source module.
- Server data comes from Server Components; there is no global client store.
- Credits change only through the ledger functions in `src/server/domain/credits.ts`, inside a transaction.
- Every staff action records a reason and an audit log entry.

## Checks before committing

`npm run lint && npm test && npm run build && npm run bundle:check`
