import { SwrCache, UpstreamBusy, UpstreamError, type CacheResult } from './cache.js';
import { TokenBuckets } from './rateLimit.js';
import {
  buildStations,
  findStation,
  parseStops,
  platformLabel,
  type StopRow,
} from '../shared/stops.js';
import { normaliseDepartures, parseDepartures } from '../shared/departures.js';
import { buildPrices, eleringRange, type EleringResponse } from '../shared/prices.js';
import { normaliseWeather, WEATHER_URL } from '../shared/weather.js';
import { rigaSecondsOfDay } from '../shared/rigaTime.js';
import type { DeparturesPayload, PricesPayload, Station, WeatherPayload } from '../shared/types.js';

/**
 * Every upstream URL is fixed here. Browsers only ever send validated stop ids; nothing a
 * client sends becomes part of a hostname or path.
 */
const SARAKSTI = 'https://saraksti.lv';
const STOPS_URL = `${SARAKSTI}/riga/stops.txt`;
const DEPARTURES_URL = `${SARAKSTI}/gpsdata.ashx`;
const ELERING_URL = 'https://dashboard.elering.ee/api/nps/price';

const UA = 'RepoRigaNow/0.1 (+https://riga.repo.lv/)';
const TIMEOUT_MS = 6000;
const MAX_BYTES = 2 * 1024 * 1024;

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: '*/*', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (err) {
    const name = (err as Error)?.name;
    throw new UpstreamError(name === 'TimeoutError' ? 'upstream timed out' : 'upstream unreachable');
  }
  if (!res.ok) throw new UpstreamError(`upstream answered ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new UpstreamError('upstream response too large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new UpstreamError('upstream response too large');
  return text;
}

async function fetchJson(url: string): Promise<unknown> {
  const text = await fetchText(url, { accept: 'application/json' });
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError('upstream sent malformed JSON');
  }
}

// ------------------------------------------------------------------ stops ----

export interface StopIndex {
  rows: Map<string, StopRow>;
  stations: Station[];
  featured: Station[];
}

/** Featured stations: well-known central places, with an English gloss. */
export const FEATURED: { name: string; en: string }[] = [
  { name: 'Centrālā stacija', en: 'Central Station' },
  { name: 'Grēcinieku iela', en: 'Old Town' },
  { name: 'Brīvības piemineklis', en: 'Freedom Monument' },
  { name: 'Nacionālā opera', en: 'National Opera' },
  { name: 'Merķeļa iela', en: 'University · Merķeļa' },
  { name: 'Esplanāde', en: 'Esplanade' },
];

export function buildIndex(text: string): StopIndex {
  const rows = parseStops(text);
  if (rows.length < 100) throw new UpstreamError('stop list looks truncated');
  const stations = buildStations(rows);
  const featured: Station[] = [];
  for (const f of FEATURED) {
    const s = findStation(stations, f.name);
    if (s) featured.push({ ...s, en: f.en });
  }
  return { rows: new Map(rows.map((r) => [r.id, r])), stations, featured };
}

const stopsCache = new SwrCache<StopIndex>({
  ttl: 12 * 3600_000,
  staleFor: 14 * 24 * 3600_000,
  retryAfterError: 60_000,
});

export function getStops() {
  return stopsCache.get('riga', async () => buildIndex(await fetchText(STOPS_URL)));
}

// ------------------------------------------------------------- departures ----

const departuresCache = new SwrCache<DeparturesPayload>({
  ttl: 20_000,
  staleFor: 10 * 60_000,
  retryAfterError: 10_000,
  maxKeys: 400,
});

/**
 * Every distinct stop set is its own cache key, so the per-IP limit alone would still let
 * many addresses together turn this server into a request amplifier aimed at saraksti.lv.
 * This one global bucket caps real upstream departure fetches, whoever asks: a burst of
 * 30, then one a second. Cache hits never touch it.
 */
const departuresUpstream = new TokenBuckets(30, 1, 1);

export function getDepartures(stopIds: string[], index: StopIndex) {
  const key = stopIds.join(',');
  return departuresCache.get(key, async () => {
    if (departuresUpstream.take('global') > 0) {
      throw new UpstreamBusy('too many different stops are being watched right now');
    }
    // Origin-Custom is what saraksti.lv's own front end sends; without it the feed
    // answers "Bad request".
    const text = await fetchText(`${DEPARTURES_URL}?stopid=${encodeURIComponent(key)}`, {
      'origin-custom': 'saraksti.lv',
    });
    if (/^\s*bad request/i.test(text)) throw new UpstreamError('departures feed refused the request');
    const now = Date.now();
    const departures = normaliseDepartures(parseDepartures(text), {
      now,
      nowSecondsOfDay: rigaSecondsOfDay(now),
      platformOf: (id) => platformLabel(index.rows.get(id)?.direction ?? ''),
    });
    return { stopIds, departures };
  });
}

// ---------------------------------------------------------------- weather ----

const weatherCache = new SwrCache<WeatherPayload>({
  ttl: 10 * 60_000,
  staleFor: 6 * 3600_000,
  retryAfterError: 60_000,
});

export function getWeather() {
  return weatherCache.get('riga', async () => normaliseWeather(await fetchJson(WEATHER_URL)));
}

// ----------------------------------------------------------------- prices ----

// Cache the raw feed, not the payload: "today", the now marker and the cheapest window
// are recomputed per request so a 15-minute cache never shows a window that has passed.
const pricesCache = new SwrCache<EleringResponse>({
  ttl: 15 * 60_000,
  staleFor: 24 * 3600_000,
  retryAfterError: 60_000,
});

export async function getPrices(): Promise<CacheResult<PricesPayload>> {
  const raw = await pricesCache.get('lv', async () => {
    const { start, end } = eleringRange(Date.now());
    const url = `${ELERING_URL}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const body = (await fetchJson(url)) as EleringResponse;
    if (body?.success === false) throw new UpstreamError('price feed reported failure');
    buildPrices(body, Date.now()); // validate before caching; throws on an unusable body
    return body;
  });
  try {
    return { ...raw, value: buildPrices(raw.value, Date.now()) };
  } catch (err) {
    throw new UpstreamError((err as Error).message);
  }
}
