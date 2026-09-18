import { describe, expect, it, vi } from 'vitest';

import { GitVerseClient } from '../src/client.js';
import { compositeToolNames, compositeTools } from '../src/composite.js';

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

function makeClient(routes: Array<{ status?: number; body?: unknown }>): {
  client: GitVerseClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  let step = 0;
  const fetchMock = vi.fn(async (url: string | URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: typeof url === 'string' ? url : url.toString(),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const route = routes[Math.min(step, routes.length - 1)];
    step += 1;
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { client: new GitVerseClient({ token: 't', fetchImpl: fetchMock }), calls };
}

function tool(name: string) {
  const found = compositeTools.find((t) => t.name === name);
  if (!found) throw new Error(`composite tool not found: ${name}`);
  return found;
}

describe('composite tools', () => {
  it('has unique Bitbucket-style names', () => {
    expect(compositeTools.length).toBe(25);
    expect(new Set(compositeToolNames).size).toBe(compositeToolNames.length);
    for (const name of compositeToolNames) {
      expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    }
  });

  it('approvePullRequest submits an APPROVED review', async () => {
    const { client, calls } = makeClient([{ body: { id: 1 } }]);
    const result = await tool('approvePullRequest').handler(client, {
      owner: 'epmp',
      repo: 'ae-table',
      pull_number: 14,
      body: 'lgtm',
    });
    expect(result).toEqual({ id: 1 });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/repos/epmp/ae-table/pulls/14/reviews');
    expect(calls[0]?.body).toEqual({ event: 'APPROVED', body: 'lgtm' });
  });

  it('requestChanges submits a REQUEST_CHANGES review', async () => {
    const { client, calls } = makeClient([{ body: {} }]);
    await tool('requestChanges').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 1,
      body: 'fix tests',
    });
    expect(calls[0]?.body).toEqual({ event: 'REQUEST_CHANGES', body: 'fix tests' });
  });

  it('declinePullRequest closes without comment when no message', async () => {
    const { client, calls } = makeClient([{ body: {} }]);
    await tool('declinePullRequest').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 5,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ state: 'closed' });
  });

  it('declinePullRequest posts the message before closing', async () => {
    const { client, calls } = makeClient([{ body: {} }, { body: {} }]);
    await tool('declinePullRequest').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 5,
      message: 'stale',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toContain('/issues/5/comments');
    expect(calls[0]?.body).toEqual({ body: 'stale' });
    expect(calls[1]?.body).toEqual({ state: 'closed' });
  });

  it('addPullRequestComment posts a general comment through the issue endpoint', async () => {
    const { client, calls } = makeClient([{ body: { id: 3 } }]);
    await tool('addPullRequestComment').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 8,
      content: 'hello',
    });
    expect(calls[0]?.url).toContain('/issues/8/comments');
    expect(calls[0]?.body).toEqual({ body: 'hello' });
  });

  it('addPullRequestComment resolves head sha for inline comments', async () => {
    const { client, calls } = makeClient([
      { body: { head: { sha: 'abc123' } } },
      { body: { id: 4 } },
    ]);
    await tool('addPullRequestComment').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 8,
      content: 'check this line',
      inline: { path: 'src/index.ts', to: 25 },
    });
    expect(calls[0]?.url).toContain('/pulls/8');
    expect(calls[1]?.url).toContain('/pulls/8/comments');
    expect(calls[1]?.body).toEqual({
      body: 'check this line',
      commit_id: 'abc123',
      path: 'src/index.ts',
      line: 25,
    });
  });

  it('unapprovePullRequest deletes only own APPROVED review', async () => {
    const { client, calls } = makeClient([
      { body: { login: 'me' } },
      {
        body: [
          { id: 7, state: 'APPROVED', user: { login: 'other' } },
          { id: 9, state: 'APPROVED', user: { login: 'me' } },
        ],
      },
      { status: 204 },
    ]);
    await tool('unapprovePullRequest').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 14,
    });
    expect(calls[0]?.url).toContain('/user');
    expect(calls[1]?.url).toContain('/pulls/14/reviews');
    expect(calls[2]?.method).toBe('DELETE');
    expect(calls[2]?.url).toContain('/pulls/14/reviews/9');
  });

  it('unapprovePullRequest fails when no own approval exists', async () => {
    const { client } = makeClient([
      { body: { login: 'me' } },
      { body: [{ id: 7, state: 'APPROVED', user: { login: 'other' } }] },
    ]);
    await expect(
      tool('unapprovePullRequest').handler(client, { owner: 'o', repo: 'r', pull_number: 14 }),
    ).rejects.toThrow(/No APPROVED review by 'me'/);
  });

  it('updatePullRequest patches PR fields and issue fields separately', async () => {
    const { client, calls } = makeClient([{ body: {} }, { body: {} }, { body: { id: 1 } }]);
    await tool('updatePullRequest').handler(client, {
      owner: 'o',
      repo: 'r',
      pull_number: 8,
      title: 'new title',
      assignees: ['alice'],
    });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toContain('/pulls/8');
    expect(calls[0]?.body).toEqual({ title: 'new title' });
    expect(calls[1]?.method).toBe('PATCH');
    expect(calls[1]?.url).toContain('/issues/8');
    expect(calls[1]?.body).toEqual({ assignees: ['alice'] });
  });

  it('runPipeline dispatches workflow on branch or tag', async () => {
    const branchClient = makeClient([{ status: 204 }]);
    await tool('runPipeline').handler(branchClient.client, {
      owner: 'o',
      repo: 'r',
      workflow: 'ci.yml',
      ref_type: 'branch',
      ref_name: 'main',
      inputs: { env: 'prod' },
    });
    expect(branchClient.calls[0]?.url).toContain('/workflows/ci.yml/dispatches?branch=main');

    const tagClient = makeClient([{ status: 204 }]);
    await tool('runPipeline').handler(tagClient.client, {
      owner: 'o',
      repo: 'r',
      workflow: 'ci.yml',
      ref_type: 'tag',
      ref_name: 'v1.0.0',
    });
    expect(tagClient.calls[0]?.url).toContain('/workflows/ci.yml/dispatches?tag=v1.0.0');
    expect(tagClient.calls[0]?.body).toEqual({});
  });
});
