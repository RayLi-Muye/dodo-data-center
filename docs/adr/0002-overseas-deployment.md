# ADR 0002: Overseas deployment topology

## Status

Accepted for MVP Wave 5.

## Decision

- Deploy `apps/web` to Vercel with Tokyo (`hnd1`) as the preferred compute region.
- Deploy `apps/api` as one always-running Fly Machine in Tokyo (`nrt`).
- Keep the hosted Supabase PostgreSQL project in Tokyo and use the Supavisor session connection from Fastify.
- Keep all OpenDota and database credentials server-side. Browsers call the Next.js same-origin BFF.
- Do not run the current sync service in serverless functions. It continues work after the HTTP 202 response and requires a process with a controlled shutdown lifecycle.
- Run exactly one API Machine until sync coordination moves from process memory to a database-backed queue or lock.

## Production requirements

- API liveness must not depend on external services.
- API readiness must verify repository connectivity and return a failure status without leaking credentials.
- `SIGTERM` and `SIGINT` must close Fastify, wait for in-flight sync work, and close PostgreSQL.
- Fly must keep at least one Machine running and must not auto-stop the only Machine.
- Vercel server-side requests use `API_BASE_URL`; no database or OpenDota credential may use a `NEXT_PUBLIC_*` variable.
- Fonts required for the initial render are self-hosted by the Next.js build.
- Database migrations remain an explicit release step and do not run automatically on every application boot.

## Deferred

- Multiple API replicas.
- Database-backed job queue and worker split.
- Custom production domain.
- Error aggregation service and multi-region synthetic monitoring.
- Mainland China deployment and ICP filing.

## Acceptance criteria

1. API container builds and runs as a non-root user.
2. Liveness and readiness checks behave independently and are covered by tests.
3. Graceful shutdown waits for active sync work and closes the repository.
4. Fly configuration fixes the primary region to `nrt` with one always-running Machine.
5. Vercel preview builds from the GitHub monorepo and uses Tokyo compute for dynamic routes.
6. A public account sync succeeds through the deployed Web BFF and remains queryable after an API redeploy.
