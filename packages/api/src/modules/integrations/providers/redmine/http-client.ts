import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, request as undiciRequest, type Dispatcher } from "undici";

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

export interface SafeEndpoint {
  readonly url: string;
  readonly hostname: string;
  readonly address: string;
  readonly family: 4 | 6;
}

type ResolveHostname = (hostname: string) => Promise<readonly LookupAddress[]>;

interface ResolveSafeEndpointOptions {
  endpointAllowlist?: Readonly<Record<string, readonly string[]>>;
  resolve?: ResolveHostname;
}

const resolveHostname: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function unsafe(reason: string): Error {
  return new Error(`Unsafe remote endpoint: ${reason}`);
}

function normalizeHostname(hostname: string): string {
  const unbracketed = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function allowedAddresses(
  url: URL,
  allowlist: ResolveSafeEndpointOptions["endpointAllowlist"],
): readonly string[] | undefined {
  return allowlist && Object.hasOwn(allowlist, url.origin) ? allowlist[url.origin] : undefined;
}

function requireAllowedAddress(
  address: string,
  allowed: readonly string[] | undefined,
): { address: string; family: 4 | 6 } {
  const candidate = normalizeHostname(address);
  const family = isIP(candidate);
  const normalized = family === 6
    ? new URL(`http://[${candidate}]`).hostname.slice(1, -1)
    : candidate;
  if (
    (family !== 4 && family !== 6) ||
    normalized.startsWith("::ffff:") ||
    (allowed
      ? !allowed.includes(normalized)
      : blockedAddresses.check(normalized, family === 4 ? "ipv4" : "ipv6"))
  ) {
    throw unsafe(allowed ? "address is not allowed for origin" : "address is not publicly routable");
  }
  return { address: normalized, family };
}

export async function resolveSafeEndpoint(
  input: string | URL,
  options: ResolveSafeEndpointOptions = {},
): Promise<SafeEndpoint> {
  let url: URL;
  try {
    url = new URL(input.toString());
  } catch {
    throw unsafe("invalid URL");
  }

  if (url.username || url.password) throw unsafe("URL credentials are forbidden");
  const allowed = allowedAddresses(url, options.endpointAllowlist);
  if (url.protocol !== "https:" && !(allowed && url.protocol === "http:")) {
    throw unsafe("HTTPS is required");
  }

  const hostname = normalizeHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const answers = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await (options.resolve ?? resolveHostname)(hostname);
  if (answers.length === 0) throw unsafe("hostname did not resolve");

  const vetted = answers.map((answer) => requireAllowedAddress(answer.address, allowed));
  const selected = vetted[0]!;
  return Object.freeze({
    url: url.href,
    hostname,
    address: selected.address,
    family: selected.family,
  });
}

export function createPinnedLookup(
  endpoint: SafeEndpoint,
  endpointAllowlist?: ResolveSafeEndpointOptions["endpointAllowlist"],
): LookupFunction {
  const vetted = requireAllowedAddress(
    endpoint.address,
    allowedAddresses(new URL(endpoint.url), endpointAllowlist),
  );
  const hostname = normalizeHostname(endpoint.hostname);
  if (vetted.family !== endpoint.family) throw unsafe("address family mismatch");

  return (requestedHostname, options, callback) => {
    if (normalizeHostname(requestedHostname) !== hostname) {
      callback(unsafe("hostname does not match vetted endpoint"), "");
      return;
    }
    if (options.all) {
      callback(null, [vetted]);
      return;
    }
    callback(null, vetted.address, vetted.family);
  };
}

interface TransportOptions {
  method: Dispatcher.HttpMethod;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  dispatcher: Dispatcher;
  maxRedirections: number;
  headersTimeout: number;
  bodyTimeout: number;
}

type Transport = (
  url: string,
  options: TransportOptions,
) => Promise<{ statusCode: number; body: { text(): Promise<string> } }>;

interface RedmineHttpClientOptions {
  endpointAllowlist?: Readonly<Record<string, readonly string[]>>;
  timeoutMs?: number;
  maxAttempts?: number;
  resolve?: ResolveHostname;
  transport?: Transport;
  sleep?: (milliseconds: number) => Promise<unknown> | unknown;
}

const defaultTransport: Transport = (url, options) => undiciRequest(url, options);
const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Redmine request timed out"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export class RedmineHttpError extends Error {
  constructor(readonly statusCode: number) {
    super(`Redmine request failed with status ${statusCode}`);
    this.name = "RedmineHttpError";
  }
}

export class RedmineHttpClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly transport: Transport;
  private readonly sleep: NonNullable<RedmineHttpClientOptions["sleep"]>;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly options: RedmineHttpClientOptions = {},
  ) {
    if (!apiKey) throw new Error("Redmine API key is required");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    if (this.timeoutMs <= 0) throw new Error("Redmine timeout must be positive");
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error("Redmine max attempts must be a positive integer");
    }

    this.baseUrl = new URL(baseUrl);
    this.baseUrl.hash = "";
    this.baseUrl.search = "";
    if (!this.baseUrl.pathname.endsWith("/")) this.baseUrl.pathname += "/";
    this.transport = options.transport ?? defaultTransport;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get<T>(path: string): Promise<T> {
    return this.send<T>("GET", path);
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("POST", path, body);
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("PUT", path, body);
  }

  putOnce<T>(path: string, body: unknown): Promise<T> {
    return this.send<T>("PUT", path, body, 1);
  }

  delete<T>(path: string): Promise<T> {
    return this.send<T>("DELETE", path);
  }

  private async send<T>(method: Dispatcher.HttpMethod, path: string, value?: unknown, limit?: number): Promise<T> {
    const target = new URL(path.replace(/^\/+/, ""), this.baseUrl);
    if (target.origin !== this.baseUrl.origin) throw unsafe("request path changed origin");

    const body = value === undefined ? undefined : JSON.stringify(value);
    const headers: Record<string, string> = {
      accept: "application/json",
      "X-Redmine-API-Key": this.apiKey,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const attempts = limit ?? (method === "POST" ? 1 : this.maxAttempts);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      timeout.unref?.();

      let statusCode: number;
      let text: string;
      let dispatcher: Agent | undefined;
      try {
        const endpoint = await withAbort(
          resolveSafeEndpoint(target, {
            endpointAllowlist: this.options.endpointAllowlist,
            resolve: this.options.resolve,
          }),
          controller.signal,
        );
        dispatcher = new Agent({
          connect: { lookup: createPinnedLookup(endpoint, this.options.endpointAllowlist) },
          maxRedirections: 0,
        });
        const response = await this.transport(endpoint.url, {
          method,
          headers,
          body,
          signal: controller.signal,
          dispatcher,
          maxRedirections: 0,
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
        });
        statusCode = response.statusCode;
        text = await response.body.text();
      } finally {
        clearTimeout(timeout);
        await dispatcher?.destroy();
      }

      if (statusCode >= 200 && statusCode < 300) {
        return (text ? JSON.parse(text) : undefined) as T;
      }
      if ((statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) && attempt + 1 < attempts) {
        await this.sleep(100 * 2 ** attempt);
        continue;
      }
      throw new RedmineHttpError(statusCode);
    }

    throw new Error("Redmine request attempts exhausted");
  }
}
