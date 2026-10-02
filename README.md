# Riga Now — Repo demo 04

A live city board for Riga on public data: realtime tram, trolleybus and bus departures
for any stop, the weather (now, next 24 h, 7 days), and the Nord Pool day-ahead electricity
price for Latvia with the cheapest 3-hour window. It has a wall-display mode
(`?kiosk` or the button). Served at `https://riga.repo.lv/`.

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
  built frontend and `/api/*`, and redirects `/` to `/`.
- Every upstream URL is fixed server-side. The browser sends only stop ids, which must match
  `^[A-Za-z0-9]{1,10}$` and exist in the official stop list (max 12 per request).
- `SwrCache`: at most one upstream request per key per TTL, shared in-flight requests,
  6 s timeouts, and stale-while-error (last good data served with `stale: true`).
- Per-IP token bucket (40 burst, 1 per 2 s) on `/api/*`, keyed on the first
  `X-Forwarded-For` entry (Caddy sets it), with a global cap of 64 in-flight API requests, and a separate global bucket (30 burst,
  1/s) on real upstream departure fetches so many addresses together cannot use the board
  to hammer saraksti.lv (cache hits are free; a refusal is a 503).
  GET/HEAD only; any request body over 1 KB gets a 413.
- `src/shared/` holds the pure logic (parsers, Riga-time maths, cheapest window). It is shared
  by server and client and covered by the tests.

API (all under `/api/`): `stations`, `stations/search?q=`, `departures?stops=a,b`,
`weather`, `prices`. Responses are `{ data, fetchedAt, stale, now, source }`; errors are
`{ error, message }` with a proper status (400 / 404 / 405 / 413 / 429 / 502 / 503).

## Run locally

```bash
pnpm install
pnpm dev:server     # API + static on :3104 (tsx watch)
pnpm dev            # Vite on :5173, proxies /api and /theme.css
# open http://localhost:5173/
```

## Build, test, run

```bash
pnpm build          # typecheck, then vite build -> dist/client, tsc -> dist/node
pnpm test           # vitest
pnpm typecheck      # client, server and test sources
PORT=3104 node dist/node/server/index.js
curl http://127.0.0.1:3104/healthz   # ok
```

## Deploy (VPS)

```bash
docker compose up -d --build     # publishes 127.0.0.1:3104 only
```

Caddy fronts it on its own host, riga.repo.lv:

```
riga.repo.lv {
    request_header -X-Forwarded-For
    handle /theme.css {
        reverse_proxy 127.0.0.1:3000   # the shell, which owns the design tokens
    }
    handle {
        reverse_proxy 127.0.0.1:3104
    }
}
```

The `X-Forwarded-For` strip matters: the rate limit keys on the first XFF entry and trusts
Caddy to have set it.

`/theme.css` is proxied to the shell by Caddy. The page still looks right
without it.
