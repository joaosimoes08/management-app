import type { ApiExample } from './registry';

const SITE_ID = '2f1c9a4e-6b1d-4c3e-9f2a-7d5b8e0c1a23';
const tag = {
  id: '8a7d3c2b-1e4f-4a6b-9c8d-0e1f2a3b4c5d',
  siteId: SITE_ID,
  name: 'Produção',
  color: 'red',
  deviceCount: 12,
  subnetCount: 3,
  createdAt: '2026-11-02T09:15:00.000Z',
  updatedAt: '2026-11-02T09:15:00.000Z',
};

/** Examples for /v1/tags. Keys are global: prefix them with the area. */
export const tagExamples = {
  'tags.list': {
    summary: 'Etiquetas de um Site',
    description: 'GET /api/v1/tags?siteId=… devolve as etiquetas do Site, por ordem alfabética, com o número de dispositivos e sub-redes que as usam.',
    value: [tag, { ...tag, id: '9b8e4d3c-2f5a-4b7c-8d9e-1f2a3b4c5d6e', name: 'Teste', color: 'blue', deviceCount: 0, subnetCount: 1 }],
  },
  'tags.create.request': {
    summary: 'Criar uma etiqueta',
    description: 'name: 1–40 caracteres, único no Site (sem distinguir maiúsculas). color: gray, blue, green, amber, red ou purple (opcional, por omissão gray).',
    value: { siteId: SITE_ID, name: 'Produção', color: 'red' },
  },
  'tags.create.response': {
    summary: 'Etiqueta criada',
    value: { ...tag, deviceCount: 0, subnetCount: 0 },
  },
} satisfies Record<string, ApiExample>;
