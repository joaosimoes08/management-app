import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../types';
import { DeviceImageFrame } from './device-image-frame';

const messages: Record<string, string> = { 'device.noRearImage': 'Sem imagem traseira', 'device.noFrontImage': 'Sem imagem frontal' };
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => messages[key] ?? key }) }));

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
    expect(frame.querySelectorAll(':scope > .rack-port-hotspot')).toHaveLength(2);
  });

  it('puts the no-image note in a caption below the frame when ports fill a short face, never over a port', () => {
    const { container } = render(<DeviceImageFrame device={switchWithRearPorts(615, 66)} interfaces={[]} face="rear" />);
    const frame = container.querySelector('.device-image-frame') as HTMLElement;
    expect(frame).not.toHaveTextContent('Sem imagem traseira');
    const note = container.querySelector('.device-image-frame-note') as HTMLElement;
    expect(note).toHaveTextContent('Sem imagem traseira');
    expect(note.previousElementSibling).toBe(frame);
    expect(frame.contains(note)).toBe(false);
  });

  it('keeps the note inside the placeholder when a short face has no ports', () => {
    const { container } = render(<DeviceImageFrame device={switchWithRearPorts(615, 66, [port('Gi1/1', 0.05)])} interfaces={[]} face="front" />);
    expect(container.querySelector('.device-image-frame-note')).toBeNull();
    expect(container.querySelector('.device-image-frame .switch-face-fallback')).toHaveTextContent('Sem imagem frontal');
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
