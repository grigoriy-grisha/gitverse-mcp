import { z } from 'zod';

import type { GitVerseClient } from './client.js';

export interface CompositeTool {
  name: string;
  description: string;
  readOnly: boolean;
  schema: z.ZodObject<z.ZodRawShape>;
  handler: (client: GitVerseClient, args: Record<string, unknown>) => Promise<unknown>;
}

type Args = Record<string, unknown>;

const str = (description: string) => z.string().describe(description);
const strOpt = (description: string) => z.string().describe(description).optional();
const num = (description: string) => z.number().int().describe(description);
const numOpt = (description: string) => z.number().int().describe(description).optional();

const repoArgs = {
  owner: str('Repository owner'),
  repo: str('Repository name'),
};
const prArg = { pull_number: num('Pull request number') };
const pageArgs = {
  page: numOpt('1-based page number'),
  per_page: numOpt('Items per page'),
};

function asRecord(value: unknown): Args {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Unexpected API response: expected object');
  }
  return value as Args;
}

function asArray(value: unknown): Args[] {
  if (!Array.isArray(value)) throw new Error('Unexpected API response: expected array');
  return value.filter((item): item is Args => typeof item === 'object' && item !== null);
}

function pick(args: Args, key: string): unknown {
  const value = args[key];
  return value === undefined ? undefined : value;
}

function prune(body: Args): Args {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

async function getMyLogin(client: GitVerseClient): Promise<string> {
  const user = asRecord(await client.requestRaw({ method: 'GET', path: '/user' }));
  const login = user['login'];
  if (typeof login !== 'string' || login.length === 0) {
    throw new Error('Cannot resolve authenticated user login');
  }
  return login;
}

const prPath = (args: Args, suffix = '') =>
  `/repos/${args['owner']}/${args['repo']}/pulls/${args['pull_number']}${suffix}`;
const issueCommentsPath = (args: Args) =>
  `/repos/${args['owner']}/${args['repo']}/issues/${args['pull_number']}/comments`;

export const compositeTools: CompositeTool[] = [
  {
    name: 'listRepositories',
    description:
      'List repositories. Without arguments lists the authenticated user\'s repositories; pass org to list organization repositories. Supports page/per_page.',
    readOnly: true,
    schema: z.object({
      org: strOpt('Organization name to list its repositories instead of own'),
      ...pageArgs,
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: typeof args['org'] === 'string' ? `/orgs/${args['org']}/repos` : '/user/repos',
        query: { page: pick(args, 'page'), per_page: pick(args, 'per_page') },
      }),
  },
  {
    name: 'getRepository',
    description: 'Get details of a specific repository.',
    readOnly: true,
    schema: z.object({ ...repoArgs }),
    handler: async (client, args) =>
      client.requestRaw({ method: 'GET', path: `/repos/${args['owner']}/${args['repo']}` }),
  },
  {
    name: 'getPullRequests',
    description:
      'List pull requests of a repository. state filters by open/closed. Supports page/per_page.',
    readOnly: true,
    schema: z.object({
      ...repoArgs,
      state: z.enum(['open', 'closed']).optional().describe('Filter by PR state'),
      ...pageArgs,
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/pulls`,
        query: prune({ state: pick(args, 'state'), page: pick(args, 'page'), per_page: pick(args, 'per_page') }),
      }),
  },
  {
    name: 'createPullRequest',
    description:
      'Create a pull request from head to base. GitVerse has no reviewer requests — use assignees instead. Pass draft=true to create a draft.',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      title: str('PR title'),
      head: str('Source branch name'),
      base: str('Target branch name'),
      body: strOpt('PR description (markdown)'),
      draft: z.boolean().optional().describe('Create as draft'),
      assignees: z.array(z.string()).optional().describe('Usernames to assign'),
      labels: z.array(z.string()).optional().describe('Label names'),
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'POST',
        path: `/repos/${args['owner']}/${args['repo']}/pulls`,
        body: prune({
          title: pick(args, 'title'),
          head: pick(args, 'head'),
          base: pick(args, 'base'),
          body: pick(args, 'body'),
          draft: pick(args, 'draft'),
          assignees: pick(args, 'assignees'),
          labels: pick(args, 'labels'),
        }),
      }),
  },
  {
    name: 'getPullRequest',
    description: 'Get details of a specific pull request.',
    readOnly: true,
    schema: z.object({ ...repoArgs, ...prArg }),
    handler: async (client, args) => client.requestRaw({ method: 'GET', path: prPath(args) }),
  },
  {
    name: 'updatePullRequest',
    description:
      'Update a pull request: title, body, state (open|closed), base branch. assignees and labels are applied through the issue endpoint because a PR is an issue in GitVerse.',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      ...prArg,
      title: strOpt('New PR title'),
      body: strOpt('New PR description'),
      state: z.enum(['open', 'closed']).optional().describe('New PR state'),
      base: strOpt('New target branch'),
      assignees: z.array(z.string()).optional().describe('Replace assignees'),
      labels: z.array(z.string()).optional().describe('Replace labels'),
    }),
    handler: async (client, args) => {
      const prFields = prune({
        title: pick(args, 'title'),
        body: pick(args, 'body'),
        state: pick(args, 'state'),
        base: pick(args, 'base'),
      });
      const issueFields = prune({
        assignees: pick(args, 'assignees'),
        labels: pick(args, 'labels'),
      });
      if (Object.keys(prFields).length > 0) {
        await client.requestRaw({ method: 'PATCH', path: prPath(args), body: prFields });
      }
      if (Object.keys(issueFields).length > 0) {
        await client.requestRaw({
          method: 'PATCH',
          path: `/repos/${args['owner']}/${args['repo']}/issues/${args['pull_number']}`,
          body: issueFields,
        });
      }
      return client.requestRaw({ method: 'GET', path: prPath(args) });
    },
  },
  {
    name: 'getPullRequestActivity',
    description: 'Get the activity/timeline of a pull request.',
    readOnly: true,
    schema: z.object({ ...repoArgs, ...prArg }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/issues/${args['pull_number']}/timeline`,
      }),
  },
  {
    name: 'approvePullRequest',
    description: 'Approve a pull request by submitting an APPROVED review.',
    readOnly: false,
    schema: z.object({ ...repoArgs, ...prArg, body: strOpt('Approval comment') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'POST',
        path: prPath(args, '/reviews'),
        body: prune({ event: 'APPROVED', body: pick(args, 'body') }),
      }),
  },
  {
    name: 'unapprovePullRequest',
    description:
      'Remove your approval: finds your latest APPROVED review on the pull request and deletes it.',
    readOnly: false,
    schema: z.object({ ...repoArgs, ...prArg }),
    handler: async (client, args) => {
      const login = await getMyLogin(client);
      const reviews = asArray(
        await client.requestRaw({ method: 'GET', path: prPath(args, '/reviews') }),
      );
      const mine = reviews.find(
        (review) =>
          review['state'] === 'APPROVED' &&
          asRecord(review['user'] ?? {})['login'] === login,
      );
      const id = mine?.['id'];
      if (typeof id !== 'number' && typeof id !== 'string') {
        throw new Error(`No APPROVED review by '${login}' found on this pull request`);
      }
      return client.requestRaw({ method: 'DELETE', path: prPath(args, `/reviews/${id}`) });
    },
  },
  {
    name: 'declinePullRequest',
    description:
      'Decline (close) a pull request. An optional message is posted to the discussion before closing.',
    readOnly: false,
    schema: z.object({ ...repoArgs, ...prArg, message: strOpt('Reason for declining') }),
    handler: async (client, args) => {
      const message = pick(args, 'message');
      if (typeof message === 'string' && message.length > 0) {
        await client.requestRaw({
          method: 'POST',
          path: issueCommentsPath(args),
          body: { body: message },
        });
      }
      return client.requestRaw({
        method: 'PATCH',
        path: prPath(args),
        body: { state: 'closed' },
      });
    },
  },
  {
    name: 'requestChanges',
    description: 'Request changes on a pull request by submitting a REQUEST_CHANGES review.',
    readOnly: false,
    schema: z.object({ ...repoArgs, ...prArg, body: strOpt('What should be changed') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'POST',
        path: prPath(args, '/reviews'),
        body: prune({ event: 'REQUEST_CHANGES', body: pick(args, 'body') }),
      }),
  },
  {
    name: 'removeChangeRequest',
    description:
      'Remove your change request by superseding it with an APPROVED review (GitVerse has no dedicated un-request endpoint).',
    readOnly: false,
    schema: z.object({ ...repoArgs, ...prArg, body: strOpt('Optional comment') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'POST',
        path: prPath(args, '/reviews'),
        body: prune({ event: 'APPROVED', body: pick(args, 'body') }),
      }),
  },
  {
    name: 'createDraftPullRequest',
    description: 'Create a draft pull request (equivalent to createPullRequest with draft=true).',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      title: str('PR title'),
      head: str('Source branch name'),
      base: str('Target branch name'),
      body: strOpt('PR description (markdown)'),
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'POST',
        path: `/repos/${args['owner']}/${args['repo']}/pulls`,
        body: prune({
          title: pick(args, 'title'),
          head: pick(args, 'head'),
          base: pick(args, 'base'),
          body: pick(args, 'body'),
          draft: true,
        }),
      }),
  },
  {
    name: 'getPullRequestComments',
    description: 'List discussion comments on a pull request. Supports since/before filters.',
    readOnly: true,
    schema: z.object({
      ...repoArgs,
      ...prArg,
      since: strOpt('Only comments created after this ISO timestamp'),
      before: strOpt('Only comments created before this ISO timestamp'),
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: issueCommentsPath(args),
        query: { since: pick(args, 'since'), before: pick(args, 'before') },
      }),
  },
  {
    name: 'addPullRequestComment',
    description:
      'Comment on a pull request. Without inline — a general discussion comment. With inline {path, to} — an inline review comment on line `to` of the diff (commit SHA is resolved automatically). Replying: pass reply_to with a comment id.',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      ...prArg,
      content: str('Comment content (markdown)'),
      inline: z
        .object({
          path: str('File path in the diff'),
          to: num('Line number in the NEW version'),
        })
        .optional()
        .describe('Make it an inline diff comment'),
      reply_to: numOpt('Comment id to reply to (general comments only)'),
    }),
    handler: async (client, args) => {
      const inline = args['inline'] as Args | undefined;
      if (inline) {
        const pull = asRecord(await client.requestRaw({ method: 'GET', path: prPath(args) }));
        const head = asRecord(pull['head'] ?? {});
        const sha = head['sha'];
        if (typeof sha !== 'string' || sha.length === 0) {
          throw new Error('Cannot resolve head commit SHA of the pull request');
        }
        return client.requestRaw({
          method: 'POST',
          path: prPath(args, '/comments'),
          body: prune({
            body: pick(args, 'content'),
            commit_id: sha,
            path: inline['path'],
            line: inline['to'],
          }),
        });
      }
      return client.requestRaw({
        method: 'POST',
        path: issueCommentsPath(args),
        body: prune({ body: pick(args, 'content'), reply_to: pick(args, 'reply_to') }),
      });
    },
  },
  {
    name: 'updatePullRequestComment',
    description: 'Edit a discussion comment on a pull request.',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      ...prArg,
      comment_id: num('Comment id'),
      content: str('New comment content'),
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'PATCH',
        path: `${issueCommentsPath(args)}/${args['comment_id']}`,
        body: { body: pick(args, 'content') },
      }),
  },
  {
    name: 'deletePullRequestComment',
    description: 'Delete a discussion comment on a pull request.',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      ...prArg,
      comment_id: num('Comment id'),
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'DELETE',
        path: `${issueCommentsPath(args)}/${args['comment_id']}`,
      }),
  },
  {
    name: 'getPullRequestDiff',
    description: 'Get the changed files of a pull request, including per-file patches.',
    readOnly: true,
    schema: z.object({ ...repoArgs, ...prArg }),
    handler: async (client, args) =>
      client.requestRaw({ method: 'GET', path: prPath(args, '/files') }),
  },
  {
    name: 'getPullRequestCommits',
    description: 'List the commits of a pull request. Supports page/per_page.',
    readOnly: true,
    schema: z.object({ ...repoArgs, ...prArg, ...pageArgs }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: prPath(args, '/commits'),
        query: { page: pick(args, 'page'), per_page: pick(args, 'per_page') },
      }),
  },
  {
    name: 'listPipelineRuns',
    description:
      'List CI runs (GitVerse Actions, Bitbucket Pipelines analog). Filters: status, branch, event. Supports page/per_page.',
    readOnly: true,
    schema: z.object({
      ...repoArgs,
      status: z
        .enum(['queued', 'in_progress', 'success', 'failure', 'cancelled', 'unknown'])
        .optional()
        .describe('Filter by run status'),
      branch: strOpt('Filter by branch'),
      event: strOpt('Filter by trigger event'),
      ...pageArgs,
    }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/actions/runs`,
        query: prune({
          status: pick(args, 'status'),
          branch: pick(args, 'branch'),
          event: pick(args, 'event'),
          page: pick(args, 'page'),
          per_page: pick(args, 'per_page'),
        }),
      }),
  },
  {
    name: 'getPipelineRun',
    description: 'Get details of a CI run.',
    readOnly: true,
    schema: z.object({ ...repoArgs, run_id: num('CI run id') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/actions/runs/${args['run_id']}`,
      }),
  },
  {
    name: 'runPipeline',
    description: 'Trigger a CI run of a workflow on a branch or tag.',
    readOnly: false,
    schema: z.object({
      ...repoArgs,
      workflow: str('Workflow file name or id'),
      ref_type: z.enum(['branch', 'tag']).describe('What ref_name refers to'),
      ref_name: str('Branch or tag name'),
      inputs: z.record(z.string()).optional().describe('Workflow inputs (string values)'),
    }),
    handler: async (client, args) => {
      const queryKey = args['ref_type'] === 'tag' ? 'tag' : 'branch';
      return client.requestRaw({
        method: 'POST',
        path: `/repos/${args['owner']}/${args['repo']}/actions/workflows/${args['workflow']}/dispatches`,
        query: { [queryKey]: pick(args, 'ref_name') },
        body: pick(args, 'inputs') ?? {},
      });
    },
  },
  {
    name: 'getPipelineSteps',
    description: 'List jobs (steps) of a CI run.',
    readOnly: true,
    schema: z.object({ ...repoArgs, run_id: num('CI run id') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/actions/runs/${args['run_id']}/jobs`,
      }),
  },
  {
    name: 'getPipelineStep',
    description: 'Get details of a CI job (step).',
    readOnly: true,
    schema: z.object({ ...repoArgs, job_id: num('CI job id') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/actions/jobs/${args['job_id']}`,
      }),
  },
  {
    name: 'getPipelineStepLogs',
    description: 'Get logs of a CI job (step).',
    readOnly: true,
    schema: z.object({ ...repoArgs, job_id: num('CI job id') }),
    handler: async (client, args) =>
      client.requestRaw({
        method: 'GET',
        path: `/repos/${args['owner']}/${args['repo']}/actions/jobs/${args['job_id']}/logs`,
      }),
  },
];

export const compositeToolNames = compositeTools.map((tool) => tool.name);
