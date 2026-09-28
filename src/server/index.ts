import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientIp, TokenBuckets } from './rateLimit.js';
import { UpstreamBusy, UpstreamError, type CacheResult } from './cache.js';
import { getDepartures, getPrices, getStops, getWeather } from './upstream.js';
import { parseStopIdList, searchStations } from '../shared/stops.js';
import type { ApiError, Envelope } from '../shared/types.js';

/** Served at the root of riga.skabene.id.lv. Set a prefix here to mount it under a path. */
export const BASE = '';
const PORT = Number(process.env.PORT ?? 3104);
const HOST = process.env.HOST ?? '0.0.0.0';

// dist/node/server/index.js -> dist/client
const CLIENT_DIR = resolve(fileURLToPath(new URL('../../client/', import.meta.url)));

const MAX_BODY = 1024;
const MAX_INFLIGHT = 64;
let inflight = 0;

// 40-request burst, then one every two seconds. A board left open polls roughly once
// every seven seconds across all panels, so this only bites on abuse.
const limiter = new TokenBuckets(40, 0.5);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
    "connect-src 'self'; script-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
};

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string | number> = {},
  head = false,
): void {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-length': buf.length, ...headers });
  res.end(head ? undefined : buf);
}

function json(res: ServerResponse, status: number, data: unknown, head: boolean, extra: Record<string, string | number> = {}): void {
  send(res, status, JSON.stringify(data), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extra,
  }, head);
}

function fail(res: ServerResponse, status: number, error: string, message: string, head: boolean, extra: Record<string, string | number> = {}): void {
  const body: ApiError = { error, message };
  json(res, status, body, head, extra);
}

function envelope<T>(r: CacheResult<T>, source: string): Envelope<T> {
  return { data: r.value, fetchedAt: r.fetchedAt, stale: r.stale, now: Date.now(), source };
}

// ------------------------------------------------------------------- api ----

async function handleApi(route: string, url: URL, req: IncomingMessage, res: ServerResponse, head: boolean): Promise<void> {
  const wait = limiter.take(clientIp(req));
  if (wait > 0) {
    return fail(res, 429, 'rate_limited', `Easy there. Too many requests from your address; try again in ${wait}s.`, head, {
      'retry-after': wait,
    });
  }
  if (inflight >= MAX_INFLIGHT) {
    return fail(res, 503, 'busy', 'The board is very busy right now. Try again in a few seconds.', head, { 'retry-after': 3 });
  }
  inflight++;
  try {
    switch (route) {
      case 'stations': {
        const r = await getStops();
        return json(res, 200, envelope({ ...r, value: { featured: r.value.featured } }, 'Rīgas Satiksme via saraksti.lv'), head);
      }
      case 'stations/search': {
        const q = url.searchParams.get('q') ?? '';
        if (q.trim().length < 2 || q.length > 40) {
          return fail(res, 400, 'bad_query', 'Type between 2 and 40 characters to search for a stop.', head);
        }
        const r = await getStops();
        const results = searchStations(r.value.stations, q);
        return json(res, 200, envelope({ ...r, value: { results } }, 'Rīgas Satiksme via saraksti.lv'), head);
      }
      case 'departures': {
        const ids = parseStopIdList(url.searchParams.get('stops'));
        if (!ids) {
          return fail(res, 400, 'bad_stops', 'Pass 1 to 12 stop ids, comma separated, e.g. ?stops=0722,0709.', head);
        }
        const stops = await getStops();
        const unknown = ids.filter((id) => !stops.value.rows.has(id));
        if (unknown.length) {
          return fail(res, 400, 'unknown_stop', `Not a Riga stop id: ${unknown.slice(0, 3).join(', ')}.`, head);
        }
        const r = await getDepartures(ids, stops.value);
        return json(res, 200, envelope(r, 'Rīgas Satiksme realtime via saraksti.lv'), head);
      }
      case 'weather':
        return json(res, 200, envelope(await getWeather(), 'Open-Meteo'), head);
      case 'prices':
        return json(res, 200, envelope(await getPrices(), 'Nord Pool day-ahead (LV) via Elering'), head);
      default:
        return fail(res, 404, 'not_found', 'No such API route.', head);
    }
  } catch (err) {
    if (err instanceof UpstreamBusy) {
      return fail(res, 503, 'busy', 'The board is watching a lot of stops at once right now. It will retry in a few seconds.', head, {
        'retry-after': 5,
      });
    }
    if (err instanceof UpstreamError) {
      return fail(res, 502, 'upstream_unavailable', `The data source is not answering (${err.message}). The board will retry on its own.`, head, {
        'retry-after': 15,
      });
    }
    console.error('[api]', route, err);
    return fail(res, 500, 'internal', 'Something broke on our side. It has been logged.', head);
  } finally {
    inflight--;
  }
}

// ---------------------------------------------------------------- static ----

async function serveStatic(rel: string, res: ServerResponse, head: boolean): Promise<void> {
  const clean = normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, '');
  const file = resolve(CLIENT_DIR, clean || 'index.html');
  if (file !== CLIENT_DIR && !file.startsWith(CLIENT_DIR + sep)) {
    return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' }, head);
  }
  let target = file;
  try {
    const st = await stat(target);
    if (st.isDirectory()) target = join(target, 'index.html');
  } catch {
    return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' }, head);
  }
  try {
    const body = await readFile(target);
    const immutable = clean.startsWith('assets/');
    return send(res, 200, body, {
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    }, head);
  } catch {
    return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' }, head);
  }
}

// ---------------------------------------------------------------- router ----

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const head = method === 'HEAD';
  if (method !== 'GET' && !head) {
    return fail(res, 405, 'method_not_allowed', 'This board only reads.', false, { allow: 'GET, HEAD' });
  }
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY || req.headers['transfer-encoding']) {
    return fail(res, 413, 'too_large', 'Requests to this board carry no body.', head);
  }

  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return fail(res, 400, 'bad_url', 'Malformed URL.', head);
  }
  const path = url.pathname;

  if (BASE && (path === '/' || path === BASE)) {
    res.writeHead(302, { location: `${BASE}/` });
    return void res.end();
  }
  if (path === `${BASE}/healthz`) {
    return send(res, 200, 'ok', { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, head);
  }
  if (path.startsWith(`${BASE}/api/`)) {
    return handleApi(path.slice(`${BASE}/api/`.length).replace(/\/+$/, ''), url, req, res, head);
  }
  if (path.startsWith(`${BASE}/`)) {
    try {
      return await serveStatic(path.slice(BASE.length + 1), res, head);
    } catch {
      return send(res, 400, 'Bad request', { 'content-type': 'text/plain; charset=utf-8' }, head);
    }
  }
  return send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' }, head);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[http]', err);
      if (!res.headersSent) fail(res, 500, 'internal', 'Something broke on our side.', false);
      else res.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.listen(PORT, HOST, () => {
    console.log(`riga-now listening on http://${HOST}:${PORT}${BASE}/`);
    // Warm the stop list so the first visitor does not pay for it.
    getStops().catch((err) => console.warn('[warm] stop list:', (err as Error).message));
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
