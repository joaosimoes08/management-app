FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/snmp/package.json ./apps/snmp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/snmp-core/package.json ./packages/snmp-core/package.json
RUN npm ci
COPY . .
RUN npm run db:generate
RUN npm run build --workspace=@simoes/database \
 && npm run build --workspace=@simoes/snmp-core \
 && npm run build --workspace=@simoes/snmp

FROM node:22-alpine AS dependencies
WORKDIR /runtime
COPY apps/snmp/runtime/package.json apps/snmp/runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /runtime/node_modules ./node_modules
COPY --from=build /app/apps/snmp/dist ./apps/snmp/dist
COPY --from=build /app/packages/database/package.json ./node_modules/@simoes/database/package.json
COPY --from=build /app/packages/database/dist ./node_modules/@simoes/database/dist
COPY --from=build /app/packages/database/generated ./node_modules/@simoes/database/generated
COPY --from=build /app/packages/snmp-core/package.json ./node_modules/@simoes/snmp-core/package.json
COPY --from=build /app/packages/snmp-core/dist ./node_modules/@simoes/snmp-core/dist
USER node
EXPOSE 1162/udp 3002/tcp
CMD ["node", "apps/snmp/dist/index.js"]
