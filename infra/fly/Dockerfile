FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable \
  && corepack prepare pnpm@11.11.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/dota-data/package.json packages/dota-data/package.json

RUN pnpm install --frozen-lockfile --filter @dodo/api...

FROM dependencies AS application

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/dota-data packages/dota-data

FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS runtime

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3001

WORKDIR /app

COPY --from=application --chown=node:node /app /app

USER node

EXPOSE 3001

CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
