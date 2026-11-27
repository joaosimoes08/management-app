'use client';

import { useParams } from 'next/navigation';
import { Device360Page } from '@/features/infrastructure/device-360/device-360-page';

export default function DevicePage() {
  const params = useParams<{ deviceId: string }>();
  return <Device360Page deviceId={decodeURIComponent(params?.deviceId ?? '')} />;
}
