import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GitVerseClient } from './client.js';
import { toolSpecs } from './generated/tools.js';
import type { ToolSpec } from './types.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface ServerOptions {
  client: GitVerseClient;
  /** Allowlist of tool names; all tools when omitted. */
  include?: readonly string[];
  /** Denylist of tool names, applied after `include`. */
  exclude?: readonly string[];
}

export function filterTools(specs: readonly ToolSpec[], options: ServerOptions): ToolSpec[] {
  const include = options.include ? new Set(options.include) : undefined;
  const exclude = options.exclude ? new Set(options.exclude) : undefined;
  return specs.filter((spec) => {
    if (include && !include.has(spec.name)) return false;
    if (exclude?.has(spec.name)) return false;
    return true;
  });
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
