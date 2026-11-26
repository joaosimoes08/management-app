'use client';

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Clock, Copy, RadioTower, TriangleAlert } from 'lucide-react';
import { formatDateTime } from '@/lib/format/date';
import { getSnmpReceiverSettings, snmpReceiverKey } from './api';
import { containerReceiverView, iosXeSetupLines, receiverAddresses, RECEIVER_PLACEHOLDER } from './snmp-setup';
import { isV2cAllowed, SnmpV2cDisabledNote, SnmpV2cNote, V2C_PENDING } from './snmp-version';
import { useUiText } from '@/components/ui/use-ui-text';

type Props = {
  /** The switch's management IP in the app; traps are matched on it. */
  managementIp?: string | null;
  username?: string | null;
  authProtocol?: string | null;
  privProtocol?: string | null;
  /** Only admins can read the receiver settings (address, port, engine ID). */
  canReadReceiver: boolean;
  /** undefined hides the trap status (pre-registration); null means no trap yet. */
  lastTrapReceivedAt?: string | null;
};

/**
 * SNMP Phase 1 step 3: what to put on the switch so its traps reach this app. Shown on the SNMP device view and in the
 * pre-registration dialog. Secrets never appear: keys and communities are placeholders the admin fills in on the switch.
 */
export function SnmpSetupPanel({ managementIp, username, authProtocol, privProtocol, canReadReceiver, lastTrapReceivedAt }: Props) {
  const tx = useUiText();
  const { data: receiver, isError, isLoading } = useQuery({ queryKey: snmpReceiverKey, queryFn: getSnmpReceiverSettings, enabled: canReadReceiver, staleTime: 30_000, retry: false });
  const addresses = useMemo(() => receiverAddresses(receiver), [receiver]);
  const [chosen, setChosen] = useState('');
  useEffect(() => { if (!addresses.includes(chosen)) setChosen(addresses[0] ?? ''); }, [addresses, chosen]);
  // Container-only receiver: one deployment address (or a reason it is missing) instead of host-agent interfaces.
  const container = useMemo(() => containerReceiverView(receiver), [receiver]);
  const port = container?.port ?? receiver?.trapPort ?? 162;
  const lineReceiver = container ? (container.state === 'address' ? container.address : null) : chosen || null;
  // Until the receiver settings arrive, v2c is unknown: no v2c lines and no "disabled" notice, just a pending line.
  const v2c = isV2cAllowed(receiver, isLoading);
  const lines = iosXeSetupLines({ receiver: lineReceiver, port, username, authProtocol, privProtocol, engineId: receiver?.engineId ?? null, v2cAllowed: v2c === true });
  const receiverId = useId();

  return <section className="ipam-card snmp-setup-panel" aria-labelledby={`${receiverId}-title`}>
    <div className="panel-heading"><div><h2 id={`${receiverId}-title`}>Configurar o switch</h2><p className="panel-description">Linhas Cisco IOS-XE para o switch enviar traps para esta app: primeiro SNMPv3 (recomendado), depois SNMPv2c. Substitui as chaves e a community pelos valores da credencial.</p></div><RadioTower size={18} /></div>
    {lastTrapReceivedAt !== undefined && <p className={`snmp-setup-status ${lastTrapReceivedAt ? 'received' : 'waiting'}`} role="status">{lastTrapReceivedAt ? <><Check size={14} />{`Última trap recebida: ${formatDateTime(lastTrapReceivedAt)}`}</> : <><Clock size={14} />A aguardar a primeira trap deste equipamento.</>}</p>}
    <dl className="snmp-setup-facts">
      <dt>Recetor de traps</dt>
      <dd>{!canReadReceiver ? 'Só administradores veem o endereço do recetor.' : isLoading ? 'A carregar…' : isError ? 'Não foi possível ler as definições do recetor SNMP.' : container ? (container.state === 'address' ? <span className="snmp-setup-receiver"><span className="mono">{container.display}</span><CopyButton text={container.display} label="Copiar endereço do recetor" /></span> : <span className="snmp-setup-missing" role="note" data-reason={container.reason}>{container.message}</span>) : addresses.length ? <span className="snmp-setup-receiver">{addresses.length > 1 ? <select aria-label="Endereço do recetor" className="context-toolbar-selector" value={chosen} onChange={(event) => setChosen(event.target.value)}>{addresses.map((address) => <option key={address} value={address}>{address}</option>)}</select> : <span className="mono">{addresses[0]}</span>}<CopyButton text={chosen ? `${chosen}${port === 162 ? '' : `:${port}`}` : ''} label="Copiar endereço do recetor" /></span> : <span className="snmp-setup-missing">{`Sem endereço: o recetor SNMP não reportou interfaces. Usa ${RECEIVER_PLACEHOLDER} e confirma em Definições > SNMP.`}</span>}</dd>
      <dt>Porta UDP</dt>
      <dd className="mono">{port}</dd>
      <dt>IP de gestão (trap-source)</dt>
      <dd className="mono">{managementIp || 'IP esperado do equipamento'}</dd>
      <dt>Engine ID da app</dt>
      <dd>{!canReadReceiver ? '—' : isLoading ? 'A carregar…' : isError ? '—' : receiver?.engineId ? <span className="mono">{receiver.engineId}</span> : 'Ainda não gerado: o recetor SNMP ainda não arrancou. Inicia o contentor snmp e volta a abrir esta página.'}</dd>
    </dl>
    <p className="snmp-setup-warning"><TriangleAlert size={14} /><span>{managementIp ? tx('groupB.snmp.trapSourceWarningIp', undefined, { ip: managementIp }) : tx('groupB.snmp.trapSourceWarning')}</span></p>
    <SetupBlock title="SNMPv3 authPriv (polling e traps)" text={lines.v3} />
    {lines.informs ? <SetupBlock title="Opcional: informs SNMPv3 (com confirmação de entrega)" text={lines.informs} /> : canReadReceiver && receiver && <p className="form-help">Os informs SNMPv3 precisam do engine ID da app, que ainda não existe.</p>}
    {lines.v2c ? <SetupBlock title="SNMPv2c (polling e traps)" text={lines.v2c} note={<SnmpV2cNote />} /> : v2c === null ? <p className="snmp-v2c-pending" role="status">{V2C_PENDING}</p> : <SnmpV2cDisabledNote />}
  </section>;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied('done'); } catch { setCopied('failed'); }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied('idle'), 2500);
  };
  return <button type="button" className="secondary-button snmp-action-button" disabled={!text} onClick={() => void copy()} aria-label={label}>{copied === 'done' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied === 'done' ? 'Copiado' : copied === 'failed' ? 'Copia manualmente' : 'Copiar'}</button>;
}

function SetupBlock({ title, text, note }: { title: string; text: string; note?: ReactNode }) {
  return <div className="snmp-setup-block">
    <div className="snmp-setup-block-head"><strong>{title}</strong><CopyButton text={text} label={`Copiar: ${title}`} /></div>
    {note}
    <pre tabIndex={0}><code>{text}</code></pre>
  </div>;
}
