#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.env"
BACKUP_DIR="$ROOT/backups"
GUIDE_URL="${CA_GUIDE_URL:-https://github.com/joaosimoes08/management-app/blob/main/README.md#https-and-reverse-proxy}"
NGINX_CONFIG=""
TAG_DEFAULT="beta-1.0.2-release"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
ask() { local prompt="$1" default="$2" value; read -r -p "$prompt [$default]: " value; printf '%s' "${value:-$default}"; }
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  if [[ -f "$ENV_FILE" ]]; then awk -v k="$key" 'BEGIN{FS="="} $1!=k{print}' "$ENV_FILE" > "$tmp"; fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$ENV_FILE"
}
get_env() { local key="$1" fallback="$2" val; val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2-)"; printf '%s' "${val:-$fallback}"; }

[[ "${1:-}" == "--help" || "${1:-}" == "-h" ]] && { echo 'Usage: ./deploy.sh [install|update|check]'; exit 0; }
MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  if [[ -f "$ENV_FILE" ]]; then MODE="$(ask 'Choose install, update, or check' update)"; else MODE="$(ask 'Choose install, update, or check' install)"; fi
fi
[[ "$MODE" =~ ^(install|update|check)$ ]] || fail 'Choose install, update, or check.'
say "Certificate guide (if you choose a CA): $GUIDE_URL"
command -v docker >/dev/null || fail 'Docker CLI is required.'
docker info >/dev/null 2>&1 || fail 'Docker Engine is unavailable; start Docker and retry.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose plugin is required.'
if [[ "$MODE" == check ]]; then docker compose config --quiet; docker compose ps; exit 0; fi

if [[ -f "$ENV_FILE" ]]; then
  say 'Existing .env found. It will be backed up and kept; only the selected image tag and newly required defaults are updated.'
  mkdir -p "$BACKUP_DIR"; cp -p "$ENV_FILE" "$BACKUP_DIR/.env.$(date +%Y%m%d-%H%M%S).bak"; chmod 600 "$BACKUP_DIR"/.env.*.bak 2>/dev/null || true
else
  cp .env.example "$ENV_FILE"; chmod 600 "$ENV_FILE" 2>/dev/null || true
fi

while IFS= read -r line; do [[ "$line" == *=* ]] || continue; key="${line%%=*}"; grep -qE "^${key}=" "$ENV_FILE" || printf '%s\n' "$line" >> "$ENV_FILE"; done < .env.example
current_realm="$(get_env KEYCLOAK_REALM COCiber)"
organization="$(ask 'Deployment organization and Keycloak realm' "$current_realm")"
[[ "$organization" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || fail 'Organization/realm must be 1-64 letters, numbers, underscores, or hyphens, and start with a letter or number.'
current_locale="$(get_env NEXT_PUBLIC_APP_LOCALE pt-PT)"
locale="$(ask 'Startup language (pt-PT or en-US)' "$current_locale")"
[[ "$locale" == pt-PT || "$locale" == en-US ]] || fail 'Startup language must be pt-PT or en-US.'
keycloak_db_volume="$(docker compose config --format json | node deploy/compose-volume.mjs)" || fail 'Could not resolve the Keycloak database volume from Compose configuration.'
keycloak_db_container="$(docker compose ps -q keycloak-db 2>/dev/null || true)"
if [[ -n "$keycloak_db_container" ]]; then
  mounted_keycloak_db_volume="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$keycloak_db_container" 2>/dev/null || true)"
  [[ -z "$mounted_keycloak_db_volume" ]] || keycloak_db_volume="$mounted_keycloak_db_volume"
fi
if docker volume inspect "$keycloak_db_volume" >/dev/null 2>&1 && [[ "$organization" != "$current_realm" ]]; then
  fail "Refusing to switch the realm of existing Keycloak data ($current_realm). Keep $current_realm for this installation or use a separate COMPOSE_PROJECT_NAME for a fresh install."
fi
set_env KEYCLOAK_REALM "$organization"
set_env NEXT_PUBLIC_KEYCLOAK_REALM "$organization"
set_env KEYCLOAK_ADMIN_REALM "$organization"
set_env NEXT_PUBLIC_ORGANIZATION_NAME "$organization"
set_env NEXT_PUBLIC_APP_LOCALE "$locale"
set_env OIDC_BACKCHANNEL_URL "http://keycloak:8080/realms/$organization"
realm_file="$(get_env KEYCLOAK_REALM_FILE ./deploy/realm-cociber.generated.json)"
if [[ "$organization" != COCiber && "$realm_file" == ./deploy/realm-cociber.generated.json ]]; then
  realm_file="./deploy/realm-${organization}.generated.json"
fi
set_env KEYCLOAK_REALM_FILE "$realm_file"
NGINX_CONFIG="$(get_env NGINX_CONFIG_FILE ./nginx/runtime.conf)"
configured="$(get_env APP_IMAGE_TAG "$TAG_DEFAULT")"
current="$(docker compose images --format json 2>/dev/null | sed -n 's/.*"Tag":"\([^"]*\)".*/\1/p' | grep -v '^[[:space:]]*$' | sort -u | paste -sd, - || true)"
[[ -n "$current" ]] || current="not detected"
say "Installed image version: $current; configured version: $configured; target default: $TAG_DEFAULT (enter a custom tag to keep using it)."
tag="$(ask 'Target image release tag' "$TAG_DEFAULT")"
[[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail 'Invalid Docker tag.'
set_env APP_IMAGE_TAG "$tag"
for spec in 'POSTGRES_PASSWORD:PostgreSQL password' 'KEYCLOAK_DB_PASSWORD:Keycloak database password' 'KEYCLOAK_ADMIN_PASSWORD:Keycloak admin password' 'KEYCLOAK_ADMIN_CLIENT_SECRET:Keycloak app client secret'; do
  key="${spec%%:*}"; label="${spec#*:}"; existing="$(get_env "$key" '')"
  if [[ -z "$existing" || "$existing" == change-me* || "$existing" == keycloak-local-password ]]; then
    secret="$(openssl rand -hex 24 2>/dev/null)" || fail 'OpenSSL is required to generate secure initial secrets.'
    set_env "$key" "$secret"; unset secret
    say "$label generated locally and saved with restrictive permissions."
  fi
done
bootstrap_admin_password="$(get_env BOOTSTRAP_ADMIN_PASSWORD '')"
if [[ -z "$bootstrap_admin_password" ]]; then
  bootstrap_admin_password="$(openssl rand -hex 32 2>/dev/null)" || fail 'OpenSSL is required to generate the initial application administrator password.'
  set_env BOOTSTRAP_ADMIN_PASSWORD "$bootstrap_admin_password"
  unset bootstrap_admin_password
  bootstrap_admin_password_generated=1
fi
keyring="$(get_env SNMP_KEYRING_HOST_FILE ./secrets/snmp-keyring.json)"
if [[ ! -f "$keyring" ]]; then command -v node >/dev/null || fail 'Node.js is required once to create the SNMP keyring.'; node deploy/generate-snmp-keyring.mjs "$keyring"; fi

proxy="$(ask 'Enable the optional nginx reverse proxy?' no)"
compose_files=(-f docker-compose.yml)
if [[ "$proxy" =~ ^([Yy]|yes)$ ]]; then
  compose_files+=(--profile proxy -f docker-compose.proxy.yml)
  use_https="$(ask 'Enable HTTPS now?' no)"
  hostname="$(ask 'Public hostname' localhost)"
  set_env PUBLIC_HOSTNAME "$hostname"
  mkdir -p "$(dirname "$NGINX_CONFIG")"
  if [[ "$use_https" =~ ^([Yy]|yes)$ ]]; then cp nginx/https.conf "$NGINX_CONFIG"; else cp nginx/http.conf "$NGINX_CONFIG"; fi
  if [[ "$use_https" =~ ^([Yy]|yes)$ ]]; then
    ca="$(ask 'Will a certificate authority sign your certificate?' yes)"
    mkdir -p certificates; chmod 700 certificates 2>/dev/null || true
    san_names="$(ask 'Comma-separated DNS names and IP addresses for certificate SANs' "$hostname")"
    san_ext='subjectAltName='
    IFS=',' read -ra sans <<< "$san_names"
    first=1
    for san in "${sans[@]}"; do
      san="$(xargs <<<"$san")"
      [[ -n "$san" ]] || continue
      [[ "$san" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Invalid certificate SAN: $san"
      [[ $first == 1 ]] || san_ext+=','
      if [[ "$san" =~ ^[0-9.]+$ ]]; then san_ext+="IP:$san"; else san_ext+="DNS:$san"; fi
      first=0
    done
    [[ $first == 0 ]] || fail 'At least one DNS or IP SAN is required.'
    if [[ "$ca" =~ ^([Yy]|yes)$ ]]; then
      if [[ -e certificates/server.csr && -e certificates/privkey.pem ]]; then
        [[ -s certificates/fullchain.pem ]] || { say 'Place the signed CA chain at certificates/fullchain.pem, then rerun update.'; exit 0; }
      else
        [[ -e certificates/privkey.pem || -e certificates/server.csr ]] && fail 'Existing certificate/key/CSR found. Back it up and review before replacing it.'
      openssl req -new -newkey rsa:3072 -nodes -keyout certificates/privkey.pem -out certificates/server.csr -subj "/CN=$hostname" -addext "$san_ext" 2>/dev/null || fail 'CSR generation failed.'
      chmod 600 certificates/privkey.pem; say 'Send certificates/server.csr to your CA; place the signed full chain at certificates/fullchain.pem, then rerun ./deploy.sh update.'
      exit 0
      fi
    else
      [[ -e certificates/fullchain.pem || -e certificates/privkey.pem ]] && fail 'Existing certificate/key found. Back it up and review before replacing it.'
      openssl req -x509 -nodes -newkey rsa:3072 -days 365 -keyout certificates/privkey.pem -out certificates/fullchain.pem -subj "/CN=$hostname" -addext "$san_ext" 2>/dev/null || fail 'Self-signed certificate generation failed.'
      chmod 600 certificates/privkey.pem
      say 'Self-signed HTTPS is not trusted by browsers until this certificate is installed in their trust store.'
    fi
  fi
fi

if [[ "${use_https:-no}" =~ ^([Yy]|yes)$ ]]; then public_scheme=https; else public_scheme=http; fi
if [[ "${proxy:-no}" =~ ^([Yy]|yes)$ ]]; then
  set_env PUBLIC_SCHEME "$public_scheme"
  set_env NEXT_PUBLIC_API_URL "$public_scheme://$hostname"
  set_env NEXT_PUBLIC_KEYCLOAK_URL "$public_scheme://$hostname"
  set_env KEYCLOAK_HOSTNAME "$public_scheme://$hostname"
  set_env OIDC_ISSUER_URL "$public_scheme://$hostname/realms/$organization"
  set_env CORS_ORIGINS "$public_scheme://$hostname"
fi

# The browser must use the externally reachable Keycloak URL. The installer may
# run behind an existing reverse proxy, so configure this even without nginx.
if [[ -z "${hostname:-}" ]]; then
  configured_public_url="$(get_env NEXT_PUBLIC_KEYCLOAK_URL http://localhost:8080)"
  if [[ "$configured_public_url" == http://localhost:8080 || "$configured_public_url" == http://127.0.0.1:8080 ]]; then configured_public_url='https://mgmt.ciberdefesa.dev'; fi
  public_url="$(ask 'Public application URL (used by the browser and Keycloak)' "$configured_public_url")"
  [[ "$public_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || fail 'Public application URL must be an http(s) origin without a path.'
  public_scheme="${public_url%%://*}"
  hostname="${public_url#*://}"
  set_env PUBLIC_HOSTNAME "$hostname"
  set_env PUBLIC_SCHEME "$public_scheme"
  set_env NEXT_PUBLIC_API_URL "$public_url"
  set_env NEXT_PUBLIC_KEYCLOAK_URL "$public_url"
  set_env KEYCLOAK_HOSTNAME "$public_url"
  set_env OIDC_ISSUER_URL "$public_url/realms/$organization"
  set_env CORS_ORIGINS "$public_url"
fi
public_keycloak_url="$(get_env NEXT_PUBLIC_KEYCLOAK_URL http://localhost:8080)"
set_env KEYCLOAK_HOSTNAME "$public_keycloak_url"
set_env OIDC_ISSUER_URL "${public_keycloak_url%/}/realms/$organization"
command -v node >/dev/null || fail 'Node.js is required to prepare the Keycloak realm on first install.'
node deploy/configure-install.mjs --template deploy/realm-cociber.json --realm-file "$realm_file" --organization "$organization" --locale "$locale" --client-secret "$(get_env KEYCLOAK_ADMIN_CLIENT_SECRET '')" --public-base-url "$public_keycloak_url" || fail 'Keycloak realm configuration generation failed.'
if [[ "${use_https:-no}" =~ ^([Yy]|yes)$ ]]; then
  openssl x509 -in certificates/fullchain.pem -noout -checkend 0 >/dev/null 2>&1 || fail 'Certificate is missing, invalid, or expired.'
  cert_sans="$(openssl x509 -in certificates/fullchain.pem -noout -ext subjectAltName)"
  for san in "${sans[@]}"; do
    if [[ "$san" =~ ^[0-9.]+$ ]]; then expected="IP Address:$san"; else expected="DNS:$san"; fi
    grep -F "$expected" <<<"$cert_sans" >/dev/null || fail "Certificate SAN is missing: $san"
  done
  cert_pub="$(openssl x509 -in certificates/fullchain.pem -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256)"
  key_pub="$(openssl pkey -in certificates/privkey.pem -pubout -outform DER 2>/dev/null | openssl dgst -sha256)"
  [[ -n "$cert_pub" && "$cert_pub" == "$key_pub" ]] || fail 'Certificate and private key do not match.'
fi

say 'Checking release manifests for Linux AMD64 and ARM64.'
for image in "$(get_env DOCKERHUB_NAMESPACE joaosimoes08)/mgmt-app-api:$tag" "$(get_env DOCKERHUB_NAMESPACE joaosimoes08)/mgmt-app-web:$tag" "$(get_env DOCKERHUB_NAMESPACE joaosimoes08)/mgmt-app-snmp:$tag"; do
  manifest="$(docker manifest inspect "$image" 2>/dev/null)" || fail "Image tag unavailable: $image"
  grep -q '"architecture": "amd64"' <<<"$manifest" || fail "Image lacks linux/amd64: $image"
  grep -q '"architecture": "arm64"' <<<"$manifest" || fail "Image lacks linux/arm64: $image"
done
docker compose "${compose_files[@]}" config --quiet || fail 'Compose preflight failed; no containers were changed.'
say "Installed image tags: $(docker compose images 2>/dev/null | awk 'NR>1 {print $NF}' | sort -u | paste -sd, - || echo 'not detected'); requested target: $tag. Existing .env settings are retained."
say 'Plan: pull the selected tag and apply Compose services. Existing volumes remain attached; no volume deletion is used.'
read -r -p 'Continue? [y/N]: ' confirm
[[ "$confirm" =~ ^([Yy]|yes)$ ]] || { say 'Cancelled without starting services.'; exit 0; }
if [[ "$MODE" == update ]] && [[ -n "$(docker compose ps --services 2>/dev/null)" ]]; then
  docker compose ps --services --filter status=running 2>/dev/null | grep -q '^postgres$' || fail 'An existing stack is present but PostgreSQL is not running; start it and complete a backup before upgrading.'
  mkdir -p "$BACKUP_DIR"; stamp="$(date +%Y%m%d-%H%M%S)"
  docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_DIR/app-$stamp.sql" || fail 'Application database backup failed; deployment stopped.'
  docker compose exec -T keycloak-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_DIR/keycloak-$stamp.sql" || fail 'Keycloak database backup failed; deployment stopped.'
fi
docker compose "${compose_files[@]}" pull
docker compose "${compose_files[@]}" up -d
bootstrap_output="$(node --env-file=.env infra/keycloak/bootstrap-admin.mjs)" || fail 'The stack started but the initial application administrator could not be provisioned; rerun ./deploy.sh update after checking Keycloak health.'
if [[ "$bootstrap_output" == CREATED ]]; then
  printf '\nCreated %s application administrator: %s (role ADMIN)\nThis is separate from the Keycloak master/bootstrap account, which was not changed.\nTemporary password (shown once; change it at first login): %s\n\n' "$organization" "$(get_env BOOTSTRAP_ADMIN_USERNAME admin@admin.test)" "$(get_env BOOTSTRAP_ADMIN_PASSWORD '')"
elif [[ "${bootstrap_admin_password_generated:-0}" == 1 ]]; then
  say 'The application administrator already exists; its password was not changed. A new password was generated locally but was not displayed.'
fi
say 'Waiting up to 180 seconds for services to settle.'
ready=0
for _ in $(seq 1 60); do
  state="$(docker compose "${compose_files[@]}" ps --format '{{.Service}} {{.Health}} {{.State}}' 2>/dev/null || true)"
  if grep -q '^api healthy ' <<<"$state" && grep -q '^web healthy ' <<<"$state" && grep -q '^snmp healthy ' <<<"$state"; then ready=1; break; fi
  sleep 3
done
docker compose "${compose_files[@]}" ps
[[ $ready == 1 ]] || fail 'Application health checks did not pass within 180 seconds. Inspect: docker compose logs --tail=200 api web snmp postgres keycloak; no volumes were removed.'
say 'Management commands: docker compose ps | docker compose logs -f api web | docker compose restart <service> | docker compose stop/start | docker compose down (keeps named volumes).'
say 'Before future upgrades, back up application and Keycloak PostgreSQL databases. Prisma migrations may require restoring a compatible database before reverting images; see README.'
