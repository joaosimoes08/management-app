#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin" "$TEMP/install/deploy" "$TEMP/install/nginx" "$TEMP/install/infra/keycloak" "$TEMP/update/deploy" "$TEMP/update/nginx" "$TEMP/update/infra/keycloak" "$TEMP/update101/deploy" "$TEMP/update101/nginx" "$TEMP/update101/infra/keycloak" "$TEMP/proxy/deploy" "$TEMP/proxy/nginx" "$TEMP/proxy/infra/keycloak" "$TEMP/csr/deploy" "$TEMP/csr/nginx" "$TEMP/csr/infra/keycloak"
REAL_NODE="$(command -v node)"
export REAL_NODE
cat > "$TEMP/bin/node" <<'NODE'
#!/usr/bin/env bash
if [[ "$1" == --env-file=.env && "$2" == infra/keycloak/bootstrap-admin.mjs ]]; then printf 'CREATED\n'; exit 0; fi
exec "$REAL_NODE" "$@"
NODE
chmod +x "$TEMP/bin/node"
for target in install update update101 proxy csr; do
  cp "$ROOT/deploy.sh" "$ROOT/.env.example" "$ROOT/docker-compose.yml" "$ROOT/docker-compose.proxy.yml" "$TEMP/$target/"
  cp "$ROOT/deploy/generate-snmp-keyring.mjs" "$ROOT/deploy/realm-cociber.json" "$TEMP/$target/deploy/"
  cp "$ROOT/infra/keycloak/bootstrap-admin.mjs" "$TEMP/$target/infra/keycloak/"
  cp "$ROOT/nginx/"*.conf "$TEMP/$target/nginx/"
done
cat > "$TEMP/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
if [[ "$1" == info || ( "$1" == compose && "$2" == version ) ]]; then exit 0; fi
if [[ "$1" == manifest && "$2" == inspect ]]; then
  [[ "${MOCK_MISSING_TAG:-}" != 1 ]] || exit 1
  if [[ "${MOCK_MISSING_ARCH:-}" == 1 ]]; then printf '%s\n' '{"manifests":[{"platform":{"os": "linux", "architecture": "amd64"}}]}'; else printf '%s\n' '{"manifests":[{"platform":{"os": "linux", "architecture": "amd64"}},{"platform":{"os": "linux", "architecture": "arm64"}}]}'; fi
  exit 0
fi
if [[ "$1" == compose ]]; then
  [[ "${MOCK_COMPOSE_CONFIG_FAIL:-}" != 1 || " $* " != *" config "* ]] || exit 1
  [[ "${MOCK_BACKUP_FAIL:-}" != 1 || " $* " != *" exec "* ]] || exit 1
  if [[ "$*" == *".Service"* ]]; then printf 'api healthy running\nweb healthy running\nsnmp healthy running\n'
  elif [[ " $* " == *" --format json "* ]]; then printf '[{"Tag":"beta-1.0.2-release"}]\n'
  elif [[ " $* " == *" --services "* ]]; then printf 'postgres\nkeycloak-db\n'
  elif [[ " $* " == *" images "* ]]; then printf 'SERVICE IMAGE TAG\napi mgmt-app-api beta-1.0.2-release\n'
  elif [[ " $* " == *" exec "* ]]; then printf 'backup fixture\n'
  elif [[ " $* " == *" up -d "* ]]; then printf 'up\n' >> "$MOCK_DOCKER_LOG"
  fi
  exit 0
fi
exit 0
DOCKER
chmod +x "$TEMP/bin/docker"
export PATH="$TEMP/bin:$PATH"
export MOCK_DOCKER_LOG="$TEMP/docker.log"
(
  cd "$TEMP/install"
  printf '\nno\nhttps://mgmt.ciberdefesa.dev\ny\n' | ./deploy.sh install > "$TEMP/install.out"
  grep -q '^APP_IMAGE_TAG=beta-1.0.2-release$' .env
  grep -q '^POSTGRES_PASSWORD=[0-9a-f]\{48\}$' .env
  grep -q '^BOOTSTRAP_ADMIN_PASSWORD=[0-9a-f]\{64\}$' .env
  grep -q '^KEYCLOAK_HOSTNAME=https://mgmt.ciberdefesa.dev$' .env
  grep -q '^OIDC_ISSUER_URL=https://mgmt.ciberdefesa.dev/realms/COCiber$' .env
  grep -q '^OIDC_BACKCHANNEL_URL=http://keycloak:8080/realms/COCiber$' .env
  grep -q 'Temporary password (shown once; change it at first login)' "$TEMP/install.out"
  test "$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env)" = 600
  test -s secrets/snmp-keyring.json
  test -s deploy/realm-cociber.generated.json
  ! grep -q 'admin@admin.test' deploy/realm-cociber.generated.json
)
(
  cd "$TEMP/update"
  printf 'APP_IMAGE_TAG=beta-1.0.0-release\nCUSTOM_VALUE=keep-me\nPOSTGRES_PASSWORD=custom-app-pass\nKEYCLOAK_DB_PASSWORD=custom-keycloak-pass\nKEYCLOAK_ADMIN_PASSWORD=custom-admin-pass\nKEYCLOAK_ADMIN_CLIENT_SECRET=custom-client-secret\nNEXT_PUBLIC_KEYCLOAK_URL=https://mgmt.ciberdefesa.dev\n' > .env
  printf '\nno\n\ny\n' | ./deploy.sh update >/dev/null
  grep -q '^APP_IMAGE_TAG=beta-1.0.2-release$' .env
  grep -q '^CUSTOM_VALUE=keep-me$' .env
  grep -q '^POSTGRES_PASSWORD=custom-app-pass$' .env
  grep -q '^KEYCLOAK_DB_PASSWORD=custom-keycloak-pass$' .env
  grep -q '^KEYCLOAK_ADMIN_PASSWORD=custom-admin-pass$' .env
  grep -q '^KEYCLOAK_ADMIN_CLIENT_SECRET=custom-client-secret$' .env
  env_backup="$(ls backups/.env.*.bak | head -n1)"
  test "$(stat -c '%a' "$env_backup" 2>/dev/null || stat -f '%Lp' "$env_backup")" = 600
  test -s backups/app-*.sql
  test -s backups/keycloak-*.sql
)
(
  cd "$TEMP/update101"
  printf 'APP_IMAGE_TAG=beta-1.0.0-release\nPOSTGRES_PASSWORD=custom-app-pass\nKEYCLOAK_DB_PASSWORD=custom-keycloak-pass\nKEYCLOAK_ADMIN_PASSWORD=custom-admin-pass\nKEYCLOAK_ADMIN_CLIENT_SECRET=custom-client-secret\nNEXT_PUBLIC_KEYCLOAK_URL=https://mgmt.ciberdefesa.dev\n' > .env
  printf 'beta-1.0.1-release\nno\n\ny\n' | ./deploy.sh update >/dev/null
  grep -q '^APP_IMAGE_TAG=beta-1.0.1-release$' .env
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

# Regression fixtures for preflight failures, cancellation, and update backups.
for case in missing_tag missing_arch compose_failure cancel backup_failure; do
  mkdir -p "$TEMP/$case/deploy" "$TEMP/$case/nginx"
  cp "$ROOT/deploy.sh" "$ROOT/.env.example" "$ROOT/docker-compose.yml" "$ROOT/docker-compose.proxy.yml" "$TEMP/$case/"
  cp "$ROOT/deploy/generate-snmp-keyring.mjs" "$ROOT/deploy/realm-cociber.json" "$TEMP/$case/deploy/"
  mkdir -p "$TEMP/$case/infra/keycloak"
  cp "$ROOT/infra/keycloak/bootstrap-admin.mjs" "$TEMP/$case/infra/keycloak/"
  cp "$ROOT/nginx/"*.conf "$TEMP/$case/nginx/"
  printf 'APP_IMAGE_TAG=release-2026-11-09\nCUSTOM_VALUE=preserve\nPOSTGRES_PASSWORD=custom-app-pass\nKEYCLOAK_DB_PASSWORD=custom-keycloak-pass\nKEYCLOAK_ADMIN_PASSWORD=custom-admin-pass\nKEYCLOAK_ADMIN_CLIENT_SECRET=custom-client-secret\n' > "$TEMP/$case/.env"
done
run_failure_case() {
  local case="$1" flag="$2" expected="$3"
  : > "$MOCK_DOCKER_LOG"
  if (cd "$TEMP/$case" && printf 'beta-1.0.2-release\nno\nhttps://mgmt.ciberdefesa.dev\ny\n' | env "$flag=1" ./deploy.sh update > "$TEMP/$case.out" 2>&1); then
    echo "Expected $case deployment fixture to fail." >&2; exit 1
  fi
  grep -q "$expected" "$TEMP/$case.out"
}
run_failure_case missing_tag MOCK_MISSING_TAG 'Image tag unavailable'
run_failure_case missing_arch MOCK_MISSING_ARCH 'Image lacks linux/arm64'
run_failure_case compose_failure MOCK_COMPOSE_CONFIG_FAIL 'Compose preflight failed'
run_failure_case backup_failure MOCK_BACKUP_FAIL 'Application database backup failed'
: > "$MOCK_DOCKER_LOG"
(cd "$TEMP/cancel" && printf 'beta-1.0.2-release\nno\n\nn\n' | ./deploy.sh update > "$TEMP/cancel.out" 2>&1)
grep -q 'Cancelled without starting services' "$TEMP/cancel.out"
! grep -q '^up$' "$MOCK_DOCKER_LOG"
for case in missing_tag missing_arch compose_failure cancel backup_failure; do
  grep -q '^CUSTOM_VALUE=preserve$' "$TEMP/$case/.env"
done

if grep -nE 'down -v' "$ROOT/deploy.sh" "$ROOT/deploy.ps1"; then
  echo 'Routine deployment scripts must not use compose down -v.' >&2
  exit 1
fi
test "$(grep -c 'APP_IMAGE_TAG:-beta-1.0.2-release' "$ROOT/docker-compose.yml")" -eq 3
printf 'Deployment script fixture checks passed.\n'
