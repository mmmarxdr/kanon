FROM node:20-alpine AS base

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile --filter @kanon/web

COPY packages/web/ packages/web/

WORKDIR /app/packages/web

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0"]
