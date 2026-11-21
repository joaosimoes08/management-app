'use client';

import { useEffect, useRef } from 'react';
import type { Device } from '../../types';

type DeepLinkDeviceLoaderProps = {
  deviceId: string | null;
  loadDevice: (id: string) => Promise<Device>;
  onOpen: (device: Device) => void;
  onError: (error: unknown) => void;
};

/**
 * Loads and opens a device target directly, including devices without a Site.
 * A run that is cancelled before its load resolves (StrictMode's mount/unmount/mount in dev, or the parent re-rendering
 * while the Site resolves) must not stop the next run: only a delivered device or error marks the id as handled.
 * The callbacks are read from refs so a new identity does not cancel an in-flight load.
 */
export function DeepLinkDeviceLoader({ deviceId, loadDevice, onOpen, onError }: DeepLinkDeviceLoaderProps) {
  const handledId = useRef('');
  const callbacks = useRef({ loadDevice, onOpen, onError });
  callbacks.current = { loadDevice, onOpen, onError };
  useEffect(() => {
    if (!deviceId || handledId.current === deviceId) return;
    let active = true;
    void callbacks.current.loadDevice(deviceId).then((device) => {
      if (!active || handledId.current === deviceId) return;
      handledId.current = deviceId;
      callbacks.current.onOpen(device);
    }).catch((error: unknown) => {
      if (!active || handledId.current === deviceId) return;
      handledId.current = deviceId;
      callbacks.current.onError(error);
    });
    return () => { active = false; };
  }, [deviceId]);
  return null;
}
