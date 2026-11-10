[CmdletBinding()]
param([ValidateSet('install','update','check')][string]$Mode)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
$EnvPath = Join-Path $Root '.env'
$TagDefault = 'beta-1.0.0-release'
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
  Copy-Item $EnvPath (Join-Path $backupDir ('.env.' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'))
} else { Copy-Item (Join-Path $Root '.env.example') $EnvPath }
foreach ($line in (Get-Content (Join-Path $Root '.env.example'))) {
  if ($line -match '^([^#=]+)=') { $key = $Matches[1]; if (-not (Get-Content $EnvPath | Where-Object { $_ -match "^$([regex]::Escape($key))=" })) { Add-Content $EnvPath $line } }
}
$current = Read-Env 'APP_IMAGE_TAG' $TagDefault
$tag = Read-Host "Image release tag [$current]"; if (-not $tag) { $tag = $current }
if ($tag -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { throw 'Invalid Docker tag.' }
Set-Env 'APP_IMAGE_TAG' $tag
foreach ($key in @('POSTGRES_PASSWORD','KEYCLOAK_DB_PASSWORD','KEYCLOAK_ADMIN_PASSWORD','KEYCLOAK_ADMIN_CLIENT_SECRET')) {
  $v = Read-Env $key ''
  if (-not $v -or $v -like 'change-me*' -or $v -eq 'keycloak-local-password') { $secret = -join ((1..48 | ForEach-Object { '0123456789abcdef'[(Get-Random -Maximum 16)] })); Set-Env $key $secret }
}
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
  Set-Env 'NEXT_PUBLIC_API_URL' "$($scheme)://$hostName"; Set-Env 'NEXT_PUBLIC_KEYCLOAK_URL' "$($scheme)://$hostName"; Set-Env 'KEYCLOAK_HOSTNAME' "$($scheme)://$hostName"; Set-Env 'OIDC_ISSUER_URL' "$($scheme)://$hostName/realms/COCiber"; Set-Env 'CORS_ORIGINS' "$($scheme)://$hostName"
}
$realmPath = Read-Env 'KEYCLOAK_REALM_FILE' './deploy/realm-cociber.generated.json'
if (-not (Test-Path $realmPath)) {
  node -e 'const fs=require("fs"),path=require("path");const env=fs.readFileSync(".env","utf8"),get=k=>env.match(new RegExp("^"+k+"=(.*)$","m"))?.[1],secret=get("KEYCLOAK_ADMIN_CLIENT_SECRET"),p=get("KEYCLOAK_REALM_FILE")||"./deploy/realm-cociber.generated.json";if(secret){const r=JSON.parse(fs.readFileSync("deploy/realm-cociber.json","utf8")),c=r.clients.find(x=>x.clientId==="simoes-settings-admin");if(c&&c.secret.startsWith("change-me"))c.secret=secret;const host=get("PUBLIC_HOSTNAME"),scheme=get("PUBLIC_SCHEME");if(host&&scheme){const base=`${scheme}://${host}`,web=r.clients.find(x=>x.clientId==="simoes-web");if(web){web.redirectUris=[`${base}/*`];web.webOrigins=[base];web.attributes={...web.attributes,"post.logout.redirect.uris":`${base}/*`}}}fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(r,null,2)+"\n",{mode:0o600})}'
  if ($LASTEXITCODE -ne 0) { throw 'Keycloak realm configuration generation failed.' }
}
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
Write-Host 'Waiting up to 180 seconds for API, web, and SNMP health checks.'
$healthy = $false
for ($i = 0; $i -lt 60; $i++) { $health = docker compose @composeArgs ps --format '{{.Service}} {{.Health}}' | Out-String; if ($health -match '(?m)^api healthy$' -and $health -match '(?m)^web healthy$' -and $health -match '(?m)^snmp healthy$') { $healthy = $true; break }; Start-Sleep -Seconds 3 }
docker compose @composeArgs ps
if (-not $healthy) { throw 'Application health checks did not pass within 180 seconds. Inspect docker compose logs --tail=200 api web snmp postgres keycloak; no volumes were removed.' }
Write-Host 'Commands: docker compose ps; docker compose logs -f api web; docker compose restart <service>; docker compose stop/start; docker compose down (preserves named volumes).'
Write-Host 'Back up application and Keycloak PostgreSQL before upgrades. Prisma migrations may require a compatible database restore before image rollback.'
