# Windows host identity and heartbeat agent

The first agent release reports the Windows computer name, OS caption and version, and agent version once a minute. It makes outbound HTTPS requests only. It does not listen on a port, inspect processes/services, collect network interfaces, accept remote commands, or require administrator access to run.

## Enroll and install

1. Create or select a Host already associated with a Device in the Management-App.
2. As an administrator, call `POST /api/v1/linux-agents/enrollments` with `{"hostId":"<host UUID>"}` using the normal user access token. This shared endpoint returns the agent token once; store it securely. Enrolling again rotates the credential and requires updating the installed token.
3. Install PowerShell 7 or Windows PowerShell 5.1 and place `apps/windows-agent/windows_heartbeat_agent.ps1` on the Windows host. Set `MANAGEMENT_AGENT_TOKEN_FILE` to a file readable only by the account running the agent. Set `MANAGEMENT_API_URL` to the HTTPS origin (for example `https://management.example`).
4. Run the script under a dedicated, unprivileged account using the organization's chosen service manager or Task Scheduler. Keep the token file outside the script directory and restrict its ACL to that account and administrators.

The client uses Windows certificate validation via `Invoke-RestMethod`. It expects the heartbeat response to contain `accepted: true`. It retries on the next 60-second interval after network or server errors. Heartbeats require the shared agent bearer token and update the existing Host fields. No Windows-specific API or database schema is added.

Revocation: `DELETE /api/v1/linux-agents/<agent UUID>` as an administrator immediately invalidates the credential. Listing at `GET /api/v1/linux-agents?siteId=<site UUID>` is subject to existing infrastructure access permissions.

## Acceptance checks

- Enroll a Host attached to an in-scope Device; confirm the response includes one token and the database stores only its SHA-256 hash.
- Send a heartbeat over HTTPS with that token; confirm the Host identity/OS/last-seen fields update and status is Online.
- Omit or alter the token; expect HTTP 401 and no Host changes.
- Revoke the agent; the next heartbeat must return HTTP 401 and status becomes Revoked.
- Wait over three minutes after the last heartbeat; listing reports Stale. Before the first heartbeat it reports Pending.
- Install on a real Windows host and confirm CIM access, outbound TLS connectivity, chosen service-manager restart behavior, token-file ACLs, and stale recovery after network restoration.

Real Windows host validation remains required. PowerShell execution policy, service installation, scheduled-task behavior, user-specific certificate stores, and token ACL setup vary by Windows edition and organization policy; this repository does not silently install a service or weaken execution policy.
