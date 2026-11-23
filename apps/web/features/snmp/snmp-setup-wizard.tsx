'use client';

import { type FormEvent, useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, ChevronLeft, ChevronRight, KeyRound, Loader2, X } from 'lucide-react';
import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { getSnmpOverview, getSnmpReceiverSettings, runSnmpPoll, saveSnmpConfig, saveSnmpCredential, snmpReceiverKey, testSnmpCredential } from './api';
import { snmpConfigBounds, snmpConfigError, snmpCredentialBounds, snmpCredentialError } from './snmp-bounds';
import { describeCredentialTest, latestJob, type SnmpJobView } from './snmp-setup';
import { isV2cAllowed, SnmpCommunityField, SnmpVersionField, type SnmpVersionChoice } from './snmp-version';

export const wizardSteps = ['Credencial', 'Testar', 'Polling', 'Primeira sincronização'] as const;
type Step = 0 | 1 | 2 | 3;

const emptyCredential = { version: 'V3' as SnmpVersionChoice, username: '', authProtocol: 'SHA256', privProtocol: 'AES128', authKey: '', privKey: '', community: '' };
const running = (job: SnmpJobView | null) => job?.status === 'PENDING' || job?.status === 'RUNNING';

type Props = { deviceId: string; deviceName: string; close: () => void; onDone?: () => void };

/**
 * SNMP Phase 1 step 5: "Configurar SNMP" in four steps: save a READ credential, test it against the device, turn on
 * polling, and run the first sync. Each step shows the real result before the next one opens. ADMIN only (the API
 * refuses credentials and config otherwise).
 */
export function SnmpSetupWizard({ deviceId, deviceName, close, onDone }: Props) {
  useEscapeClose(close);
  const dialogRef = useDialogFocusRef<HTMLElement>();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [credential, setCredential] = useState(emptyCredential);
  const setVersion = useCallback((version: SnmpVersionChoice) => setCredential((current) => ({ ...current, version })), []);
  const [polling, setPolling] = useState({ enabled: true, intervalMinutes: 15 });
  const [testJobId, setTestJobId] = useState('');
  const [pollJobId, setPollJobId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: receiver } = useQuery({ queryKey: snmpReceiverKey, queryFn: getSnmpReceiverSettings, staleTime: 30_000, retry: false });
  const waitingJob = (step === 1 && testJobId) || (step === 3 && pollJobId);
  const { data: overview } = useQuery({ queryKey: ['snmp', 'overview', deviceId], queryFn: () => getSnmpOverview(deviceId), refetchInterval: waitingJob ? 2_000 : false });
  const existingRead = overview?.credentials.find((item) => item.purpose === 'READ');
  const testJob = testJobId ? latestJob(overview?.jobs, 'CREDENTIAL_TEST', testJobId) : null;
  const pollJob = pollJobId ? latestJob(overview?.jobs, 'POLL', pollJobId) : null;
  const test = testJob ? describeCredentialTest(testJob) : null;

  const run = async (work: () => Promise<void>) => {
    setError(''); setBusy(true);
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'A operação falhou.'); } finally { setBusy(false); }
  };
  const saveCredential = (event: FormEvent) => {
    event.preventDefault();
    const invalid = snmpCredentialError(credential);
    if (invalid) { setError(invalid); return; }
    void run(async () => {
      await saveSnmpCredential(deviceId, { purpose: 'READ', ...credential });
      setCredential(emptyCredential); setTestJobId('');
      await queryClient.invalidateQueries({ queryKey: ['snmp', 'overview', deviceId] });
      setStep(1);
    });
  };
  const startTest = () => void run(async () => { const job = await testSnmpCredential(deviceId, 'READ'); setTestJobId(job.id); await queryClient.invalidateQueries({ queryKey: ['snmp', 'overview', deviceId] }); });
  const saveConfig = () => {
    const values = { enabled: polling.enabled, port: overview?.config?.port ?? 161, intervalMinutes: polling.intervalMinutes, timeoutMs: overview?.config?.timeoutMs ?? 5000, retries: overview?.config?.retries ?? 2, compatibilitySha1: existingRead?.authProtocol === 'SHA1' || overview?.config?.compatibilitySha1 === true };
    const invalid = snmpConfigError(values);
    if (invalid) { setError(invalid); return; }
    void run(async () => { await saveSnmpConfig(deviceId, values); await queryClient.invalidateQueries({ queryKey: ['snmp'] }); setStep(3); });
  };
  const startPoll = () => void run(async () => { const job = await runSnmpPoll(deviceId); setPollJobId(job.id); await queryClient.invalidateQueries({ queryKey: ['snmp', 'overview', deviceId] }); });
  const finish = () => { void queryClient.invalidateQueries({ queryKey: ['snmp'] }); onDone?.(); close(); };

  return <div className="modal-backdrop"><section ref={dialogRef} className="modal-card snmp-wizard" role="dialog" aria-modal="true" aria-labelledby="snmp-wizard-title">
    <div className="modal-heading"><div><span className="section-kicker">{deviceName}</span><h2 id="snmp-wizard-title">Configurar SNMP</h2></div><button className="icon-button subtle" onClick={close} aria-label="Fechar"><X size={16} /></button></div>
    <ol className="snmp-wizard-steps" aria-label="Passos">{wizardSteps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={11} /> : index + 1}</span>{label}</li>)}</ol>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}

    {step === 0 && <form className="modal-form" onSubmit={saveCredential}>
      <p className="form-help">{existingRead ? `Já existe uma credencial de leitura (${existingRead.version}${existingRead.username ? ` · ${existingRead.username}` : ''}). Podes substituí-la ou continuar com ela.` : 'Credencial de leitura igual à configurada no switch. As chaves e a community não voltam a ser mostradas.'}</p>
      <SnmpVersionField value={credential.version} v2cAllowed={isV2cAllowed(receiver)} onChange={setVersion} />
      {credential.version === 'V2C' ? <SnmpCommunityField label="Community" value={credential.community} onChange={(community) => setCredential((current) => ({ ...current, community }))} /> : <>
        <label>Username<input autoComplete="off" maxLength={snmpCredentialBounds.username.max} value={credential.username} onChange={(event) => setCredential({ ...credential, username: event.target.value })} /></label>
        <div className="form-row"><label>Protocolo auth<select className="context-toolbar-selector" value={credential.authProtocol} onChange={(event) => setCredential({ ...credential, authProtocol: event.target.value })}><option>SHA256</option><option>SHA384</option><option>SHA512</option><option>SHA1</option></select></label><label>Privacidade<select className="context-toolbar-selector" value={credential.privProtocol} onChange={(event) => setCredential({ ...credential, privProtocol: event.target.value })}><option>AES128</option><option>AES256</option></select></label></div>
        <label>Auth key<input type="password" autoComplete="new-password" minLength={snmpCredentialBounds.secret.min} maxLength={snmpCredentialBounds.secret.max} value={credential.authKey} onChange={(event) => setCredential({ ...credential, authKey: event.target.value })} /></label>
        <label>Privacy key<input type="password" autoComplete="new-password" minLength={snmpCredentialBounds.secret.min} maxLength={snmpCredentialBounds.secret.max} value={credential.privKey} onChange={(event) => setCredential({ ...credential, privKey: event.target.value })} /></label>
      </>}
      <div className="modal-actions">{existingRead && <button type="button" className="secondary-button" onClick={() => { setError(''); setStep(1); }}>Usar a existente <ChevronRight size={14} /></button>}<button className="primary-button" disabled={busy}><KeyRound size={14} /> Guardar e continuar</button></div>
    </form>}

    {step === 1 && <div className="modal-form">
      <p className="form-help">Pede o sysName ao equipamento com a credencial de leitura e mostra a resposta real.</p>
      {test && <p className={`snmp-test-result ${test.state}`} role="status">{test.state === 'running' ? <Loader2 size={14} className="spin" /> : test.state === 'ok' ? <Check size={14} /> : <X size={14} />}<strong>{test.label}</strong>{'detail' in test && <span>{test.detail}</span>}</p>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setStep(0)}><ChevronLeft size={14} /> Credencial</button><button type="button" className="secondary-button" disabled={busy || running(testJob)} onClick={startTest}>{testJobId ? 'Testar de novo' : 'Testar credencial'}</button><button type="button" className="primary-button" disabled={test?.state !== 'ok'} onClick={() => { setError(''); setStep(2); }}>Continuar <ChevronRight size={14} /></button></div>
    </div>}

    {step === 2 && <div className="modal-form">
      <label className="snmp-wizard-check"><input type="checkbox" checked={polling.enabled} onChange={(event) => setPolling({ ...polling, enabled: event.target.checked })} /> Recolher dados automaticamente (polling)</label>
      <label>Intervalo (min)<input type="number" min={snmpConfigBounds.intervalMinutes.min} max={snmpConfigBounds.intervalMinutes.max} value={polling.intervalMinutes} onChange={(event) => setPolling({ ...polling, intervalMinutes: Number(event.target.value) })} /><small>Tempo entre recolhas automáticas (5 a 1440 min).</small></label>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setStep(1)}><ChevronLeft size={14} /> Testar</button><button type="button" className="primary-button" disabled={busy} onClick={saveConfig}>Guardar e continuar <ChevronRight size={14} /></button></div>
    </div>}

    {step === 3 && <div className="modal-form">
      {!polling.enabled ? <p className="form-help">O polling ficou desativado, por isso não há sincronização. Podes ativá-lo mais tarde no equipamento.</p> : <>
        <p className="form-help">Recolhe agora o sistema, as interfaces e os vizinhos LLDP do equipamento.</p>
        {pollJob && <p className={`snmp-test-result ${pollJob.status === 'COMPLETED' ? 'ok' : running(pollJob) ? 'running' : 'failed'}`} role="status">{running(pollJob) ? <><Loader2 size={14} className="spin" /><strong>A sincronizar…</strong></> : pollJob.status === 'COMPLETED' ? <><Check size={14} /><strong>Primeira sincronização concluída</strong></> : <><X size={14} /><strong>A sincronização falhou</strong><span>{pollJob.errorCode || pollJob.status}</span></>}</p>}
      </>}
      <div className="modal-actions">{polling.enabled && <button type="button" className="secondary-button" disabled={busy || running(pollJob)} onClick={startPoll}><Activity size={14} /> {pollJobId ? 'Sincronizar de novo' : 'Sincronizar agora'}</button>}<button type="button" className="primary-button" onClick={finish}><Check size={14} /> Concluir</button></div>
    </div>}
  </section></div>;
}
