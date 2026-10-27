#!/bin/sh
set -eu

node -e 'const fs = require("node:fs"); const config = { apiUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001", keycloakUrl: process.env.NEXT_PUBLIC_KEYCLOAK_URL || "http://localhost:8080", keycloakRealm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "COCiber", keycloakClientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "simoes-web" }; fs.writeFileSync("/app/apps/web/public/runtime-config.js", `window.__COCIBER_CONFIG__ = ${JSON.stringify(config)};\n`);'
exec "$@"
