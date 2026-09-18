#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { GitVerseClient } from './client.js';
import { createGitVerseServer } from './server.js';

async function main(): Promise<void> {
  const token = process.env['GITVERSE_TOKEN'];
  if (!token) {
    console.error('gitverse-mcp-server: GITVERSE_TOKEN is not set — API calls will fail with 401');
  }

  const client = new GitVerseClient({
    token,
    baseUrl: process.env['GITVERSE_BASE_URL'],
    apiVersion: process.env['GITVERSE_API_VERSION'],
  });

  const server = createGitVerseServer({ client });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('gitverse-mcp-server: connected over stdio');
}

main().catch((error: unknown) => {
  console.error('gitverse-mcp-server: fatal:', error instanceof Error ? error.message : error);
  process.exit(1);
});
