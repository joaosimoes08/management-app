$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../deploy/secure-random.ps1')

$secret24 = New-CryptoHexSecret -ByteCount 24
$secret32 = New-CryptoHexSecret -ByteCount 32
if ($secret24 -notmatch '^[0-9a-f]{48}$') { throw '24-byte secret did not produce 48 lowercase hexadecimal characters.' }
if ($secret32 -notmatch '^[0-9a-f]{64}$') { throw '32-byte secret did not produce 64 lowercase hexadecimal characters.' }
if ($secret24 -eq $secret32) { throw 'Secrets generated at different lengths unexpectedly matched.' }
Write-Output 'PowerShell cryptographic secret tests passed.'
