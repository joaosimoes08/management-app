import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Device } from '../types';
import { DeviceImageFrame } from './device-image-frame';

afterEach(() => cleanup());

const port = (key: string, x: number) => ({ portKey: key, label: key, x, y: 0.28, width: 0.03, height: 0.24 });
const switchWithRearPorts = (imageWidth: number, imageHeight: number, ports = [port('Gi1/1', 0.05), port('Gi1/2', 0.09)]) => ({
  id: 'device-1', name: 'CCD-9300', type: 'SWITCH', status: 'ACTIVE', interfaces: [],
  model: { manufacturer: 'Cisco', model: 'Catalyst 9300', portLayout: { version: 2, faces: { rear: { imageWidth, imageHeight, ports } } } },
}) as unknown as Device;

describe('DeviceImageFrame without a face image', () => {
  it('keeps the rear placeholder and its ports inside a device-shaped frame', () => {
    const { container } = render(<DeviceImageFrame device={switchWithRearPorts(615, 66)} interfaces={[]} face="rear" />);
    const frame = container.querySelector('.device-image-frame') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('615 / 66');
    const fallback = frame.querySelector(':scope > .switch-face-fallback') as HTMLElement;
    expect(fallback).toHaveClass('switch-face-fallback--inline');
    expect(fallback).toHaveAttribute('data-has-ports', 'true');
    expect(fallback).toHaveTextContent('Sem imagem traseira');
    expect(frame.querySelectorAll(':scope > .rack-port-hotspot')).toHaveLength(2);
  });

  it('stacks the placeholder on tall faces and marks when no ports are drawn', () => {
    const { container } = render(<DeviceImageFrame device={switchWithRearPorts(400, 300, [])} interfaces={[]} face="front" />);
    const fallback = container.querySelector('.switch-face-fallback') as HTMLElement;
    expect(fallback).not.toHaveClass('switch-face-fallback--inline');
    expect(fallback).not.toHaveAttribute('data-has-ports');
    expect(fallback).toHaveTextContent('Sem imagem frontal');
  });

  it('cannot grow past the frame: the global placeholder min-height and padding are reset inside it', () => {
    const styles = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    const rule = styles.match(/^\.device-image-frame > \.switch-face-fallback \{([^}]*)\}/m)?.[1] ?? '';
    expect(rule).toMatch(/min-height:\s*0/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/box-sizing:\s*border-box/);
    expect(styles).toMatch(/\.device-image-frame > \.switch-face-fallback--inline \.equipment-type-icon-large \{[^}]*height:\s*min\(64px,\s*70%\)/);
  });
});
