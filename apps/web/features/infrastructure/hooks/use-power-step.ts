'use client';

import { useCallback, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { getRack, setDevicePower } from '../api';
import { devicePlugCount } from '../power';
import type { Device, DevicePowerInput, Rack } from '../types';
import type { PowerDefaults } from '../power';

export type PowerStepState = { device: { id: string; name: string }; rack: Rack; plugs: number; moved: boolean };

/**
 * The power step shown after placing a device in a rack (or from "Ligações elétricas"). Only users who may change
 * power (`canEditPower`) get it; `onError` receives a failure to open it, `onSaved` runs after the outlets are saved.
 */
export function usePowerStep({ canEditPower, powerDefaults, onError, onSaved }: {
  canEditPower: boolean;
  powerDefaults: PowerDefaults | null;
  onError: (message: string) => void;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [powerStep, setPowerStep] = useState<PowerStepState | null>(null);
  const [powerStepError, setPowerStepError] = useState('');

  /**
   * Opens the power step for a device that was just placed in a rack: new in the rack, or moved from another rack (the
   * API removed its old outlets). Skipped for devices with 0 plugs and for users who cannot change power. `force` opens it
   * for a device already in its rack ("Ligações elétricas").
   */
  const offerPowerStep = useCallback(async (saved: Pick<Device, 'id' | 'name' | 'rackId'> & Partial<Device>, previousRackId: string, force = false) => {
    if (!canEditPower || !saved.rackId) return;
    const moved = Boolean(previousRackId) && previousRackId !== saved.rackId;
    if (!force && previousRackId === saved.rackId) return;
    try {
      const rack = await getRack(saved.rackId);
      if (!rack.pdus?.length) return;
      const inRack = rack.devices?.find((item) => item.id === saved.id);
      const plugs = devicePlugCount({ ...saved, ...inRack } as Device, powerDefaults) ?? 0;
      if (plugs === 0 && !force) return;
      setPowerStepError('');
      setPowerStep({ device: { id: saved.id, name: inRack?.name ?? saved.name }, rack, plugs, moved });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : t('power.error.open'));
    }
  }, [canEditPower, powerDefaults, onError, t]);

  const savePowerStep = async (input: DevicePowerInput) => {
    if (!powerStep) return;
    setPowerStepError('');
    try {
      await setDevicePower(powerStep.device.id, input);
      setPowerStep(null);
      await onSaved();
    } catch (cause) {
      setPowerStepError(cause instanceof Error ? cause.message : t('power.error.save'));
    }
  };

  return { powerStep, powerStepError, offerPowerStep, savePowerStep, skipPowerStep: () => setPowerStep(null) };
}
