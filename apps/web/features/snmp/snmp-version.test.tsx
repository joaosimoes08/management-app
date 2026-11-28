import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isV2cAllowed, SnmpVersionField, V2C_DISABLED, V2C_PENDING } from './snmp-version';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { translateMessage } from '@/lib/i18n/i18n';

const pending = translateMessage('pt-PT', V2C_PENDING);
const disabled = translateMessage('pt-PT', V2C_DISABLED);

afterEach(cleanup);

describe('SNMP version choice while the receiver settings load', () => {
  it('is unknown (null) while loading, then follows v2cAllowed (allowed unless switched off)', () => {
    expect(isV2cAllowed(undefined, true)).toBeNull();
    expect(isV2cAllowed(undefined, false)).toBe(true);
    expect(isV2cAllowed({ v2cAllowed: false }, false)).toBe(false);
    expect(isV2cAllowed({ v2cAllowed: true }, false)).toBe(true);
    expect(isV2cAllowed({ v2cAllowed: false }, true)).toBe(false);
  });

  it('shows v2c disabled with a pending note while unknown, and never switches the choice back', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SnmpVersionField value="V3" v2cAllowed={null} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'SNMPv2c' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(pending);
    expect(screen.queryByText(disabled)).not.toBeInTheDocument();

    rerender(<SnmpVersionField value="V3" v2cAllowed onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'SNMPv2c' })).toBeEnabled();
    expect(screen.queryByText(pending)).not.toBeInTheDocument();

    rerender(<SnmpVersionField value="V3" v2cAllowed={false} onChange={onChange} />);
    expect(screen.queryByRole('radio', { name: 'SNMPv2c' })).not.toBeInTheDocument();
    expect(screen.getByText(disabled)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(translateMessage('en-US', V2C_PENDING)).toBe(translateSourceText('en-US', pending));
    expect(translateMessage('en-US', V2C_PENDING)).not.toBe(pending);
  });
});
