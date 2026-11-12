[CmdletBinding()]
param([ValidateSet('install','update','check')][string]$Mode)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$EnvPath = Join-Path $Root '.env'
$TagDefault = 'beta-1.0.3-release'
$GuideUrl = if ($env:CA_GUIDE_URL) { $env:CA_GUIDE_URL } else { 'https://github.com/joaosimoes08/management-app/blob/main/README.md#https-and-reverse-proxy' }
function Read-Env([string]$Key, [string]$Default) {
  if (Test-Path $EnvPath) { $line = Get-Content $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -Last 1; if ($line) { return $line.Substring($Key.Length + 1) } }
  return $Default
}
function Set-Env([string]$Key, [string]$Value) {
  $lines = @(); if (Test-Path $EnvPath) { $lines = @(Get-Content $EnvPath | Where-Object { $_ -notmatch "^$([regex]::Escape($Key))=" }) }
  $lines += "$Key=$Value"; $tempPath = "$EnvPath.$([guid]::NewGuid().ToString('N')).tmp"; [IO.File]::WriteAllLines($tempPath, $lines, [Text.UTF8Encoding]::new($false)); Move-Item -Force $tempPath $EnvPath; Protect-File $EnvPath
}
function Protect-File([string]$Path) {
  if (Get-Command icacls -ErrorAction SilentlyContinue) { icacls $Path /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Could not restrict permissions on $Path." } }
}
if (-not $Mode) { if (Test-Path $EnvPath) { $defaultMode = 'update' } else { $defaultMode = 'install' }; $Mode = Read-Host "Choose install, update, or check [$defaultMode]"; if (-not $Mode) { $Mode = $defaultMode } }
if ($Mode -notin @('install','update','check')) { throw 'Choose install, update, or check.' }
Write-Host "Certificate guide (if you choose a CA): $GuideUrl"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is required.' }
docker info *> $null; if ($LASTEXITCODE -ne 0) { throw 'Docker Engine is unavailable; start Docker and retry.' }
docker compose version *> $null; if ($LASTEXITCODE -ne 0) { throw 'Docker Compose plugin is required.' }
if ($Mode -eq 'check') { docker compose config --quiet; if ($LASTEXITCODE -ne 0) { throw 'Compose preflight failed.' }; docker compose ps; exit $LASTEXITCODE }
if (Test-Path $EnvPath) {
  $backupDir = Join-Path $Root 'backups'; New-Item -ItemType Directory -Force $backupDir | Out-Null
  $envBackup = Join-Path $backupDir ('.env.' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'); Copy-Item $EnvPath $envBackup; Protect-File $envBackup
} else { Copy-Item (Join-Path $Root '.env.example') $EnvPath }
foreach ($line in (Get-Content (Join-Path $Root '.env.example'))) {
  if ($line -match '^([^#=]+)=') { $key = $Matches[1]; if (-not (Get-Content $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($key))=" })) { Add-Content $EnvPath $line } }
}
$currentRealm = Read-Env 'KEYCLOAK_REALM' 'COCiber'
$organization = Read-Host "Deployment organization and Keycloak realm [$currentRealm]"; if (-not $organization) { $organization = $currentRealm }
if ($organization -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw 'Organization/realm must be 1-64 letters, numbers, underscores, or hyphens, and start with a letter or number.' }
$currentLocale = Read-Env 'NEXT_PUBLIC_APP_LOCALE' 'pt-PT'
$locale = Read-Host "Startup language (pt-PT or en-US) [$currentLocale]"; if (-not $locale) { $locale = $currentLocale }
if ($locale -notin @('pt-PT','en-US')) { throw 'Startup language must be pt-PT or en-US.' }
$keycloakDbVolume = docker compose config --format json | node deploy/compose-volume.mjs
if ($LASTEXITCODE -ne 0 -or -not $keycloakDbVolume) { throw 'Could not resolve the Keycloak database volume from Compose configuration.' }
$keycloakDbContainer = docker compose ps -q keycloak-db | Select-Object -First 1
if ($keycloakDbContainer) {
  $mountedKeycloakDbVolume = docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' $keycloakDbContainer 2>$null
  if ($LASTEXITCODE -eq 0 -and $mountedKeycloakDbVolume) { $keycloakDbVolume = $mountedKeycloakDbVolume }
}
docker volume inspect $keycloakDbVolume *> $null
if ($LASTEXITCODE -eq 0 -and $organization -ne $currentRealm) { throw "Refusing to switch the realm of existing Keycloak data ($currentRealm). Keep it for this installation or use a separate COMPOSE_PROJECT_NAME for a fresh install." }
Set-Env 'KEYCLOAK_REALM' $organization; Set-Env 'NEXT_PUBLIC_KEYCLOAK_REALM' $organization; Set-Env 'KEYCLOAK_ADMIN_REALM' $organization
Set-Env 'NEXT_PUBLIC_ORGANIZATION_NAME' $organization; Set-Env 'NEXT_PUBLIC_APP_LOCALE' $locale
Set-Env 'OIDC_BACKCHANNEL_URL' "http://keycloak:8080/realms/$organization"
$realmPath = Read-Env 'KEYCLOAK_REALM_FILE' './deploy/realm-cociber.generated.json'
if ($organization -ne 'COCiber' -and $realmPath -eq './deploy/realm-cociber.generated.json') { $realmPath = "./deploy/realm-$organization.generated.json" }
Set-Env 'KEYCLOAK_REALM_FILE' $realmPath
$configured = Read-Env 'APP_IMAGE_TAG' $TagDefault
$imageRows = docker compose images --format json 2>$null | ConvertFrom-Json
$installed = @($imageRows | ForEach-Object { $_.Tag } | Where-Object { $_ } | Sort-Object -Unique) -join ','
if (-not $installed) { $installed = 'not detected' }
Write-Host "Installed image version: $installed; configured version: $configured; target default: $TagDefault (enter a custom tag to keep using it)."
$tag = Read-Host "Target image release tag [$TagDefault]"; if (-not $tag) { $tag = $TagDefault }
if ($tag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw 'Invalid Docker tag.' }
Set-Env 'APP_IMAGE_TAG' $tag
foreach ($key in @('POSTGRES_PASSWORD','KEYCLOAK_DB_PASSWORD','KEYCLOAK_ADMIN_PASSWORD','KEYCLOAK_ADMIN_CLIENT_SECRET')) {
  $v = Read-Env $key ''
  if (-not $v -or $v -like 'change-me*' -or $v -eq 'keycloak-local-password') { $secret = -join ((1..48 | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] })); Set-Env $key $secret }
}
$bootstrapAdminPassword = Read-Env 'BOOTSTRAP_ADMIN_PASSWORD' ''
$bootstrapAdminPasswordGenerated = $false
if (-not $bootstrapAdminPassword) { $randomBytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes); $bootstrapAdminPassword = [Convert]::ToHexString($randomBytes).ToLowerInvariant(); Set-Env 'BOOTSTRAP_ADMIN_PASSWORD' $bootstrapAdminPassword; $bootstrapAdminPasswordGenerated = $true }
$keyringPath = Read-Env 'SNMP_KEYRING_HOST_FILE' './secrets/snmp-keyring.json'
if (-not (Test-Path $keyringPath)) { if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required once to create the SNMP keyring.' }; node deploy/generate-snmp-keyring.mjs $keyringPath; if ($LASTEXITCODE -ne 0) { throw 'SNMP keyring generation failed.' } }
Protect-File $EnvPath; if (Test-Path $keyringPath) { Protect-File $keyringPath }
$proxy = Read-Host 'Enable the optional nginx reverse proxy? [no]'
$composeArgs = @('-f','docker-compose.yml')
if ($proxy -match '^(?i:y|yes)$') {
  $composeArgs += @('--profile','proxy','-f','docker-compose.proxy.yml')
  $https = Read-Host 'Enable HTTPS now? [no]'
  $hostName = Read-Host 'Public hostname [localhost]'; if (-not $hostName) { $hostName = 'localhost' }
  Set-Env 'PUBLIC_HOSTNAME' $hostName
  $nginxConfig = Read-Env 'NGINX_CONFIG_FILE' './nginx/runtime.conf'
  New-Item -ItemType Directory -Force (Split-Path -Parent $nginxConfig) | Out-Null
  if ($https -match '^(?i:y|yes)$') { Copy-Item nginx/https.conf $nginxConfig -Force } else { Copy-Item nginx/http.conf $nginxConfig -Force }
  if ($https -match '^(?i:y|yes)$') {
    $sanList = Read-Host "Comma-separated DNS names and IP addresses for certificate SANs [$hostName]"; if (-not $sanList) { $sanList = $hostName }
    $sanParts = @($sanList.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($san in $sanParts) { if ($san -notmatch '^[A-Za-z0-9.-]+$') { throw "Invalid certificate SAN: $san" } }
    $sanExt = 'subjectAltName=' + (($sanParts | ForEach-Object { if ($_ -match '^[0-9.]+$') { "IP:$_" } else { "DNS:$_" } }) -join ',')
    $ca = Read-Host 'Will a certificate authority sign your certificate? [yes]'
    New-Item -ItemType Directory -Force (Join-Path $Root 'certificates') | Out-Null
    if ($ca -notmatch '^(?i:n|no)$') {
      if (-not (Test-Path certificates/server.csr)) {
        if (Test-Path certificates/privkey.pem) { throw 'Existing certificate key found; back it up and review before replacement.' }
        openssl req -new -newkey rsa:3072 -nodes -keyout certificates/privkey.pem -out certificates/server.csr -subj "/CN=$hostName" -addext $sanExt
        if ($LASTEXITCODE -ne 0) { throw 'CSR generation failed.' }; Protect-File 'certificates/privkey.pem'; Write-Host 'Send certificates/server.csr to your CA, place the signed chain at certificates/fullchain.pem, then rerun update.'; exit 0
      }
      if (-not (Test-Path certificates/fullchain.pem)) { Write-Host 'Place the signed CA chain at certificates/fullchain.pem and rerun update.'; exit 0 }
    } else {
      if ((Test-Path certificates/fullchain.pem) -or (Test-Path certificates/privkey.pem)) { throw 'Existing certificate/key found; back it up and review before replacement.' }
      openssl req -x509 -nodes -newkey rsa:3072 -days 365 -keyout certificates/privkey.pem -out certificates/fullchain.pem -subj "/CN=$hostName" -addext $sanExt
      if ($LASTEXITCODE -ne 0) { throw 'Self-signed certificate generation failed.' }; Protect-File 'certificates/privkey.pem'; Write-Warning 'Self-signed TLS is not trusted until installed in client trust stores.'
    }
  }
}
if ($proxy -match '^(?i:y|yes)$') {
  $scheme = if ($https -match '^(?i:y|yes)$') { 'https' } else { 'http' }
  Set-Env 'PUBLIC_SCHEME' $scheme
  Set-Env 'NEXT_PUBLIC_API_URL' "$($scheme)://$hostName"; Set-Env 'NEXT_PUBLIC_KEYCLOAK_URL' "$($scheme)://$hostName"; Set-Env 'KEYCLOAK_HOSTNAME' "$($scheme)://$hostName"; Set-Env 'OIDC_ISSUER_URL' "$($scheme)://$hostName/realms/$organization"; Set-Env 'CORS_ORIGINS' "$($scheme)://$hostName"
} else {
  $publicUrl = Read-Env 'NEXT_PUBLIC_KEYCLOAK_URL' 'http://localhost:8080'
  if ($publicUrl -in @('http://localhost:8080','http://127.0.0.1:8080')) { $publicUrl = 'https://mgmt.ciberdefesa.dev' }
  $publicUrlInput = Read-Host "Public application URL (used by the browser and Keycloak) [$publicUrl]"; if ($publicUrlInput) { $publicUrl = $publicUrlInput }
  if ($publicUrl -notmatch '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$') { throw 'Public application URL must be an http(s) origin without a path.' }
  $scheme = $publicUrl.Substring(0, $publicUrl.IndexOf('://')); $hostName = $publicUrl.Substring($publicUrl.IndexOf('://') + 3)
  Set-Env 'PUBLIC_HOSTNAME' $hostName; Set-Env 'PUBLIC_SCHEME' $scheme; Set-Env 'NEXT_PUBLIC_API_URL' $publicUrl; Set-Env 'NEXT_PUBLIC_KEYCLOAK_URL' $publicUrl; Set-Env 'KEYCLOAK_HOSTNAME' $publicUrl; Set-Env 'OIDC_ISSUER_URL' "$publicUrl/realms/$organization"; Set-Env 'CORS_ORIGINS' $publicUrl
}
$publicKeycloakUrl = Read-Env 'NEXT_PUBLIC_KEYCLOAK_URL' 'http://localhost:8080'
Set-Env 'OIDC_ISSUER_URL' "$($publicKeycloakUrl.TrimEnd('/'))/realms/$organization"
node deploy/configure-install.mjs --template deploy/realm-cociber.json --realm-file "$realmPath" --organization "$organization" --locale "$locale" --client-secret "$(Read-Env 'KEYCLOAK_ADMIN_CLIENT_SECRET' '')" --public-base-url "$publicKeycloakUrl"
if ($LASTEXITCODE -ne 0) { throw 'Keycloak realm configuration generation failed.' }
Protect-File $realmPath
if ($https -match '^(?i:y|yes)$') {
  openssl x509 -in certificates/fullchain.pem -noout -checkend 0 *> $null; if ($LASTEXITCODE -ne 0) { throw 'Certificate is missing, invalid, or expired.' }
  $sanText = openssl x509 -in certificates/fullchain.pem -noout -ext subjectAltName | Out-String
  foreach ($san in $sanParts) { $expected = if ($san -match '^[0-9.]+$') { "IP Address:$san" } else { "DNS:$san" }; if ($sanText -notmatch [regex]::Escape($expected)) { throw "Certificate SAN is missing: $san" } }
  $certKey = openssl x509 -in certificates/fullchain.pem -pubkey -noout | Out-String
  $privateKey = openssl pkey -in certificates/privkey.pem -pubout | Out-String
  if ($certKey.Trim() -ne $privateKey.Trim()) { throw 'Certificate and private key do not match.' }
}
$images = @("$(Read-Env 'DOCKERHUB_NAMESPACE' 'joaosimoes08')/mgmt-app-api:$tag", "$(Read-Env 'DOCKERHUB_NAMESPACE' 'joaosimoes08')/mgmt-app-web:$tag", "$(Read-Env 'DOCKERHUB_NAMESPACE' 'joaosimoes08')/mgmt-app-snmp:$tag")
foreach ($image in $images) {
  $manifest = docker manifest inspect $image 2>$null | Out-String
  if ($LASTEXITCODE -ne 0 -or $manifest -notmatch '"architecture": "amd64"' -or $manifest -notmatch '"architecture": "arm64"') { throw "Image unavailable or missing AMD64/ARM64 manifest: $image" }
}
docker compose @composeArgs config --quiet; if ($LASTEXITCODE -ne 0) { throw 'Compose preflight failed; containers were not changed.' }
Write-Host "Installed image tags: $((docker compose images 2>$null | Select-Object -Skip 1 | ForEach-Object { ($_ -split '\s+')[-1] } | Sort-Object -Unique) -join ', '); requested target: $tag. Existing .env settings are retained."
$confirm = Read-Host "Pull $tag and apply Compose? This preserves named volumes. [y/N]"; if ($confirm -notmatch '^(?i:y|yes)$') { Write-Host 'Cancelled.'; exit 0 }
if ($Mode -eq 'update' -and (docker compose ps --services)) {
  if (-not (docker compose ps --services --filter status=running | Where-Object { $_ -eq 'postgres' })) { throw 'An existing stack is present but PostgreSQL is not running; start it and complete a backup before upgrading.' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'; $backupDir = Join-Path $Root 'backups'; New-Item -ItemType Directory -Force $backupDir | Out-Null
  docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | Set-Content -Encoding utf8 (Join-Path $backupDir "app-$stamp.sql"); if ($LASTEXITCODE -ne 0) { throw 'Application database backup failed; deployment stopped.' }
  docker compose exec -T keycloak-db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | Set-Content -Encoding utf8 (Join-Path $backupDir "keycloak-$stamp.sql"); if ($LASTEXITCODE -ne 0) { throw 'Keycloak database backup failed; deployment stopped.' }
}
docker compose @composeArgs pull; if ($LASTEXITCODE -ne 0) { throw 'Image pull failed.' }
docker compose @composeArgs up -d; if ($LASTEXITCODE -ne 0) { throw 'Compose apply failed.' }
$bootstrapOutput = node --env-file=.env infra/keycloak/bootstrap-admin.mjs
if ($LASTEXITCODE -ne 0) { throw 'The stack started but the initial application administrator could not be provisioned; rerun ./deploy.ps1 update after checking Keycloak health.' }
if ($bootstrapOutput -eq 'CREATED') { Write-Host "Created $organization application administrator: $(Read-Env 'BOOTSTRAP_ADMIN_USERNAME' 'admin@admin.test') (role ADMIN).`nThis is separate from the Keycloak master/bootstrap account, which was not changed.`nTemporary password (shown once; change it at first login): $bootstrapAdminPassword" }
elseif ($bootstrapAdminPasswordGenerated) { Write-Host 'The application administrator already exists; its password was not changed. A new password was generated locally but was not displayed.' }
Write-Host 'Waiting up to 180 seconds for API, web, and SNMP health checks.'
$healthy = $false
for ($i = 0; $i -lt 60; $i++) { $health = docker compose @composeArgs ps --format '{{.Service}} {{.Health}}' | Out-String; if ($health -match '(?m)^api healthy$' -and $health -match '(?m)^web healthy$' -and $health -match '(?m)^snmp healthy$') { $healthy = $true; break }; Start-Sleep -Seconds 3 }
docker compose @composeArgs ps
if (-not $healthy) { throw 'Application health checks did not pass within 180 seconds. Inspect docker compose logs --tail=200 api web snmp postgres keycloak; no volumes were removed.' }
Write-Host 'Commands: docker compose ps; docker compose logs -f api web; docker compose restart <service>; docker compose stop/start; docker compose down (preserves named volumes).'
Write-Host 'Back up application and Keycloak PostgreSQL before upgrades. Direct upgrades from beta-1.0.0 through beta-1.0.2-release to beta-1.0.3-release are supported; the installer creates protected backups first and preserves named volumes. Prisma migrations may require a compatible database restore before image rollback.'
