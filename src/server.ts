import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GitVerseClient } from './client.js';
import { toolSpecs } from './generated/tools.js';
import type { ToolSpec } from './types.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export const PROFILES = {
  pr: [
    'get_user',
    'get_repos',
    'get_repos_contents',
    'get_repos_compare',
    'get_repos_labels',
    'get_repos_pulls',
    'get_repos_pulls_pull_number',
    'post_repos_pulls',
    'patch_repos_pulls',
    'get_repos_pulls_commits',
    'get_repos_pulls_files',
    'get_repos_pulls_merge',
    'put_repos_pulls_update_branch',
    'post_repos_pulls_comments',
    'get_repos_pulls_reviews',
    'post_repos_pulls_reviews',
    'post_repos_pulls_reviews_events',
    'get_repos_issues_index',
    'patch_repos_issues',
    'get_repos_issues_comments',
    'post_repos_issues_comments',
    'patch_repos_issues_comments',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ProfileName = keyof typeof PROFILES;

export interface ToolFilter {
  profiles?: readonly string[];
  include?: readonly string[];
  exclude?: readonly string[];
}

export interface ServerOptions extends ToolFilter {
  client: GitVerseClient;
}

export function filterTools(specs: readonly ToolSpec[], filter: ToolFilter): ToolSpec[] {
  let allow: Set<string> | undefined;
  if (filter.include && filter.include.length > 0) {
    allow = new Set(filter.include);
  } else if (filter.profiles && filter.profiles.length > 0) {
    allow = new Set();
    for (const name of filter.profiles) {
      const profile = PROFILES[name as ProfileName];
      if (!profile) {
        throw new Error(
          `Unknown tool profile '${name}'. Available profiles: ${Object.keys(PROFILES).join(', ')}`,
        );
      }
      for (const tool of profile) allow.add(tool);
    }
  }
  const deny = filter.exclude && filter.exclude.length > 0 ? new Set(filter.exclude) : undefined;
  return specs.filter((spec) => (allow ? allow.has(spec.name) : true) && !(deny && deny.has(spec.name)));
}

export function createGitVerseServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const specs = filterTools(toolSpecs, options);

  for (const spec of specs) {
    server.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.schema.shape,
        annotations: {
          readOnlyHint: spec.readOnly,
          destructiveHint: !spec.readOnly,
          idempotentHint: spec.readOnly,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await options.client.request(spec, args ?? {});
          return {
            content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }],
          };
        } catch (error) {
          const message =
            error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          return {
            isError: true,
            content: [{ type: 'text', text: message }],
          };
        }
      },
    );
  }

  return server;
}
