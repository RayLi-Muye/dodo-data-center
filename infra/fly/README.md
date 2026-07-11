# Fly.io API runbook

This configuration runs the Fastify API as one always-on Fly Machine in Tokyo. Run every command from the repository root and pass `infra/fly/fly.toml` explicitly.

## Before the first deploy

1. Install `flyctl`, authenticate, and create an empty Fly app without deploying it.
2. Replace `replace-with-your-fly-app-name` in `infra/fly/fly.toml` with that app's exact name.
3. Confirm the app has no Machines in other regions.
4. Configure these Fly secrets without committing or logging their values:

   - `DATABASE_URL` (required): the hosted Supabase Supavisor session connection string.
   - `OPENDOTA_API_KEY` (optional): the server-side OpenDota API key.

`NODE_ENV`, `API_HOST`, `API_PORT`, `DODO_DATA_MODE`, and `DODO_REPOSITORY` are non-secret production settings in `fly.toml`. Do not add database or OpenDota credentials there.

## Local image check

The build context must be the repository root because the API imports workspace packages and uses the root lockfile.

```bash
docker build --file infra/fly/Dockerfile --tag dodo-api:local .
docker run --rm --publish 3001:3001 \
  --env-file /absolute/path/to/local-production.env \
  dodo-api:local
curl --fail --silent --show-error http://127.0.0.1:3001/health/live
curl --fail --silent --show-error http://127.0.0.1:3001/health/ready
```

The runtime process is Node.js 22 running the `@dodo/api` entry point as the non-root `node` user. Node is PID 1 so Fly's `SIGTERM` reaches the API shutdown handler directly.

## Release

Database migrations are a separate, explicit release step. Never add a migration command to the Dockerfile, container command, or Fly release command.

1. Review and apply migrations from the repository root:

   ```bash
   supabase db push --linked --dry-run
   supabase db push --linked
   ```

2. Deploy exactly one Machine. `--ha=false` prevents Fly's first deployment from creating a redundant Machine:

   ```bash
   fly deploy . --config infra/fly/fly.toml --ha=false
   fly scale count 1 --config infra/fly/fly.toml
   fly scale show --config infra/fly/fly.toml
   ```

3. Require the scale output to show one `app` Machine in `nrt`. Do not add a second Machine until sync coordination uses a database-backed queue or lock. `auto_stop_machines = "off"` keeps the Machine running; `min_machines_running = 1` documents the required floor.

The 120-second shutdown window is best-effort. Watch deploy logs and confirm active sync work finishes before the process exits.

## Smoke test

Set `API_ORIGIN` to the deployed HTTPS origin, then verify health and a repository-backed read:

```bash
curl --fail --silent --show-error "$API_ORIGIN/health/live"
curl --fail --silent --show-error "$API_ORIGIN/health/ready"
curl --fail --silent --show-error "$API_ORIGIN/v1/data-status"
```

For the release acceptance test, submit one known-public account through the Web BFF, wait for its sync job to finish, verify the player and recent matches are queryable, redeploy the same API release, and query them again. This proves that sync works end to end and data survives an API replacement without exposing upstream credentials to the browser.

## Rollback

Application rollback does not reverse database migrations.

1. Find the last known-good image in `fly releases` or the Fly dashboard.
2. Redeploy that exact immutable image while keeping one Machine:

   ```bash
   fly deploy . --config infra/fly/fly.toml \
     --image registry.fly.io/replace-with-your-fly-app-name:LAST_KNOWN_GOOD_IMAGE \
     --ha=false
   fly scale count 1 --config infra/fly/fly.toml
   ```

3. Repeat all smoke checks and inspect `fly logs` for shutdown, startup, and readiness failures.

Use a new forward migration for schema corrections. Only restore a database backup under an incident-specific, reviewed recovery plan.

References: [Fly app configuration](https://fly.io/docs/reference/configuration/), [single-Machine deploys](https://fly.io/docs/apps/app-availability/#turn-off-redundancy-on-deploy), and [image rollback](https://fly.io/docs/blueprints/rollback-guide/).
