#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/install/deploy" "$TEMP/install/nginx" "$TEMP/update/deploy" "$TEMP/update/nginx" "$TEMP/proxy/deploy" "$TEMP/proxy/nginx" "$TEMP/csr/deploy" "$TEMP/csr/nginx"
for target in install update proxy csr; do
  cp "$ROOT/deploy.sh" "$ROOT/.env.example" "$ROOT/docker-compose.yml" "$ROOT/docker-compose.proxy.yml" "$TEMP/$target/"
  cp "$ROOT/deploy/generate-snmp-keyring.mjs" "$ROOT/deploy/realm-cociber.json" "$TEMP/$target/deploy/"
  cp "$ROOT/nginx/"*.conf "$TEMP/$target/nginx/"
done
cat > "$TEMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
if [[ "$1" == info || ( "$1" == compose && "$2" == version ) ]]; then exit 0; fi
if [[ "$1" == manifest && "$2" == inspect ]]; then
  printf '%s\n' '{"manifests":[{"platform":{"os": "linux", "architecture": "amd64"}},{"platform":{"os": "linux", "architecture": "arm64"}}]}'
  exit 0
fi
if [[ "$1" == compose ]]; then
  if [[ " $* " == *" --services "* ]]; then printf 'postgres\nkeycloak-db\n'
  elif [[ "$*" == *".Service"* ]]; then printf 'api healthy running\nweb healthy running\nsnmp healthy running\n'
  elif [[ " $* " == *" images "* ]]; then printf 'SERVICE IMAGE TAG\napi mgmt-app-api beta-1.0.0-release\n'
  elif [[ " $* " == *" exec "* ]]; then printf 'backup fixture\n'
  fi
  exit 0
fi
exit 0
DOCKER
chmod +x "$TEMP/bin/docker"
export PATH="$TEMP/bin:$PATH"
(
  cd "$TEMP/install"
  printf '\nno\ny\n' | ./deploy.sh install >/dev/null
  grep -q '^APP_IMAGE_TAG=beta-1.0.0-release$' .env
  grep -q '^POSTGRES_PASSWORD=[0-9a-f]\{48\}$' .env
  test -s secrets/snmp-keyring.json
  test -s deploy/realm-cociber.generated.json
)
(
  cd "$TEMP/update"
  printf 'APP_IMAGE_TAG=old-release\nCUSTOM_VALUE=keep-me\nPOSTGRES_PASSWORD=custom-app-pass\nKEYCLOAK_DB_PASSWORD=custom-keycloak-pass\nKEYCLOAK_ADMIN_PASSWORD=custom-admin-pass\nKEYCLOAK_ADMIN_CLIENT_SECRET=custom-client-secret\n' > .env
  printf 'beta-1.0.0-release\nno\ny\n' | ./deploy.sh update >/dev/null
  grep -q '^APP_IMAGE_TAG=beta-1.0.0-release$' .env
  grep -q '^CUSTOM_VALUE=keep-me$' .env
  grep -q '^POSTGRES_PASSWORD=custom-app-pass$' .env
  ls backups/.env.*.bak >/dev/null
  test -s backups/app-*.sql
  test -s backups/keycloak-*.sql
)
(
  cd "$TEMP/proxy"
  printf '\nyes\nno\nmanagement.example.com\ny\n' | ./deploy.sh install >/dev/null
  grep -q '^NEXT_PUBLIC_API_URL=http://management.example.com$' .env
  grep -q 'proxy_pass http://web:3000' nginx/runtime.conf
)
(
  cd "$TEMP/csr"
  printf '\nyes\nyes\nmanagement.example.com\nyes\nmanagement.example.com,app.example.com,192.0.2.1\n' | ./deploy.sh install >/dev/null
  openssl req -in certificates/server.csr -noout -verify >/dev/null 2>&1
  openssl req -in certificates/server.csr -noout -text | grep -q 'DNS:app.example.com'
  openssl req -in certificates/server.csr -noout -text | grep -q 'IP Address:192.0.2.1'
)
if grep -nE 'down -v' "$ROOT/deploy.sh" "$ROOT/deploy.ps1"; then
  echo 'Routine deployment scripts must not use compose down -v.' >&2
  exit 1
fi
printf 'Deployment script fixture checks passed.\n'
