import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";

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
  allowHttp?: boolean;
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

function requirePublicAddress(address: string): { address: string; family: 4 | 6 } {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (
    (family !== 4 && family !== 6) ||
    normalized.startsWith("::ffff:") ||
    blockedAddresses.check(normalized, family === 4 ? "ipv4" : "ipv6")
  ) {
    throw unsafe("address is not publicly routable");
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
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    throw unsafe("HTTPS is required");
  }

  const hostname = normalizeHostname(url.hostname);
  const literalFamily = isIP(hostname);
  const answers = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await (options.resolve ?? resolveHostname)(hostname);
  if (answers.length === 0) throw unsafe("hostname did not resolve");

  const vetted = answers.map((answer) => requirePublicAddress(answer.address));
  const selected = vetted[0]!;
  return Object.freeze({
    url: url.href,
    hostname,
    address: selected.address,
    family: selected.family,
  });
}

export function createPinnedLookup(endpoint: SafeEndpoint): LookupFunction {
  const vetted = requirePublicAddress(endpoint.address);
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
