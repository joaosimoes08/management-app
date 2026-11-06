'use client';

import { useEffect, useRef } from 'react';
import type { Device } from '../../types';

type DeepLinkDeviceLoaderProps = {
  deviceId: string | null;
  loadDevice: (id: string) => Promise<Device>;
  onOpen: (device: Device) => void;
  onError: (error: unknown) => void;
};

/** Loads and opens a device target directly, including devices without a Site. */
export function DeepLinkDeviceLoader({ deviceId, loadDevice, onOpen, onError }: DeepLinkDeviceLoaderProps) {
  const requestedId = useRef('');
  useEffect(() => {
    if (!deviceId || requestedId.current === deviceId) return;
    requestedId.current = deviceId;
    let active = true;
    void loadDevice(deviceId).then((device) => {
      if (active) onOpen(device);
    }).catch((error: unknown) => {
      if (active) onError(error);
    });
    return () => { active = false; };
  }, [deviceId, loadDevice, onOpen, onError]);
  return null;
}
