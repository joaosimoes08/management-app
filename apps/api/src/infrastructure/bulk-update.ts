export type DeviceBulkFailure = { id: string; message: string };
export type DeviceBulkOutcome = { updatedIds: string[]; failed: DeviceBulkFailure[]; auditFailed: DeviceBulkFailure[] };

export class PersistedDeviceAuditError extends Error {
  readonly deviceId: string;

  constructor(deviceId: string) {
    super('A atualização foi guardada, mas não foi possível registar a auditoria.');
    this.name = 'PersistedDeviceAuditError';
    this.deviceId = deviceId;
  }
}

/** Executes each already-authorized update independently and reports every outcome. */
export async function updateDevicesIndividually<T extends { id: string }>(
  devices: T[],
  update: (device: T) => Promise<unknown>,
): Promise<DeviceBulkOutcome> {
  const outcome: DeviceBulkOutcome = { updatedIds: [], failed: [], auditFailed: [] };
  for (const device of devices) {
    try {
      await update(device);
      outcome.updatedIds.push(device.id);
    } catch (error) {
      if (error instanceof PersistedDeviceAuditError) {
        outcome.updatedIds.push(error.deviceId);
        outcome.auditFailed.push({ id: error.deviceId, message: error.message });
      } else {
        outcome.failed.push({ id: device.id, message: error instanceof Error ? error.message : 'Falha ao atualizar o equipamento.' });
      }
    }
  }
  return outcome;
}
