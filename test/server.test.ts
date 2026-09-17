import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { vi, afterEach, describe, expect, it } from 'vitest';

import { GitVerseClient } from '../src/client.js';
import { toolSpecs } from '../src/generated/tools.js';
import { createGitVerseServer, filterTools, PROFILES } from '../src/server.js';

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
  it('lists all 157 tools', async () => {
    const { mcpClient } = await connect(new Map());
    const { tools } = await mcpClient.listTools();
    expect(tools).toHaveLength(toolSpecs.length);
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('get_repos');
    expect(names).toContain('post_repos_pulls_comments');
    expect(names).toContain('get_assignments');
  });

  it('annotates GET tools as read-only', async () => {
    const { mcpClient } = await connect(new Map());
    const { tools } = await mcpClient.listTools();
    const getRepos = tools.find((t) => t.name === 'get_repos');
    const createRepo = tools.find((t) => t.name === 'post_user_repos');
    expect(getRepos?.annotations?.readOnlyHint).toBe(true);
    expect(createRepo?.annotations?.readOnlyHint).toBe(false);
  });

  it('executes a read tool end-to-end and returns JSON text', async () => {
    const repoPayload = { id: 1, name: 'ae-table', full_name: 'epmp/ae-table', fork: false };
    const { mcpClient, fetchMock } = await connect(
      new Map([[/\/repos\/epmp\/ae-table$/, repoPayload]]),
    );

    const result = (await mcpClient.callTool({
      name: 'get_repos',
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
      new Response(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'repo not found' } }),
        { status: 404 },
      ),
    );
    const client = new GitVerseClient({ token: 't', fetchImpl: fetchMock });
    const server = createGitVerseServer({ client });
    const mcpClient = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);

    const result = (await mcpClient.callTool({
      name: 'get_repos',
      arguments: { owner: 'missing', repo: 'repo' },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('NOT_FOUND');
  });
});

describe('filterTools', () => {
  it('applies the include allowlist', () => {
    const filtered = filterTools(toolSpecs, { include: ['get_repos', 'get_user'] });
    expect(filtered.map((t) => t.name)).toEqual(['get_repos', 'get_user']);
  });

  it('applies the exclude denylist after include', () => {
    const filtered = filterTools(toolSpecs, {
      include: ['get_repos', 'get_user'],
      exclude: ['get_user'],
    });
    expect(filtered.map((t) => t.name)).toEqual(['get_repos']);
  });

  it('keeps everything without filters', () => {
    expect(filterTools(toolSpecs, {})).toHaveLength(toolSpecs.length);
  });

  it('expands the pr profile to existing tools only', () => {
    for (const name of PROFILES.pr) {
      expect(
        toolSpecs.find((t) => t.name === name),
        `profile tool ${name} must exist in generated specs`,
      ).toBeDefined();
    }

    const filtered = filterTools(toolSpecs, { profiles: ['pr'] });
    expect(filtered).toHaveLength(PROFILES.pr.length);
    expect(new Set(filtered.map((t) => t.name))).toEqual(new Set(PROFILES.pr));
  });

  it('lets include override profiles', () => {
    const filtered = filterTools(toolSpecs, { profiles: ['pr'], include: ['get_user'] });
    expect(filtered.map((t) => t.name)).toEqual(['get_user']);
  });

  it('rejects unknown profiles', () => {
    expect(() => filterTools(toolSpecs, { profiles: ['nope'] })).toThrow(/Unknown tool profile/);
  });

  it('covers the review workflow end to end', () => {
    const pr = new Set(PROFILES.pr);
    for (const name of [
      'get_repos_pulls',
      'get_repos_pulls_files',
      'post_repos_pulls_comments',
      'post_repos_pulls_reviews',
      'patch_repos_issues',
    ]) {
      expect(pr.has(name), `${name} must be in the pr profile`).toBe(true);
    }
  });
});
