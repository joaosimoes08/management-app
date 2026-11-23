# Trap sender + test runner for the SNMP trap lab. Build context: repository root.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/snmp/package.json ./apps/snmp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/snmp-core/package.json ./packages/snmp-core/package.json
RUN npm ci --include=dev
COPY packages ./packages
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma \
 && npm run build --workspace=@simoes/database \
 && npm run build --workspace=@simoes/snmp-core
RUN apk add --no-cache net-snmp-tools iproute2
COPY e2e/snmp-trap-lab ./e2e/snmp-trap-lab
ENTRYPOINT ["sh", "/app/e2e/snmp-trap-lab/sender-entrypoint.sh"]
