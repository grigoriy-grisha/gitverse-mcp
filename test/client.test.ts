import { describe, expect, it, vi } from 'vitest';

import { GitVerseApiError, GitVerseClient } from '../src/client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitVerseClient', () => {
  it('sends the vendor Accept header and Bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 1 }));
    const client = new GitVerseClient({ token: 'secret-token', fetchImpl: fetchMock });

    await client.requestRaw({ method: 'GET', path: '/repos/epmp/ae-table' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.gitverse.ru/repos/epmp/ae-table');
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/vnd.gitverse.object+json; version=1');
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('respects custom baseUrl and api version', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = new GitVerseClient({
      baseUrl: 'https://mock.local///',
      apiVersion: '2',
      fetchImpl: fetchMock,
    });

    await client.requestRaw({ method: 'GET', path: '/user' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://mock.local/user');
    expect(new Headers(init.headers).get('Accept')).toBe(
      'application/vnd.gitverse.object+json; version=2',
    );
  });

  it('builds query args: undefined skipped, arrays as csv, objects as json', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    await client.requestRaw({
      method: 'GET',
      path: '/repos/o/r/commits',
      query: { page: 2, per_page: 50, sha: undefined, path: ['src/a.ts', 'src/b.ts'] },
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.gitverse.ru/repos/o/r/commits?page=2&per_page=50&path=src%2Fa.ts%2Csrc%2Fb.ts',
    );
  });

  it('sends JSON bodies with content type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 9 }, 201));
    const client = new GitVerseClient({ token: 't', fetchImpl: fetchMock });

    await client.requestRaw({
      method: 'POST',
      path: '/repos/o/r/pulls/14/reviews',
      body: { event: 'APPROVED', body: 'lgtm' },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ event: 'APPROVED', body: 'lgtm' });
  });

  it('retries 429 honoring Retry-After and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    const result = await client.requestRaw({ method: 'GET', path: '/user' });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries on persistent 429', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down' } }), {
        status: 429,
        headers: { 'Retry-After': '0' },
      }),
    );
    const client = new GitVerseClient({ fetchImpl: fetchMock, maxRetries: 2 });

    await expect(client.requestRaw({ method: 'GET', path: '/user' })).rejects.toThrow(
      GitVerseApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('normalizes the API error envelope', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'bad accept header' } }),
        { status: 400 },
      ),
    );
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    const error = await client.requestRaw({ method: 'GET', path: '/repos/o/r' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitVerseApiError);
    const apiError = error as GitVerseApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('VALIDATION_ERROR');
    expect(apiError.message).toContain('bad accept header');
  });

  it('returns undefined for 204 responses', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    const result = await client.requestRaw({ method: 'DELETE', path: '/repos/o/r' });
    expect(result).toBeUndefined();
  });

  it('passes through non-JSON bodies as text', async () => {
    const fetchMock = vi.fn(async () => new Response('plain log output', { status: 200 }));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    const result = await client.requestRaw({ method: 'GET', path: '/logs' });
    expect(result).toBe('plain log output');
  });
});
