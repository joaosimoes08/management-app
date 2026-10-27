FROM node:22-alpine AS build
WORKDIR /app

ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
ARG NEXT_PUBLIC_KEYCLOAK_REALM=COCiber
ARG NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=simoes-web
ARG NEXT_PUBLIC_BOOKSTACK_URL=
ARG NEXT_PUBLIC_ZABBIX_URL=
ARG NEXT_PUBLIC_ZAMMAD_URL=
ARG NEXT_PUBLIC_ROCKETCHAT_URL=
ARG NEXT_PUBLIC_ANSIBLE_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_KEYCLOAK_URL=$NEXT_PUBLIC_KEYCLOAK_URL \
    NEXT_PUBLIC_KEYCLOAK_REALM=$NEXT_PUBLIC_KEYCLOAK_REALM \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=$NEXT_PUBLIC_KEYCLOAK_CLIENT_ID \
    NEXT_PUBLIC_BOOKSTACK_URL=$NEXT_PUBLIC_BOOKSTACK_URL \
    NEXT_PUBLIC_ZABBIX_URL=$NEXT_PUBLIC_ZABBIX_URL \
    NEXT_PUBLIC_ZAMMAD_URL=$NEXT_PUBLIC_ZAMMAD_URL \
    NEXT_PUBLIC_ROCKETCHAT_URL=$NEXT_PUBLIC_ROCKETCHAT_URL \
    NEXT_PUBLIC_ANSIBLE_URL=$NEXT_PUBLIC_ANSIBLE_URL

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/snmp/package.json ./apps/snmp/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/snmp-core/package.json ./packages/snmp-core/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace=@simoes/web
RUN chown -R node:node /app/apps/web/.next /app/apps/web/public

ENV NODE_ENV=production
USER node
EXPOSE 3000
COPY --chown=node:node apps/web/docker-entrypoint.sh /app/docker-entrypoint.sh
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start", "--workspace=@simoes/web"]
