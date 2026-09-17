import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One GitVerse API operation turned into an MCP tool.
 * `schema` validates the flattened tool arguments: path params, query params and
 * (for request-body operations) body fields all live on the top level.
 */
export interface ToolSpec {
  name: string;
  description: string;
  method: HttpMethod;
  /** Path template with `{param}` placeholders, e.g. `/repos/{owner}/{repo}/commits`. */
  path: string;
  tags: string[];
  readOnly: boolean;
  /** The operation uploads a file attachment via multipart/form-data. */
  fileUpload: boolean;
  /**
   * Mapping of top-level tool arguments that travel in the JSON request body:
   * `[toolArgName, bodyKey]` pairs. They usually match 1:1; a `body_` prefix
   * appears when a body property would collide with a path/query argument.
   */
  bodyFields: ReadonlyArray<readonly [string, string]>;
  schema: z.ZodObject<z.ZodRawShape>;
}

export interface SpecInfo {
  apiVersion: string;
  operationCount: number;
}
