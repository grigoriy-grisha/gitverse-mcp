/**
 * Generates src/generated/tools.ts from spec/openapi.json.
 *
 * The official GitVerse spec is Swagger 2.0 without operationIds, so tool names are
 * derived from METHOD + path. Request bodies are flattened: body properties become
 * top-level tool arguments, and `bodyFields` records which ones travel back in the
 * JSON body. File-upload operations (formData) take `attachment_path` or
 * `attachment_base64` instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface Param {
  name: string;
  in: 'path' | 'query' | 'formData' | 'body' | 'header';
  type?: string;
  description?: string;
  required?: boolean;
  enum?: unknown[];
  default?: unknown;
  schema?: SchemaObject;
  collectionFormat?: string;
}

interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  $ref?: string;
  enum?: unknown[];
  default?: unknown;
  additionalProperties?: boolean | SchemaObject;
  allOf?: SchemaObject[];
}

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Param[];
  responses?: Record<string, { description?: string; schema?: SchemaObject }>;
}

interface Spec {
  swagger: string;
  info: { version: string };
  paths: Record<string, Record<string, Operation | unknown>>;
  definitions: Record<string, SchemaObject>;
}

function isOperation(value: unknown): value is Operation {
  return typeof value === 'object' && value !== null && ('responses' in value || 'parameters' in value || 'summary' in value);
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function baseName(method: HttpMethod, path: string): string {
  const withoutParams = path.replace(/\{[^}]+\}/g, '');
  const cleaned = withoutParams
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return `${method.toLowerCase()}_${cleaned}`;
}

function lastPathParam(path: string): string {
  const matches = [...path.matchAll(/\{([^}]+)\}/g)];
  const name = matches.at(-1)?.[1] ?? 'item';
  return name.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
}

/** Resolves list-vs-item name collisions (e.g. /branches and /branches/{branch}). */
function assignNames(
  ops: Array<{ method: HttpMethod; path: string }>,
): Map<number, string> {
  const groups = new Map<string, number[]>();
  ops.forEach((op, index) => {
    const base = baseName(op.method, op.path);
    const group = groups.get(base) ?? [];
    group.push(index);
    groups.set(base, group);
  });

  const names = new Map<number, string>();
  for (const [base, indices] of groups) {
    const sorted = [...indices].sort((a, b) => {
      const pa = ops[a].path;
      const pb = ops[b].path;
      if (pa.length !== pb.length) return pa.length - pb.length;
      return pa < pb ? -1 : pa > pb ? 1 : 0;
    });
    sorted.forEach((index, position) => {
      let name = position === 0 ? base : `${base}_${lastPathParam(ops[index].path)}`;
      while ([...names.values()].includes(name)) {
        name = `${name}_${position + 1}`;
      }
      names.set(index, name);
    });
  }
  return names;
}

// ---------------------------------------------------------------------------
// Zod expression building
// ---------------------------------------------------------------------------

class ZodEmitter {
  constructor(private readonly definitions: Record<string, SchemaObject>) {}

  schemaExpression(schema: SchemaObject, depth = 0): string {
    let expr: string;

    if (schema.$ref) {
      const refName = schema.$ref.replace(/^#\/definitions\//, '');
      const def = this.definitions[refName];
      if (!def || depth >= 4) {
        expr = `z.unknown().describe(${JSON.stringify(refName)})`;
      } else {
        expr = this.objectExpression(def, depth + 1);
      }
    } else if (schema.allOf?.length) {
      const first = schema.allOf[0] ?? {};
      expr = this.schemaExpression(first, depth);
    } else {
      switch (schema.type) {
        case 'string':
          expr =
            schema.enum && schema.enum.length > 0
              ? `z.enum(${JSON.stringify(schema.enum.map(String))})`
              : 'z.string()';
          break;
        case 'integer':
          expr = 'z.number().int()';
          break;
        case 'number':
          expr = 'z.number()';
          break;
        case 'boolean':
          expr = 'z.boolean()';
          break;
        case 'array':
          expr = `z.array(${this.schemaExpression(schema.items ?? {}, depth + 1)})`;
          break;
        case 'object': {
          if (schema.properties && Object.keys(schema.properties).length > 0) {
            expr = this.objectExpression(schema, depth);
          } else {
            expr = 'z.record(z.unknown())';
          }
          break;
        }
        default:
          expr = 'z.unknown()';
      }
    }

    if (schema.enum && schema.type !== 'string') {
      expr = `z.enum(${JSON.stringify(schema.enum.map(String))})`;
    }
    if (schema.description) {
      expr += `.describe(${JSON.stringify(schema.description)})`;
    }
    if (schema.default !== undefined) {
      expr += `.default(${JSON.stringify(schema.default)})`;
    }
    return expr;
  }

  private objectExpression(schema: SchemaObject, depth: number): string {
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(props).map(([name, propSchema]) => {
      let expr = this.schemaExpression(propSchema, depth);
      if (!required.has(name)) expr += '.optional()';
      return `${JSON.stringify(name)}: ${expr}`;
    });
    if (entries.length === 0) return 'z.record(z.unknown())';
    return `z.object({ ${entries.join(', ')} })`;
  }
}

function paramExpression(param: Param, emitter: ZodEmitter): string {
  let expr = emitter.schemaExpression(
    {
      type: param.type,
      enum: param.enum,
      default: param.default,
      description: param.description,
    },
    0,
  );
  if (!param.required) expr += '.optional()';
  return expr;
}

// ---------------------------------------------------------------------------
// Description building
// ---------------------------------------------------------------------------

function buildDescription(method: HttpMethod, path: string, op: Operation): string {
  const parts: string[] = [];
  const tag = op.tags?.[0];
  parts.push(`[${method} ${path}]${tag ? ` (${tag})` : ''}`);
  if (op.summary) parts.push(op.summary);
  if (op.description && op.description !== op.summary) parts.push(op.description);

  const successCode = Object.keys(op.responses ?? {}).find((code) => code.startsWith('2'));
  const successSchema = successCode !== undefined ? op.responses?.[successCode]?.schema : undefined;
  if (successSchema) {
    const ref = successSchema.$ref ?? successSchema.allOf?.[0]?.$ref ?? successSchema.items?.$ref;
    if (ref) {
      const refName = ref.replace(/^#\/definitions\//, '');
      parts.push(`Returns ${successCode}: ${refName}`);
    }
  }

  const description = parts.join('\n');
  return description.length > 1200 ? description.slice(0, 1197) + '...' : description;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const specPath = join(root, 'spec', 'openapi.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Spec;
  const emitter = new ZodEmitter(spec.definitions);

  interface Flat {
    method: HttpMethod;
    path: string;
    op: Operation;
    name: string;
    pathParams: Param[];
    queryParams: Param[];
    bodyParam: Param | null;
    fileUpload: boolean;
  }

  const flats: Flat[] = [];
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!isOperation(op)) continue;
      const params = op.parameters ?? [];
      flats.push({
        method,
        path,
        op,
        name: '',
        pathParams: params.filter((p) => p.in === 'path'),
        queryParams: params.filter((p) => p.in === 'query'),
        bodyParam: params.find((p) => p.in === 'body') ?? null,
        fileUpload: params.some((p) => p.in === 'formData' && p.type === 'file'),
      });
    }
  }

  const names = assignNames(flats.map((f) => ({ method: f.method, path: f.path })));
  flats.forEach((flat, index) => {
    flat.name = names.get(index) ?? '';
    if (!flat.name || flat.name.length > 64) {
      throw new Error(`Bad tool name for ${flat.method} ${flat.path}: '${flat.name}'`);
    }
  });

  // Body flattening must not collide with path/query argument names —
  // colliding body properties get a `body_` prefix instead.
  for (const flat of flats) {
    if (!flat.bodyParam) continue;
    buildBodyArgsMapping(flat.bodyParam, flat.pathParams, flat.queryParams, spec.definitions);
  }

  const chunks = flats.map((flat) => {
    const lines: string[] = [];
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(flat.name)},`);
    lines.push(`    description: ${JSON.stringify(buildDescription(flat.method, flat.path, flat.op))},`);
    lines.push(`    method: ${JSON.stringify(flat.method.toUpperCase())},`);
    lines.push(`    path: ${JSON.stringify(flat.path)},`);
    lines.push(`    tags: ${JSON.stringify(flat.op.tags ?? [])},`);
    lines.push(`    readOnly: ${flat.method === 'get' ? 'true' : 'false'},`);
    lines.push(`    fileUpload: ${flat.fileUpload ? 'true' : 'false'},`);

    const bodyFields =
      flat.bodyParam && !flat.fileUpload
        ? buildBodyArgsMapping(flat.bodyParam, flat.pathParams, flat.queryParams, spec.definitions)
        : [];
    lines.push(`    bodyFields: ${JSON.stringify(bodyFields)},`);

    if (flat.fileUpload) {
      lines.push(
        `    schema: z.object({ ${[
          ...flat.pathParams.map((p) => `${JSON.stringify(p.name)}: ${paramExpression(p, emitter)}`),
          ...flat.queryParams.map((p) => `${JSON.stringify(p.name)}: ${paramExpression(p, emitter)}`),
          `"attachment_path": z.string().describe(${JSON.stringify('Path to a local file to upload (either this or attachment_base64)')}).optional()`,
          `"attachment_base64": z.string().describe(${JSON.stringify('File content as base64 (use this or attachment_path)')}).optional()`,
          `"filename": z.string().describe(${JSON.stringify('File name for the upload (defaults to basename of attachment_path)')}).optional()`,
        ].join(', ')} }),`,
      );
    } else {
      const entries = [
        ...flat.pathParams.map((p) => `${JSON.stringify(p.name)}: ${paramExpression(p, emitter)}`),
        ...flat.queryParams.map((p) => `${JSON.stringify(p.name)}: ${paramExpression(p, emitter)}`),
      ];
      if (flat.bodyParam) {
        entries.push(...bodyArgEntries(flat.bodyParam, flat.pathParams, flat.queryParams, spec.definitions, emitter));
      }
      lines.push(`    schema: z.object({ ${entries.join(', ')} }),`);
    }

    lines.push('  }');
    return lines.join('\n');
  });

  const out = `// GENERATED FILE — do not edit manually.
// Source: spec/openapi.json (GitVerse Public API ${spec.info.version}).
// Regenerate with: npm run generate

import { z } from 'zod';

import type { SpecInfo, ToolSpec } from '../types.js';

export const specInfo: SpecInfo = {
  apiVersion: ${JSON.stringify(spec.info.version)},
  operationCount: ${flats.length},
};

export const toolSpecs: ToolSpec[] = [
${chunks.join(',\n')},
];
`;

  const outPath = join(root, 'src', 'generated', 'tools.ts');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, out);
  console.log(`generated ${flats.length} tools -> src/generated/tools.ts`);
}

/** Property names of the request-body object (or ['body'] when it is a free-form value). */
function flattenBodyProps(bodyParam: Param, definitions: Record<string, SchemaObject>): string[] {
  const schema = bodyParam.schema ?? {};
  const ref = schema.$ref?.replace(/^#\/definitions\//, '');
  const def = ref !== undefined ? definitions[ref] : schema;
  const props = def?.properties;
  if (!props) return ['body'];
  return Object.keys(props);
}

/**
 * Builds `[toolArgName, bodyKey]` pairs for a request body. Body properties whose
 * names clash with path/query arguments are exposed as `body_<name>` tool arguments
 * while still mapping back to the original body key.
 */
function buildBodyArgsMapping(
  bodyParam: Param,
  pathParams: Param[],
  queryParams: Param[],
  definitions: Record<string, SchemaObject>,
): Array<[string, string]> {
  const reserved = new Set([...pathParams, ...queryParams].map((p) => p.name));
  return flattenBodyProps(bodyParam, definitions).map((prop) => [
    reserved.has(prop) ? `body_${prop}` : prop,
    prop,
  ]);
}

/** Zod entries for a flattened body: one argument per body property. */
function bodyArgEntries(
  bodyParam: Param,
  pathParams: Param[],
  queryParams: Param[],
  definitions: Record<string, SchemaObject>,
  emitter: ZodEmitter,
): string[] {
  const schema = bodyParam.schema ?? {};
  const ref = schema.$ref?.replace(/^#\/definitions\//, '');
  const def = ref !== undefined ? definitions[ref] : schema;
  const props = def?.properties;
  if (!props) {
    return [`"body": z.unknown().describe(${JSON.stringify(bodyParam.description ?? 'Request body')})${bodyParam.required ? '' : '.optional()'}`];
  }
  const required = new Set(def?.required ?? []);
  return buildBodyArgsMapping(bodyParam, pathParams, queryParams, definitions).map(
    ([argName, bodyKey]) => {
      let expr = emitter.schemaExpression(props[bodyKey] ?? {}, 1);
      if (!required.has(bodyKey)) expr += '.optional()';
      return `${JSON.stringify(argName)}: ${expr}`;
    },
  );
}

main();
