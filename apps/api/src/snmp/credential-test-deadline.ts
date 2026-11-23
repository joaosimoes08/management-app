/**
 * P0-3 follow-up: a credential test must always end. The worker times out its own SNMP request after the device's
 * timeoutMs (no retries), but a job that no worker ever picks up (SNMP service stopped) or a worker that dies mid-test
 * left the job PENDING/RUNNING forever, so "A testar…" never cleared. Past this deadline the API closes the job.
 */
export const CREDENTIAL_TEST_GRACE_MS = 10_000;
/** Job never picked up by an SNMP worker within the deadline. */
export const SNMP_WORKER_UNAVAILABLE = 'SNMP_WORKER_UNAVAILABLE';

export function credentialTestDeadlineMs(config: { timeoutMs: number } | null | undefined) {
  return (config?.timeoutMs ?? 5000) + CREDENTIAL_TEST_GRACE_MS;
}

type TestJob = { id: string; type: string; status: string; createdAt: Date; startedAt: Date | null };

/** The credential tests still open past their deadline, with the error code each one is closed with. */
export function expiredCredentialTests(jobs: TestJob[], config: { timeoutMs: number } | null | undefined, now = new Date()) {
  const deadline = credentialTestDeadlineMs(config);
  return jobs
    .filter((job) => job.type === 'CREDENTIAL_TEST' && (job.status === 'PENDING' || job.status === 'RUNNING'))
    .filter((job) => now.getTime() - (job.startedAt ?? job.createdAt).getTime() > deadline)
    .map((job) => ({ id: job.id, status: job.status as 'PENDING' | 'RUNNING', errorCode: job.status === 'PENDING' ? SNMP_WORKER_UNAVAILABLE : 'SNMP_TIMEOUT' }));
}
