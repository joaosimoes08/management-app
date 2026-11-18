import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Device } from '../../types';
import { InterfaceWorkspace } from './interface-workspace';

const device = { id: 'device-1', name: 'Core switch', type: 'SWITCH', status: 'ACTIVE' } satisfies Device;

describe('InterfaceWorkspace device selector', () => {
  it('continues to select a device through the toolbar picker', () => {
    const onDevice = vi.fn();
    render(<InterfaceWorkspace devices={[device]} selected={device} interfaces={[]} selectedInterface={null} onDevice={onDevice} onInterface={() => {}} onGenerate={() => {}} onEditDevice={() => {}} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Equipamento para gerir interfaces' }), { target: { value: device.id } });

    expect(onDevice).toHaveBeenCalledWith(device);
  });
});
