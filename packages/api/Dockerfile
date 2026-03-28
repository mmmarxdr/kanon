# Stage 1: Build
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy root workspace files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/api/package.json packages/api/
COPY packages/api/tsconfig.json packages/api/
COPY packages/bridge/package.json packages/bridge/
COPY packages/bridge/tsconfig.json packages/bridge/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY packages/bridge/ packages/bridge/
COPY packages/api/ packages/api/

# Build bridge first (API depends on it)
RUN pnpm --filter @kanon/bridge build

# Generate Prisma client
RUN pnpm --filter @kanon/api db:generate

# Build TypeScript
RUN pnpm --filter @kanon/api build

# Collect generated Prisma client to a known location for the runtime stage.
# pnpm hoists it under a versioned path that varies, so we find it dynamically.
RUN mkdir -p /prisma-client && \
    cp -r $(find /app/node_modules/.pnpm -path '*/@prisma/client' -type d | head -1)/../../.prisma /prisma-client/.prisma && \
    cp -r $(find /app/node_modules/.pnpm -path '*/@prisma/client' -type d | head -1) /prisma-client/@prisma-client

# Stage 2: Runtime
FROM node:20-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/api/package.json packages/api/
COPY packages/bridge/package.json packages/bridge/

RUN pnpm install --frozen-lockfile --prod || pnpm install --prod

COPY --from=builder /app/packages/bridge/dist packages/bridge/dist
COPY --from=builder /app/packages/api/dist packages/api/dist
COPY --from=builder /app/packages/api/prisma packages/api/prisma

# Copy generated Prisma client into the pnpm @prisma/client package directory.
# First, find where pnpm installed @prisma/client in the runtime node_modules,
# then overlay the generated client files on top.
RUN PRISMA_CLIENT_DIR=$(find /app/node_modules/.pnpm -path '*/@prisma/client' -type d 2>/dev/null | head -1) && \
    if [ -n "$PRISMA_CLIENT_DIR" ]; then \
      PRISMA_PARENT=$(dirname "$PRISMA_CLIENT_DIR"); \
      mkdir -p "$PRISMA_PARENT/.prisma"; \
    fi

COPY --from=builder /prisma-client/.prisma /tmp/.prisma
COPY --from=builder /prisma-client/@prisma-client /tmp/@prisma-client

# Overlay generated Prisma client into the correct runtime locations
RUN PRISMA_CLIENT_DIR=$(find /app/node_modules/.pnpm -path '*/@prisma/client' -type d 2>/dev/null | head -1) && \
    if [ -n "$PRISMA_CLIENT_DIR" ]; then \
      cp -r /tmp/@prisma-client/* "$PRISMA_CLIENT_DIR/"; \
      PRISMA_PARENT=$(dirname "$PRISMA_CLIENT_DIR"); \
      cp -r /tmp/.prisma/* "$PRISMA_PARENT/.prisma/"; \
    fi && \
    mkdir -p /app/node_modules/.prisma && \
    cp -r /tmp/.prisma/* /app/node_modules/.prisma/ && \
    rm -rf /tmp/.prisma /tmp/@prisma-client

WORKDIR /app/packages/api

EXPOSE 3000

# Install prisma CLI for runtime migrations
RUN npm install -g prisma@6

CMD ["sh", "-c", "prisma generate --schema=prisma/schema.prisma && prisma migrate deploy --schema=prisma/schema.prisma && node dist/index.js"]
