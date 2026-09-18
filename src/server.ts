import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GitVerseClient } from './client.js';
import { compositeTools } from './composite.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface ServerOptions {
  client: GitVerseClient;
}

export function createGitVerseServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of compositeTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          idempotentHint: tool.readOnly,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(options.client, args ?? {});
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
