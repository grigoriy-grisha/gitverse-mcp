import { describe, expect, it, vi } from 'vitest';

import { GitVerseApiError, GitVerseClient } from '../src/client.js';
import { toolSpecs } from '../src/generated/tools.js';

function spec(name: string) {
  const found = toolSpecs.find((t) => t.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

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

    await client.request(spec('get_repos'), { owner: 'epmp', repo: 'ae-table' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.gitverse.ru/repos/epmp/ae-table');
    const headers = new Headers(init.headers);
    expect(headers.get('Accept')).toBe('application/vnd.gitverse.object+json; version=1');
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('substitutes path params with URL encoding and builds query args', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    await client.request(spec('get_repos_commits'), {
      owner: 'ep mp',
      repo: 'ae-table',
      page: 2,
      per_page: 50,
      sha: 'main',
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.gitverse.ru/repos/ep%20mp/ae-table/commits?page=2&per_page=50&sha=main',
    );
  });

  it('omits undefined query args and encodes array values as csv', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    await client.request(spec('get_repos_commits'), {
      owner: 'o',
      repo: 'r',
      sha: undefined,
      path: ['src/a.ts', 'src/b.ts'],
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.gitverse.ru/repos/o/r/commits?path=src%2Fa.ts%2Csrc%2Fb.ts');
  });

  it('flattened body args travel as a JSON request body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 9 }, 201));
    const client = new GitVerseClient({ token: 't', fetchImpl: fetchMock });

    await client.request(spec('post_repos_pulls_comments'), {
      owner: 'epmp',
      repo: 'ae-table',
      pull_number: 14,
      body: 'review text',
      commit_id: 'abc',
      path: 'src/index.ts',
      line: 10,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      body: 'review text',
      commit_id: 'abc',
      path: 'src/index.ts',
      line: 10,
    });
  });

  it('retries 429 honoring Retry-After and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    const result = await client.request(spec('get_user'), {});
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

    await expect(client.request(spec('get_user'), {})).rejects.toThrow(GitVerseApiError);
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

    const error = await client.request(spec('get_repos'), { owner: 'o', repo: 'r' }).catch(
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

    const result = await client.request(spec('delete_repos_issues_comments'), {
      owner: 'o',
      repo: 'r',
      index: 7,
      comment_id: 5,
    });
    expect(result).toBeUndefined();
  });

  it('rejects when a path parameter is missing', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = new GitVerseClient({ fetchImpl: fetchMock });

    await expect(client.request(spec('get_repos'), { owner: 'o' })).rejects.toThrow(
      /Missing path parameter 'repo'/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds multipart body for file uploads from a base64 argument', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 3 }, 201));
    const client = new GitVerseClient({ token: 't', fetchImpl: fetchMock });
    const content = Buffer.from('hello attachment').toString('base64');

    await client.request(spec('post_repos_releases_assets'), {
      owner: 'o',
      repo: 'r',
      release_id: '12',
      name: 'asset.zip',
      attachment_base64: content,
      filename: 'release.zip',
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/o/r/releases/12/assets?name=asset.zip');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBeNull();
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    const file = form.get('attachment');
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe('release.zip');
  });
});
