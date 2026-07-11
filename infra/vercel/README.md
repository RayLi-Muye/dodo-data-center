# Vercel Web project settings

Create one Vercel project for the Next.js Web app connected to this GitHub monorepo. No API, database migration, or background sync worker runs in this project.

## Project configuration

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root Directory | `apps/web` |
| Node.js version | 22.x |
| Package manager | pnpm (from the root `packageManager` field) |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm --filter @dodo/web build` |
| Output Directory | leave unset; use the Next.js default |
| Function Region | Tokyo, Japan (`hnd1`) |

Enable **Include source files outside of the Root Directory in the Build Step**. The Git integration must have access to the entire repository so pnpm can resolve the root lockfile and the `@dodo/contracts` and `@dodo/ui` workspace packages. Enable Preview deployments for pull requests and promote a verified Preview deployment to Production.

Configure the Function Region under **Project Settings > Functions > Function Regions**. Static assets remain globally cached; `hnd1` keeps dynamic BFF calls close to the Fly API and Supabase in Tokyo.

## Environment variables

Configure exactly this application endpoint variable for Preview and Production:

- `API_BASE_URL`: HTTPS origin of the Fly API, with no trailing slash.

`API_BASE_URL` is server-only. Do not create `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DATABASE_URL`, or any `NEXT_PUBLIC_*` credential. Never add `DATABASE_URL`, `OPENDOTA_API_KEY`, Supabase service-role keys, or Fly credentials to the Vercel project.

After deployment, inspect browser network requests and built client assets to confirm the Fly origin and credentials are not exposed; browser data requests should use the Next.js same-origin BFF.

References: [Vercel monorepos](https://vercel.com/docs/monorepos), [build settings](https://vercel.com/docs/builds/configure-a-build), and [Function Regions](https://vercel.com/docs/functions/configuring-functions/region).
