import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetFile, DeviceModel, PortLayoutPort, RackFace } from '../../types';
import { buildFacesSave, EMPTY_FACE_LAYOUT, faceSnapshot, PortLayoutEditor, portLayoutBlockers, portLayoutSaveHint, type PortLayoutAssetsDraft, type PortLayoutFacesDraft } from './port-layout-editor';

vi.mock('../asset-image', () => ({ AssetImage: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
afterEach(cleanup);

const port = (n: number): PortLayoutPort => ({ portKey: `ethernet1/${n}`, label: `Porta ${n}`, interfaceType: 'ETHERNET', x: .1 * n, y: .1, width: .02, height: .1 });
const model = { id: 'model-1', manufacturer: 'Acme', model: 'S4', supportsNetworkPorts: true, networkPortCount: 4 } as DeviceModel;
// Real-data shape (Cisco UCS C220 M5, NetApp FAS2750): no network ports declared, management ports mapped anyway.
const noNetworkModel = { id: 'model-2', manufacturer: 'Cisco', model: 'UCS C220 M5', supportsNetworkPorts: false, portCount: 0, networkPortCount: null } as DeviceModel;
const assets = [{ id: 'rear-img', filename: 'rear.png', mimeType: 'image/png' } as AssetFile];

function Harness({ initial, assetIds = { front: '', rear: 'rear-img' }, confirm = vi.fn(), layoutModel = model }: { initial: PortLayoutFacesDraft; assetIds?: PortLayoutAssetsDraft; confirm?: () => void; layoutModel?: DeviceModel }) {
  const [faces, setFaces] = useState(initial);
  const [face, setFace] = useState<RackFace>('rear');
  return <PortLayoutEditor modal close={vi.fn()} layoutModel={layoutModel} faces={faces} setFaces={setFaces} face={face} setFace={setFace} assets={assets} assetIds={assetIds} setAssetId={vi.fn()} detect={vi.fn()} confirm={confirm} saving={false} error="" />;
}

const save = () => screen.getByRole('button', { name: /Guardar template/ });

describe('PortLayoutEditor faces', () => {
  it('blocks saving while the running total is below the model port count', () => {
    render(<Harness initial={{ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: [port(1), port(2)] } }} />);
    expect(screen.getByText('2 de 4 portas mapeadas')).toBeInTheDocument();
    expect(screen.getByText('Frente 0 · Traseira 2')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Mapeamento incompleto: faltam 2 de 4 portas.');
    expect(save()).toBeDisabled();
    expect(save()).toHaveAccessibleDescription('Faltam 2 portas por mapear.');
  });

  it('switches tabs by keyboard, shows the empty-face message and allows saving when the other face holds every port', () => {
    const confirm = vi.fn();
    render(<Harness initial={{ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: [1, 2, 3, 4].map(port) } }} confirm={confirm} />);
    const rearTab = screen.getByRole('tab', { name: /Traseira/ });
    expect(rearTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: 'Imagem traseira do modelo' })).toBeInTheDocument();
    fireEvent.keyDown(rearTab, { key: 'Home' });
    const frontTab = screen.getByRole('tab', { name: /Frente/ });
    expect(frontTab).toHaveAttribute('aria-selected', 'true');
    expect(frontTab).toHaveFocus();
    expect(screen.getByText(/0 portas nesta face/)).toBeInTheDocument();
    expect(screen.getByText('Seleciona uma imagem frontal para posicionar as portas.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(save());
    expect(confirm).toHaveBeenCalled();
  });

  it('adds ports to the selected face with keys unique across both faces', () => {
    render(<Harness initial={{ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: [port(1), port(2), port(3)] } }} />);
    fireEvent.click(screen.getByRole('tab', { name: /Frente/ }));
    fireEvent.click(screen.getByRole('button', { name: /Adicionar porta/ }));
    expect(screen.getByText('4 de 4 portas mapeadas')).toBeInTheDocument();
    expect(screen.getByText('Frente 1 · Traseira 3')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('A frente tem portas mas não tem imagem.');
    expect(screen.getByLabelText('Nome da porta 1')).toHaveValue('Porta 4');
  });
});

describe('portLayoutBlockers', () => {
  const rear = (...keys: number[]) => ({ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: keys.map(port) } });
  const images = { front: '', rear: 'b' };

  it('reports ports above the model count', () => {
    const faces = { front: { ...EMPTY_FACE_LAYOUT, ports: [port(1), port(2)] }, rear: { ...EMPTY_FACE_LAYOUT, ports: [port(3), port(4), port(5)] } };
    expect(portLayoutBlockers(model, faces, { front: 'a', rear: 'b' })).toEqual(['Existem 1 portas a mais do que as 4 do modelo.']);
  });

  it('still blocks the normal incomplete case', () => {
    expect(portLayoutBlockers(model, rear(1, 2), images)).toEqual(['Mapeamento incompleto: faltam 2 de 4 portas.']);
  });

  it('allows any number of mapped ports when the model does not support network ports (D1)', () => {
    expect(portLayoutBlockers(noNetworkModel, rear(...Array.from({ length: 20 }, (_, i) => i + 1)), images)).toEqual([]);
    expect(portLayoutBlockers({ ...noNetworkModel, networkPortCount: 4 }, rear(1, 2, 3, 4, 5, 6, 7, 8), images)).toEqual([]);
    expect(portLayoutBlockers(noNetworkModel, rear(), images)).toEqual([]);
  });

  it('with network ports but a count of 0, nothing is missing; mapped ports are extra, as the API rejects them', () => {
    const zero = { ...model, networkPortCount: 0 };
    expect(portLayoutBlockers(zero, rear(), images)).toEqual([]);
    expect(portLayoutBlockers(zero, rear(1, 2), images)).toEqual(['Existem 2 portas a mais do que as 0 do modelo.']);
  });

  it('blocks partly mapped ports on any model, as the API does', () => {
    const faces = { front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: [port(1), { ...port(2), portKey: '' }] } };
    expect(portLayoutBlockers(noNetworkModel, faces, images)).toEqual(['1 porta não está completamente mapeada (interface, posição e tamanho).']);
  });
});

describe('PortLayoutEditor without network ports (D1)', () => {
  it('shows the map as informational and saves 8 management ports on a model with 0 ports', () => {
    const confirm = vi.fn();
    render(<Harness layoutModel={noNetworkModel} initial={{ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: [1, 2, 3, 4, 5, 6, 7, 8].map(port) } }} confirm={confirm} />);
    expect(screen.getByText('8 portas mapeadas · sem contagem obrigatória')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(confirm).toHaveBeenCalled();
  });
});

describe('faceSnapshot', () => {
  it('ignores the measured image size of a face without ports', () => {
    expect(faceSnapshot({ ...EMPTY_FACE_LAYOUT })).toBe(faceSnapshot({ imageWidth: 1100, imageHeight: 100, ports: [] }));
    expect(faceSnapshot({ ...EMPTY_FACE_LAYOUT, ports: [port(1)] })).not.toBe(faceSnapshot({ imageWidth: 1100, imageHeight: 100, ports: [port(1)] }));
  });

  it('does not flag an unchanged editor as having unsaved changes', () => {
    render(<Harness initial={{ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: [port(1)] } }} />);
    expect(screen.queryByText('Alterações por guardar')).not.toBeInTheDocument();
  });
});

describe('buildFacesSave', () => {
  const face = (...keys: number[]) => ({ ...EMPTY_FACE_LAYOUT, ports: keys.map(port) });
  const assets = (front = 'f', rear = 'r') => ({ front, rear });

  it('sends nothing when no face or image changed', () => {
    expect(buildFacesSave({ front: face(1), rear: face(2) }, { front: face(1), rear: face(2) }, assets(), assets())).toBeNull();
  });
  it('sends both faces together when ports move between them', () => {
    const body = buildFacesSave({ front: face(1, 2), rear: face(3, 4) }, { front: face(1, 2, 3), rear: face(4) }, assets(), assets());
    expect(Object.keys(body ?? {})).toEqual(['front', 'rear']);
    expect(body?.front?.ports.map((item) => item.portKey)).toEqual(['ethernet1/1', 'ethernet1/2', 'ethernet1/3']);
    expect(body?.rear?.ports.map((item) => item.portKey)).toEqual(['ethernet1/4']);
    expect(body?.front).not.toHaveProperty('assetId');
  });
  it('leaves an unchanged face out of the body', () => {
    const body = buildFacesSave({ front: face(), rear: face(1) }, { front: face(), rear: face(1, 2) }, assets(), assets());
    expect(body).not.toHaveProperty('front');
    expect(body?.rear?.ports).toHaveLength(2);
  });
  it('clears an emptied face with null so its image is kept', () => {
    expect(buildFacesSave({ front: face(1), rear: face(2) }, { front: face(), rear: face(1, 2) }, assets(), assets())).toMatchObject({ front: null });
  });
  it('sends the image only when it changed', () => {
    const body = buildFacesSave({ front: face(1), rear: face() }, { front: face(1), rear: face() }, assets('f', ''), assets('f', 'r2'));
    expect(body).toEqual({ rear: expect.objectContaining({ assetId: 'r2', ports: [] }) });
  });
});

describe('portLayoutSaveHint', () => {
  const faces = (...keys: number[]) => ({ front: { ...EMPTY_FACE_LAYOUT }, rear: { ...EMPTY_FACE_LAYOUT, ports: keys.map(port) } });
  it('counts the ports left, or points at the warnings', () => {
    expect(portLayoutSaveHint(model, faces(1, 2, 3), ['x'])).toBe('Falta 1 porta por mapear.');
    expect(portLayoutSaveHint(model, faces(1), ['x'])).toBe('Faltam 3 portas por mapear.');
    expect(portLayoutSaveHint(model, faces(1, 2, 3, 4), ['image'])).toBe('Resolve os avisos acima para guardar.');
    expect(portLayoutSaveHint(model, faces(1, 2, 3, 4), [])).toBe('');
  });
});
