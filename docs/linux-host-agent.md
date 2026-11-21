# Linux host identity and heartbeat agent

The first agent release reports hostname, Linux kernel/system name, OS release, and agent version once a minute. It makes outbound HTTPS requests only. It does not listen on a port, inspect processes/services, collect network interfaces, accept remote commands, or require root.

## Enroll and install

1. Open **Infraestrutura → Servidores** as an administrator. Select **Inscrever agente** and choose a host associated with a device.
2. Copy the token and follow the installation command shown in the dialog. Closing the dialog removes the token from view. To replace an issued token, revoke the agent and enroll it again.
3. On the Linux host, install Python 3 and place the repository's `apps/linux-agent/linux_heartbeat_agent.py` at `/opt/management-agent/linux_heartbeat_agent.py`. Store the token in a file owned by the dedicated unprivileged account with mode `0600`.
4. Set `MANAGEMENT_API_URL` to the HTTPS origin (for example `https://management.example`) and `MANAGEMENT_AGENT_TOKEN_FILE` to the token file path. Run the script under that account through the host's service manager. The client verifies TLS using the system trust store.

Use the Site and agent status filters to narrow the inventory. Open a host to view its services, IPAM links, linked equipment and agent history. In **Ações**, **Revogar agente** immediately invalidates the current token. Auditoria records enrolment and revocation.

Set `LINUX_AGENT_STALE_MINUTES` on the API deployment to change the delay before **Atrasado**. The default is 15 minutes. A newly enrolled host shows **Sem agente** and **Token já emitido** until its first heartbeat or until the delay elapses.

## Acceptance checks

- Enroll a Host attached to an in-scope Device; confirm the response includes one token and the database stores only its SHA-256 hash.
- Send a heartbeat over HTTPS with that token; confirm the Host identity/OS/last-seen fields update and status is Online.
- Omit or alter the token; expect HTTP 401 and no Host changes.
- Revoke the agent; the next heartbeat must return HTTP 401 and status becomes Revoked.
- Wait for the configured interval after the last heartbeat; listing reports Stale. Before the first heartbeat it reports Pending.
- Install on a real Linux host as an unprivileged user and confirm outbound TLS connectivity, service-manager restart behavior, token file permissions, and stale recovery after network restoration.

Real Linux host validation remains required for the final check; automated API tests do not prove distro service-manager or network behavior.
