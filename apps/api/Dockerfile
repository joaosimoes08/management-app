FROM node:22-alpine

ARG VCS_REF
LABEL org.opencontainers.image.source="https://github.com/joaosimoes08/management-app" \
      org.opencontainers.image.revision=$VCS_REF

WORKDIR /app
ENV NODE_ENV=production
# pnpm comes from corepack, pinned by "packageManager" in package.json. COREPACK_HOME is shared and
# prepared at build time so the non-root runtime user can run pnpm without downloading it.
ENV COREPACK_HOME=/usr/local/share/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack install -g pnpm@12.23.0 && chmod -R a+rX "$COREPACK_HOME"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/snmp/package.json ./apps/snmp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/snmp-core/package.json ./packages/snmp-core/package.json
# NODE_ENV=production would make pnpm skip devDependencies, which the build needs.
RUN pnpm install --frozen-lockfile --prod=false

RUN test -n "$VCS_REF"

COPY . .
RUN pnpm --filter @simoes/database db:generate \
 && pnpm --filter @simoes/database build \
 && pnpm --filter @simoes/snmp-core build \
 && pnpm --filter @simoes/api build \
 && mkdir -p /app/data/assets \
 && chown -R node:node /app/data

USER node
EXPOSE 3001
CMD ["sh", "-c", "pnpm --filter @simoes/database db:migrate && pnpm --filter @simoes/api start"]
