import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { vi, afterEach, describe, expect, it } from 'vitest';

import { GitVerseClient } from '../src/client.js';
import { compositeTools } from '../src/composite.js';
import { createGitVerseServer } from '../src/server.js';

afterEach(() => {
  vi.restoreAllMocks();
});

async function connect(fakeResponses: Map<RegExp, unknown>) {
  const fetchMock = vi.fn(async (url: string | URL | RequestInfo) => {
    const target = typeof url === 'string' ? url : url.toString();
    for (const [pattern, body] of fakeResponses) {
      if (pattern.test(target)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: target } }), {
      status: 404,
    });
  });

  const client = new GitVerseClient({ token: 't', fetchImpl: fetchMock });
  const server = createGitVerseServer({ client });
  const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { mcpClient, fetchMock };
}

describe('gitverse MCP server', () => {
  it('registers exactly the 25 composite tools', async () => {
    const { mcpClient } = await connect(new Map());
    const { tools } = await mcpClient.listTools();
    expect(tools).toHaveLength(compositeTools.length);
    expect(tools).toHaveLength(25);
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('getRepository');
    expect(names).toContain('approvePullRequest');
    expect(names).toContain('addPullRequestComment');
    expect(names).toContain('runPipeline');
  });

  it('annotates read tools as read-only and writes as destructive', async () => {
    const { mcpClient } = await connect(new Map());
    const { tools } = await mcpClient.listTools();
    const getRepo = tools.find((t) => t.name === 'getRepository');
    const approve = tools.find((t) => t.name === 'approvePullRequest');
    expect(getRepo?.annotations?.readOnlyHint).toBe(true);
    expect(approve?.annotations?.readOnlyHint).toBe(false);
  });

  it('executes a read tool end-to-end and returns JSON text', async () => {
    const repoPayload = { id: 1, name: 'ae-table', full_name: 'epmp/ae-table', fork: false };
    const { mcpClient, fetchMock } = await connect(
      new Map([[/\/repos\/epmp\/ae-table$/, repoPayload]]),
    );

    const result = (await mcpClient.callTool({
      name: 'getRepository',
      arguments: { owner: 'epmp', repo: 'ae-table' },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toEqual(repoPayload);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.gitverse.ru/repos/epmp/ae-table');
    expect(new Headers(init.headers).get('Accept')).toBe(
      'application/vnd.gitverse.object+json; version=1',
    );
  });

  it('reports API errors as tool errors instead of crashing', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'repo not found' } }), {
        status: 404,
      }),
    );
    const client = new GitVerseClient({ token: 't', fetchImpl: fetchMock });
    const server = createGitVerseServer({ client });
    const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    const result = (await mcpClient.callTool({
      name: 'getRepository',
      arguments: { owner: 'missing', repo: 'repo' },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('NOT_FOUND');
  });
});
