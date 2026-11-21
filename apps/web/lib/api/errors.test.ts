import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setApiTokenProvider } from './client';
import { ApiRequestError, apiErrorMessage, localizedApiErrors } from './errors';

describe('apiErrorMessage', () => {
  it('keeps the API detail for PORT_LAYOUT_INCOMPLETE instead of the generic text', () => {
    const payload = { code: 'PORT_LAYOUT_INCOMPLETE', message: '2 porta(s) da face traseira não estão completamente mapeadas (portKey, x, y, width e height).', face: 'rear', partialPorts: 2 };
    expect(apiErrorMessage(payload, 'pt-PT')).toBe(payload.message);
    expect(apiErrorMessage(payload, 'en-US')).toBe('2 port(s) on the rear face are not fully mapped (port key, position and size).');
    expect(apiErrorMessage({ code: 'PORT_LAYOUT_INCOMPLETE', expected: 24, mapped: 20 }, 'en-US')).toBe('The model has 24 network ports but only 20 are mapped (front + rear).');
  });

  it('falls back to the translated code when the API gave no detail', () => {
    expect(apiErrorMessage({ code: 'PORT_LAYOUT_INCOMPLETE' }, 'pt-PT')).toBe(localizedApiErrors['pt-PT'].PORT_LAYOUT_INCOMPLETE);
    expect(apiErrorMessage({ code: 'ASSET_NOT_IMAGE', message: 'x' }, 'en-US')).toBe(localizedApiErrors['en-US'].ASSET_NOT_IMAGE);
    expect(apiErrorMessage({ code: 'PORT_LAYOUT_CONFLICT' }, 'pt-PT')).toBe('Alterado por outra pessoa — recarrega.');
  });

  it('explains an already recorded critical asset review in both languages', () => {
    const payload = { code: 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED', message: 'A revisão da semana de 2026-11-16 já foi registada por Ana. Não é possível registar outra para o mesmo ciclo.', details: { weekStart: '2026-11-16', confirmedByName: 'Ana' } };
    expect(apiErrorMessage(payload, 'pt-PT')).toBe(payload.message);
    expect(apiErrorMessage(payload, 'en-US')).toBe('The review for the week of 2026-11-16 was already recorded by Ana. Another one cannot be recorded for the same cycle.');
    expect(apiErrorMessage({ code: 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED' }, 'en-US')).toBe(localizedApiErrors['en-US'].CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED);
  });
});

describe('apiFetch errors', () => {
  afterEach(() => { setApiTokenProvider(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('throws an ApiRequestError with the status and code', async () => {
    setApiTokenProvider(async () => 't');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'PORT_LAYOUT_CONFLICT', message: 'stale', revision: 'r2' }), { status: 409 })));
    const error = await apiFetch('/x').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: 'PORT_LAYOUT_CONFLICT', message: 'Alterado por outra pessoa — recarrega.' });
    expect((error as ApiRequestError).payload?.revision).toBe('r2');
  });
});
