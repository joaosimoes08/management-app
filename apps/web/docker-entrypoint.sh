#!/bin/sh
set -eu

node -e 'const fs = require("node:fs"); const config = { ...(process.env.NEXT_PUBLIC_API_URL ? { apiUrl: process.env.NEXT_PUBLIC_API_URL } : {}), keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL || "http://localhost:8080", keycloakRealm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "COCiber", keycloakClientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "simoes-web", bookstackUrl: process.env.NEXT_PUBLIC_BOOKSTACK_URL || "", organizationName: process.env.NEXT_PUBLIC_ORGANIZATION_NAME || "", locale: process.env.NEXT_PUBLIC_APP_LOCALE || "pt-PT" }; fs.writeFileSync("/app/apps/web/public/runtime-config.js", `window.__COCIBER_CONFIG__ = ${JSON.stringify(config)};\n`);'
exec "$@"
