FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/snmp/package.json ./apps/snmp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/snmp-core/package.json ./packages/snmp-core/package.json
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma \
 && npm run build --workspace=@simoes/database \
 && npm run build --workspace=@simoes/snmp-core \
 && npm run build --workspace=@simoes/api \
 && mkdir -p /app/data/assets \
 && chown -R node:node /app/data

USER node
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/database/prisma/schema.prisma && npm run start --workspace=@simoes/api"]
