# Linux host identity and heartbeat agent

The first agent release reports hostname, Linux kernel/system name, OS release, and agent version once a minute. It makes outbound HTTPS requests only. It does not listen on a port, inspect processes/services, collect network interfaces, accept remote commands, or require root.

## Enroll and install

1. Create or select a Host already associated with a Device in the Management-App.
2. As an administrator, call `POST /api/v1/linux-agents/enrollments` with `{"hostId":"<host UUID>"}` using the normal user access token. The returned agent token is shown once; store it in a root-readable token file. Enrolling again rotates the credential and requires updating the installed token.
3. On the Linux host, install Python 3 and place the client at `/opt/management-agent/linux_heartbeat_agent.py`. Create `/etc/management-agent/token` owned by root with mode `0600`; run the process as a dedicated unprivileged account.
4. Set `MANAGEMENT_API_URL` to the HTTPS origin (for example `https://management.example`) and `MANAGEMENT_AGENT_TOKEN_FILE=/etc/management-agent/token`, then run the script under the host's service manager. The client verifies TLS using the system trust store.

Revocation: `DELETE /api/v1/linux-agents/<agent UUID>` as an administrator immediately invalidates the credential. Listing at `GET /api/v1/linux-agents?siteId=<site UUID>` is subject to existing infrastructure access permissions. Heartbeats require the agent bearer token and update only the Host's observed hostname, OS, observed status and last-seen fields.

## Acceptance checks

- Enroll a Host attached to an in-scope Device; confirm the response includes one token and the database stores only its SHA-256 hash.
- Send a heartbeat over HTTPS with that token; confirm the Host identity/OS/last-seen fields update and status is Online.
- Omit or alter the token; expect HTTP 401 and no Host changes.
- Revoke the agent; the next heartbeat must return HTTP 401 and status becomes Revoked.
- Wait over three minutes after the last heartbeat; listing reports Stale. Before the first heartbeat it reports Pending.
- Install on a real Linux host as an unprivileged user and confirm outbound TLS connectivity, service-manager restart behavior, token file permissions, and stale recovery after network restoration.

Real Linux host validation remains required for the final check; automated API tests do not prove distro service-manager or network behavior.
