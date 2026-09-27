# Riga Now — Cosmic demo 04

A live city board for Riga on public data: realtime tram, trolleybus and bus departures
for any stop, the weather (now, next 24 h, 7 days), and the Nord Pool day-ahead electricity
price for Latvia with the cheapest 3-hour window. It has a wall-display mode
(`?kiosk` or the button). Served at `https://www.skabene.id.lv/demo/riga/`.

No keys, no AI, no trackers, no third-party requests from the browser.

## Data sources (checked 2026-09-28, from the workstation and the VPS)

| Panel | Source | Server cache |
|---|---|---|
| Stops | `https://saraksti.lv/riga/stops.txt` (Rīgas Satiksme stop list) | 12 h |
| Departures | `https://saraksti.lv/gpsdata.ashx?stopid=…` with header `Origin-Custom: saraksti.lv`. This is the realtime feed behind saraksti.lv's own front end. | 20 s per stop set |
| Weather | Open-Meteo forecast API (CC BY 4.0) | 10 min |
| Prices | `https://dashboard.elering.ee/api/nps/price` (area `lv`, 15-min slots) | 15 min |

`saraksti.rigassatiksme.lv` (the host people usually mention) timed out from both the
workstation and the VPS, so the app uses `saraksti.lv`, which runs the same software.
The departures feed is **undocumented**: it could change without notice. If it does,
`src/shared/departures.ts` is the only parser to fix.

## How it works

- `src/server/` is a plain `node:http` server with no runtime dependencies. It serves the
  built frontend and `/demo/riga/api/*`, and redirects `/` to `/demo/riga/`.
- Every upstream URL is fixed server-side. The browser sends only stop ids, which must match
  `^[A-Za-z0-9]{1,10}$` and exist in the official stop list (max 12 per request).
- `SwrCache`: at most one upstream request per key per TTL, shared in-flight requests,
  6 s timeouts, and stale-while-error (last good data served with `stale: true`).
- Per-IP token bucket (40 burst, 1 per 2 s) on `/api/*`, keyed on the first
  `X-Forwarded-For` entry (Caddy sets it), with a global cap of 64 in-flight API requests.
  GET/HEAD only; any request body over 1 KB gets a 413.
- `src/shared/` holds the pure logic (parsers, Riga-time maths, cheapest window). It is shared
  by server and client and covered by the tests.

API (all under `/demo/riga/api/`): `stations`, `stations/search?q=`, `departures?stops=a,b`,
`weather`, `prices`. Responses are `{ data, fetchedAt, stale, now, source }`; errors are
`{ error, message }` with a proper status (400 / 404 / 405 / 413 / 429 / 502 / 503).

## Run locally

```bash
pnpm install
pnpm dev:server     # API + static on :3104 (tsx watch)
pnpm dev            # Vite on :5173, proxies /demo/riga/api and /theme.css
# open http://localhost:5173/demo/riga/
```

## Build, test, run

```bash
pnpm build          # typecheck, then vite build -> dist/client, tsc -> dist/node
pnpm test           # vitest
PORT=3104 node dist/node/server/index.js
curl http://127.0.0.1:3104/demo/riga/healthz   # ok
```

## Deploy (VPS)

```bash
docker compose up -d --build     # publishes 127.0.0.1:3104 only
```

Caddy has to pass the full path through (no prefix stripping), inside the `www.skabene.id.lv`
block, for example:

```
handle /demo/riga/* {
    reverse_proxy 127.0.0.1:3104
}
```

`/theme.css` is served by the shell on the same origin. The page still looks right
without it.
