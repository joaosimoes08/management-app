# Trap sender + test runner for the SNMP trap lab. Build context: repository root.
FROM node:22-alpine
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/snmp/package.json ./apps/snmp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/snmp-core/package.json ./packages/snmp-core/package.json
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @simoes/database db:generate \
 && pnpm --filter @simoes/database build \
 && pnpm --filter @simoes/snmp-core build
RUN apk add --no-cache net-snmp-tools iproute2
COPY e2e/snmp-trap-lab ./e2e/snmp-trap-lab
ENTRYPOINT ["sh", "/app/e2e/snmp-trap-lab/sender-entrypoint.sh"]
