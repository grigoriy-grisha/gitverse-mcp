import { describe, expect, it } from 'vitest';

import { toolSpecs, specInfo } from '../src/generated/tools.js';

describe('generated tool specs', () => {
  it('covers every operation of the OpenAPI spec', () => {
    expect(specInfo.operationCount).toBe(157);
    expect(toolSpecs).toHaveLength(specInfo.operationCount);
  });

  it('produces unique MCP-safe tool names', () => {
    const names = toolSpecs.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it('marks GET tools read-only and others mutating', () => {
    for (const spec of toolSpecs) {
      expect(spec.readOnly).toBe(spec.method === 'GET');
    }
    expect(toolSpecs.filter((t) => t.readOnly).length).toBeGreaterThan(0);
    expect(toolSpecs.filter((t) => !t.readOnly).length).toBeGreaterThan(0);
  });

  it('accepts args for the PR review comment endpoint', () => {
    const spec = toolSpecs.find((t) => t.name === 'post_repos_pulls_comments');
    expect(spec).toBeDefined();
    const parsed = spec!.schema.parse({
      owner: 'epmp',
      repo: 'ae-table',
      pull_number: 14,
      body: 'looks good',
      commit_id: 'abc123',
      path: 'src/index.ts',
      line: 10,
    });
    expect(parsed).toMatchObject({ owner: 'epmp', repo: 'ae-table', pull_number: 14 });
  });

  it('rejects missing path parameters', () => {
    const spec = toolSpecs.find((t) => t.name === 'get_repos');
    expect(() => spec!.schema.parse({ owner: 'epmp' })).toThrow();
  });

  it('exposes file-upload tools with attachment arguments', () => {
    const upload = toolSpecs.filter((t) => t.fileUpload);
    expect(upload.map((t) => t.name)).toEqual([
      'post_repos_issues_comments_attachments',
      'post_repos_issues_attachments',
      'post_repos_releases_assets',
    ]);
    for (const spec of upload) {
      expect(spec.bodyFields).toHaveLength(0);
      expect('attachment_path' in spec.schema.shape).toBe(true);
      expect('attachment_base64' in spec.schema.shape).toBe(true);
    }
  });

  it('renames body properties that clash with path params', () => {
    const spec = toolSpecs.find((t) => t.name === 'patch_orgs_actions_variables');
    expect(spec).toBeDefined();
    expect(spec!.bodyFields).toContainEqual(['body_name', 'name']);
    expect('body_name' in spec!.schema.shape).toBe(true);
  });

  it('describes every tool with its endpoint and summary', () => {
    for (const spec of toolSpecs) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.description).toContain(`[${spec.method.toLowerCase()} `);
    }
  });

  it('flattens query pagination arguments', () => {
    const spec = toolSpecs.find((t) => t.name === 'get_repos_commits');
    expect(spec).toBeDefined();
    const parsed = spec!.schema.parse({ owner: 'o', repo: 'r', page: 2, per_page: 50 });
    expect(parsed).toMatchObject({ owner: 'o', repo: 'r', page: 2, per_page: 50 });
  });
});
