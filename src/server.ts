import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { GitVerseClient } from './client.js';
import { compositeTools } from './composite.js';
import { toolSpecs } from './generated/tools.js';
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
  bitbucket: [
    'listRepositories',
    'getRepository',
    'getPullRequests',
    'createPullRequest',
    'getPullRequest',
    'updatePullRequest',
    'getPullRequestActivity',
    'approvePullRequest',
    'unapprovePullRequest',
    'declinePullRequest',
    'requestChanges',
    'removeChangeRequest',
    'createDraftPullRequest',
    'getPullRequestComments',
    'addPullRequestComment',
    'updatePullRequestComment',
    'deletePullRequestComment',
    'getPullRequestDiff',
    'getPullRequestCommits',
    'listPipelineRuns',
    'getPipelineRun',
    'runPipeline',
    'getPipelineSteps',
    'getPipelineStep',
    'getPipelineStepLogs',
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

interface NamedTool {
  name: string;
}

function filterNamed<T extends NamedTool>(items: readonly T[], filter: ToolFilter): T[] {
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
  return items.filter((item) => (allow ? allow.has(item.name) : true) && !(deny && deny.has(item.name)));
}

export function filterTools<T extends NamedTool>(items: readonly T[], filter: ToolFilter): T[] {
  return filterNamed(items, filter);
}

export function createGitVerseServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const specs = filterNamed(toolSpecs, options);
  const composites = filterNamed(compositeTools, options);

  const register = (
    name: string,
    description: string,
    readOnly: boolean,
    schema: z.ZodObject<z.ZodRawShape>,
    call: (args: Record<string, unknown>) => Promise<unknown>,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema.shape,
        annotations: {
          readOnlyHint: readOnly,
          destructiveHint: !readOnly,
          idempotentHint: readOnly,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await call(args ?? {});
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
  };

  for (const spec of specs) {
    register(spec.name, spec.description, spec.readOnly, spec.schema, (args) =>
      options.client.request(spec, args),
    );
  }
  for (const tool of composites) {
    register(tool.name, tool.description, tool.readOnly, tool.schema, (args) =>
      tool.handler(options.client, args),
    );
  }

  return server;
}
