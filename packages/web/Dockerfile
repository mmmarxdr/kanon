FROM node:24-alpine AS base

RUN corepack enable

WORKDIR /app

# Root workspace files + base tsconfig (needed to build @kanon/shared)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./
COPY packages/web/package.json packages/web/
COPY packages/web/tsconfig.json packages/web/
# @kanon/shared is a workspace dependency of the web app — its package.json and
# tsconfig must be present before install so the workspace link resolves.
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/

RUN pnpm install --frozen-lockfile || pnpm install

# Copy source (shared first — web imports from it)
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/

# Build @kanon/shared → dist. Its package.json exports ./dist/index.js, so Vite
# cannot resolve the import until this runs.
RUN pnpm --filter @kanon/shared build

WORKDIR /app/packages/web

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0"]
