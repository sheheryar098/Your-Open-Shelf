# Project skills

These skills are vendored from [nimadorostkar/claude-skills-collection](https://github.com/nimadorostkar/claude-skills-collection) at commit `31f227e`, under the MIT License (see `LICENSE-claude-skills-collection`).

| Skill | Scope in YOS |
|---|---|
| `frontend-architecture` | Everything under `src/app`, `src/features`, `src/shared`: folder structure, import boundaries, state layering, bundle budgets |
| `api-design` | Route handlers under `src/app/api/v1`, error format, pagination, idempotency, versioning |
| `background-jobs` | `src/server/jobs/*`: scheduled work, email delivery, retries, dead letters |
| `caching` | Any cache added to the server, e.g. the ISBN metadata lookup cache |

Other backend skills in the collection (django, fastapi, nestjs, spring-boot, graphql, microservices, realtime-websockets, event-driven-architecture) don't apply to this stack and aren't vendored.
