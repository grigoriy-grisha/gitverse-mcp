/**
 * Downloads the official GitVerse public API OpenAPI specification into spec/openapi.json.
 *
 * The spec lives in the public repo gitverse/rest-api-description on gitverse.ru.
 * The contents endpoint returns either a raw JSON document or a base64 envelope
 * depending on the gateway mood — both are handled here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const specVersion = process.argv[2] ?? '1.10';
const specUrl = `https://gitverse.ru/sbt/api/v1/repos/gitverse/rest-api-description/contents/v1/openapi-${specVersion}.json`;
const acceptHeader = 'application/vnd.gitverse.object+json; version=1';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface SwaggerSpec {
  swagger: string;
  info: { version: string };
  paths: Record<string, Record<string, unknown>>;
}

interface ContentsEnvelope {
  encoding?: string;
  content?: string;
  size?: number;
}

function isSwaggerSpec(value: unknown): value is SwaggerSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    'swagger' in value &&
    'paths' in value &&
    typeof (value as SwaggerSpec).paths === 'object'
  );
}

async function main(): Promise<void> {
  const res = await fetch(specUrl, { headers: { Accept: acceptHeader } });
  if (!res.ok) {
    throw new Error(`Failed to download spec: HTTP ${res.status} ${res.statusText}`);
  }
  const payload: unknown = await res.json();

  let spec: SwaggerSpec;
  const envelope = payload as ContentsEnvelope;
  if (envelope && envelope.encoding === 'base64' && typeof envelope.content === 'string') {
    spec = JSON.parse(Buffer.from(envelope.content, 'base64').toString('utf8')) as SwaggerSpec;
  } else if (isSwaggerSpec(payload)) {
    spec = payload;
  } else {
    const keys = payload && typeof payload === 'object' ? Object.keys(payload).join(', ') : typeof payload;
    throw new Error(`Unrecognized payload shape, keys: ${keys}`);
  }

  if (!isSwaggerSpec(spec)) {
    throw new Error('Downloaded document is not a Swagger/OpenAPI spec');
  }

  const outPath = join(root, 'spec', 'openapi.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');

  const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];
  const operations = Object.values(spec.paths).reduce(
    (n, item) => n + Object.keys(item).filter((m) => httpMethods.includes(m)).length,
    0,
  );
  console.log(
    `spec ${spec.info.version} written to spec/openapi.json: ${Object.keys(spec.paths).length} paths, ${operations} operations`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
