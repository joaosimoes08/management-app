import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../../types';
import { RackDeviceZoom } from './rack-device-zoom';

const device = { id: 'device-1', name: 'Edge switch', type: 'SWITCH', status: 'ACTIVE', interfaces: [] } as unknown as Device;
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: device, isLoading: false }) }));
vi.mock('../device-image-frame', () => ({ DeviceImageFrame: ({ face }: { face: string }) => <div data-testid="device-image" data-face={face} /> }));
afterEach(() => cleanup());

const renderZoom = (face: 'front' | 'rear') => <RackDeviceZoom deviceId="device-1" face={face} onBack={vi.fn()} onInterfaces={vi.fn()} />;

describe('RackDeviceZoom focus stage', () => {
  it('has no face picker of its own and shows the face chosen in the rack', () => {
    const { container } = render(renderZoom('rear'));
    const stage = container.querySelector('.rack-device-focus-stage') as HTMLElement;
    expect(stage).toHaveAttribute('data-face', 'rear');
    expect(stage.querySelector('[role="radiogroup"], select')).toBeNull();
    expect(screen.getByTestId('device-image')).toHaveAttribute('data-face', 'rear');
  });

  it('updates when the selected face changes', () => {
    const view = render(renderZoom('rear'));
    view.rerender(renderZoom('front'));
    expect(screen.getByTestId('device-image')).toHaveAttribute('data-face', 'front');
  });
});
