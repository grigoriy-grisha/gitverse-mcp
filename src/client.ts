import type { HttpMethod } from './types.js';

export class GitVerseApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body?: string;

  constructor(status: number, code: string, message: string, body?: string) {
    super(`GitVerse API error ${status} ${code}: ${message}`);
    this.name = 'GitVerseApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface GitVerseClientOptions {
  token?: string;
  baseUrl?: string;
  apiVersion?: string;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RawRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export class GitVerseClient {
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly maxRetries: number;
  private readonly maxRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GitVerseClientOptions = {}) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? 'https://api.gitverse.ru').replace(/\/+$/, '');
    this.apiVersion = options.apiVersion ?? '1';
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async requestRaw(params: RawRequest): Promise<unknown> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params.query ?? {})) {
      if (value === undefined) continue;
      query.set(name, encodeQueryValue(value));
    }
    const url = `${this.baseUrl}${params.path}${query.size > 0 ? `?${query}` : ''}`;

    const init: RequestInit = { method: params.method, headers: this.baseHeaders() };
    if (params.body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(params.body);
    }
    return this.send(url, init);
  }

  private baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: `application/vnd.gitverse.object+json; version=${this.apiVersion}`,
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  private async send(url: string, init: RequestInit, attempt = 0): Promise<unknown> {
    const res = await this.fetchImpl(url, init);

    if (res.status === 429 && attempt < this.maxRetries) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '1');
      const delayMs = Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000, this.maxRetryDelayMs);
      await sleep(delayMs);
      return this.send(url, init, attempt + 1);
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      const { code, message } = parseErrorBody(raw);
      throw new GitVerseApiError(res.status, code ?? String(res.status), message ?? res.statusText, raw || undefined);
    }

    if (res.status === 204) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
}

function encodeQueryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(',');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

function parseErrorBody(raw: string): { code?: string; message?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string }; message?: string };
    if (parsed.error && typeof parsed.error === 'object') {
      return { code: parsed.error.code, message: parsed.error.message };
    }
    if (typeof parsed.message === 'string') return { message: parsed.message };
    return {};
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
