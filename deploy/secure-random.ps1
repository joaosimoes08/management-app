function New-CryptoHexSecret {
  param([Parameter(Mandatory)][ValidateRange(1,4096)][int]$ByteCount)
  $bytes = [byte[]]::new($ByteCount)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToHexString($bytes).ToLowerInvariant()
}
