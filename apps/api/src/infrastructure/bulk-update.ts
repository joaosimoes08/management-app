export type DeviceBulkFailure = { id: string; message: string };
export type DeviceBulkOutcome = { updatedIds: string[]; failed: DeviceBulkFailure[] };

/** Executes each already-authorized update independently and reports every outcome. */
export async function updateDevicesIndividually<T extends { id: string }>(
  devices: T[],
  update: (device: T) => Promise<unknown>,
): Promise<DeviceBulkOutcome> {
  const outcome: DeviceBulkOutcome = { updatedIds: [], failed: [] };
  for (const device of devices) {
    try {
      await update(device);
      outcome.updatedIds.push(device.id);
    } catch (error) {
      outcome.failed.push({ id: device.id, message: error instanceof Error ? error.message : 'Falha ao atualizar o equipamento.' });
    }
  }
  return outcome;
}
