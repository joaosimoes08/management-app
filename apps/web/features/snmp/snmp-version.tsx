'use client';

import { useEffect, useId, useState } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { snmpCredentialBounds } from './snmp-bounds';
import { useUiText } from '@/components/ui/use-ui-text';

/**
 * SNMP plan step 1.3 (rev. 4): v2c is accepted alongside v3 unless an admin sets SNMP_ALLOW_V2C=false. Every SNMP
 * version choice uses these pieces so v3 (authPriv) stays first and recommended, and v2c always carries its trade-off.
 */
export type SnmpVersionChoice = 'V3' | 'V2C';

/** Message keys (texts in messages/snmp). COMMUNITY_TOO_SHORT takes `{ min: snmpCredentialBounds.secret.min }`. */
export const V2C_TRADEOFF = 'snmp.version.v2cTradeoff';
export const V2C_DISABLED = 'snmp.version.v2cDisabled';
export const COMMUNITY_TOO_SHORT = 'snmp.version.communityTooShort';

export const V2C_PENDING = 'snmp.version.v2cPending';

/**
 * v2c is on unless the receiver settings say it was switched off; the API refuses it anyway when it is off.
 * While those settings are still loading the answer is unknown (null), so v2c is not offered as allowed yet.
 */
export function isV2cAllowed(receiver?: { v2cAllowed?: boolean } | null, loading = false): boolean | null {
  if (loading && !receiver) return null;
  return receiver?.v2cAllowed !== false;
}

/** Warning-styled trade-off note (dark amber on light amber, above 4.5:1), announced as a note. */
export function SnmpV2cNote({ id }: { id?: string }) {
  const t = useUiText();
  return <p id={id} className="snmp-v2c-note" role="note"><TriangleAlert size={14} aria-hidden="true" /><span>{t(V2C_TRADEOFF)}</span></p>;
}

export function SnmpV2cDisabledNote() {
  const t = useUiText();
  return <p className="snmp-v2c-disabled" role="note"><ShieldCheck size={14} aria-hidden="true" /><span>{t(V2C_DISABLED)}</span></p>;
}

type FieldProps = {
  value: SnmpVersionChoice;
  onChange: (value: SnmpVersionChoice) => void;
  /** null while the receiver settings are loading: v2c shows as disabled until it is known. */
  v2cAllowed: boolean | null;
  legend?: string;
};

/** Version picker: SNMPv3 (authPriv) first with a "Recomendado" badge, then v2c with its note, or the opt-out notice. */
export function SnmpVersionField({ value, onChange, v2cAllowed, legend }: FieldProps) {
  const t = useUiText();
  const name = useId();
  const noteId = `${name}-v2c-note`;
  useEffect(() => { if (v2cAllowed === false && value === 'V2C') onChange('V3'); }, [v2cAllowed, value, onChange]);
  return <fieldset className="snmp-version-field">
    <legend>{legend ?? t('snmp.version.legend')}</legend>
    <div className="snmp-version-options">
      <label className={value === 'V3' ? 'selected' : ''}><input type="radio" name={name} value="V3" checked={value === 'V3'} onChange={() => onChange('V3')} /><span>SNMPv3 (authPriv)</span><span className="snmp-version-badge">{t('snmp.version.recommended')}</span></label>
      {v2cAllowed === null && <label className="pending" aria-busy="true"><input type="radio" name={name} value="V2C" checked={false} disabled aria-describedby={noteId} onChange={() => undefined} /><span>SNMPv2c</span></label>}
      {v2cAllowed === true && <label className={value === 'V2C' ? 'selected' : ''}><input type="radio" name={name} value="V2C" checked={value === 'V2C'} aria-describedby={value === 'V2C' ? noteId : undefined} onChange={() => onChange('V2C')} /><span>SNMPv2c</span></label>}
    </div>
    {v2cAllowed === null ? <p id={noteId} className="snmp-v2c-pending" role="status">{t(V2C_PENDING)}</p> : v2cAllowed === false ? <SnmpV2cDisabledNote /> : value === 'V2C' && <SnmpV2cNote id={noteId} />}
  </fieldset>;
}

type CommunityProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  help?: string;
  /** Wraps the label text in a span, for forms whose CSS styles `label > span`. */
  spanLabel?: boolean;
};

/** Community input with the 8-character minimum checked inline once the user types or leaves the field. */
export function SnmpCommunityField({ label, value, onChange, required = true, help, spanLabel = false }: CommunityProps) {
  const t = useUiText();
  const id = useId();
  const [touched, setTouched] = useState(false);
  const tooShort = value.length < snmpCredentialBounds.secret.min && (touched || value.length > 0);
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [tooShort ? errorId : '', help ? helpId : ''].filter(Boolean).join(' ') || undefined;
  return <label htmlFor={id}>
    {spanLabel ? <span>{label}</span> : label}
    <input id={id} type="password" autoComplete="new-password" required={required} minLength={snmpCredentialBounds.secret.min} maxLength={snmpCredentialBounds.secret.max} value={value} aria-invalid={tooShort || undefined} aria-describedby={describedBy} onBlur={() => setTouched(true)} onChange={(event) => onChange(event.target.value)} />
    {tooShort && <small id={errorId} className="snmp-field-error" aria-live="polite">{t(COMMUNITY_TOO_SHORT, undefined, { min: snmpCredentialBounds.secret.min })}</small>}
    {help && <small id={helpId}>{help}</small>}
  </label>;
}
