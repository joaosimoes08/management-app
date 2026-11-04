# Minimal Windows identity/heartbeat client. Uses outbound HTTPS only.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ApiUrl = if ($env:MANAGEMENT_API_URL) { $env:MANAGEMENT_API_URL.TrimEnd('/') } else { '' }
$TokenFile = if ($env:MANAGEMENT_AGENT_TOKEN_FILE) { $env:MANAGEMENT_AGENT_TOKEN_FILE } else { Join-Path $env:ProgramData 'ManagementAgent\token' }
$IntervalSeconds = 60
$AgentVersion = '1.0.0'

function Send-Heartbeat {
    if (-not $ApiUrl.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'MANAGEMENT_API_URL must use HTTPS.'
    }
    if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
        throw "Agent token file not found: $TokenFile"
    }
    $token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
    if (-not $token) { throw 'Agent token file is empty.' }

    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $body = @{
        hostname = [Environment]::MachineName
        os = $os.Caption
        osVersion = $os.Version
        agentVersion = $AgentVersion
    } | ConvertTo-Json -Compress

    $response = Invoke-RestMethod -Method Post `
        -Uri "$ApiUrl/api/v1/linux-agents/heartbeat" `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType 'application/json' -Body $body -TimeoutSec 15
    if (-not $response.accepted) { throw 'Heartbeat was not accepted.' }
}

while ($true) {
    try {
        Send-Heartbeat
    } catch {
        Write-Error -Message "Heartbeat failed: $($_.Exception.Message)" -ErrorAction Continue
    }
    Start-Sleep -Seconds $IntervalSeconds
}
