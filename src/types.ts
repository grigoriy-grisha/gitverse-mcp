import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ToolSpec {
  name: string;
  description: string;
  method: HttpMethod;
  path: string;
  tags: string[];
  readOnly: boolean;
  fileUpload: boolean;
  bodyFields: ReadonlyArray<readonly [string, string]>;
  schema: z.ZodObject<z.ZodRawShape>;
}

export interface SpecInfo {
  apiVersion: string;
  operationCount: number;
}
