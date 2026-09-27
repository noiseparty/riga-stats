import type { Departure, DeparturesPayload, Envelope, Mode, Station } from '../shared/types';
import { $, errorBlock, esc, FetchError, getJson, loadingBlock, poll, renderUpdated, rigaHM, serverNow } from './util';

const REFRESH_MS = 20_000;
const STORE_KEY = 'riga-now.station';
const ROWS = 12;

const MODE_LABEL: Record<Mode, string> = {
  tram: 'Tram',
  trol: 'Trolleybus',
  bus: 'Bus',
  express: 'Express bus',
  nightbus: 'Night bus',
  other: 'Service',
};

let featured: Station[] = [];
let current: Station | null = null;
let last: Envelope<DeparturesPayload> | null = null;
let lastError: FetchError | null = null;
let nextAt = 0;
let refreshNow: () => void = () => {};

function saveStation(s: Station): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ key: s.key, name: s.name, en: s.en, street: s.street, stopIds: s.stopIds, lat: s.lat, lng: s.lng }));
  } catch {
    /* private mode: fine, just not remembered */
  }
}

function loadStation(): Station | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Station;
    if (typeof s?.name === 'string' && Array.isArray(s.stopIds) && s.stopIds.length > 0 && s.stopIds.length <= 12) return s;
  } catch {
    /* ignore */
  }
  return null;
}

// ------------------------------------------------------------------ chips ----

function renderChips(): void {
  const box = $('chips');
  box.innerHTML = featured
    .map(
      (s) =>
        `<button type="button" class="chip" data-key="${esc(s.key)}" aria-pressed="${current?.key === s.key}">` +
        `<span class="chip-en">${esc(s.en ?? s.name)}</span><span class="chip-lv">${esc(s.name)}</span></button>`,
    )
    .join('');
}

function select(s: Station): void {
  current = s;
  last = null;
  lastError = null;
  saveStation(s);
  renderChips();
  $('station-name').textContent = s.name;
  const sub = [s.en, s.street, `${s.stopIds.length} platform${s.stopIds.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  $('station-sub').textContent = sub;
  $('board-body').innerHTML = loadingBlock('Asking Rīgas Satiksme where the vehicles are…');
  $('board-body').setAttribute('aria-busy', 'true');
  refreshNow();
}

// ------------------------------------------------------------------ board ----

function minutesLabel(at: number): { big: string; unit: string; sr: string } {
  const s = Math.round((at - serverNow()) / 1000);
  if (s < 45) return { big: 'now', unit: '', sr: 'departing now' };
  const m = Math.round(s / 60);
  if (m < 60) return { big: String(m), unit: 'min', sr: `in ${m} minute${m === 1 ? '' : 's'}` };
  return { big: rigaHM(at), unit: '', sr: `at ${rigaHM(at)}` };
}

function row(d: Departure): string {
  const t = minutesLabel(d.at);
  const soon = d.at - serverNow() < 120_000;
  return (
    `<li class="dep${soon ? ' is-soon' : ''}">` +
    `<span class="badge m-${d.mode}" title="${esc(MODE_LABEL[d.mode])}"><span class="sr-only">${esc(MODE_LABEL[d.mode])} </span>${esc(d.route)}</span>` +
    `<span class="dep-dest"><span class="dep-to">${esc(d.destination)}</span>` +
    `<span class="dep-meta">${esc(MODE_LABEL[d.mode])}${d.platform ? ` · ${esc(d.platform)}` : ''} · ${esc(rigaHM(d.at))}</span></span>` +
    `<span class="dep-min" aria-label="${esc(t.sr)}"><b>${esc(t.big)}</b>${t.unit ? `<small>${t.unit}</small>` : ''}</span>` +
    `</li>`
  );
}

function renderBoard(): void {
  const body = $('board-body');
  renderUpdated($('board-updated'), last);
  if (!current) return;
  if (!last) {
    if (lastError) {
      body.innerHTML = errorBlock(lastError.message);
      body.setAttribute('aria-busy', 'false');
    }
    return;
  }
  body.setAttribute('aria-busy', 'false');
  const now = serverNow();
  const deps = last.data.departures.filter((d) => d.at > now - 30_000).slice(0, ROWS);
  const warn = lastError
    ? `<p class="note note-warn" role="status">Couldn't refresh: ${esc(lastError.message)} Showing the last answer.</p>`
    : '';
  if (deps.length === 0) {
    body.innerHTML =
      warn +
      `<div class="state state-empty"><p class="state-big">Nothing due in the next 90 minutes.</p>` +
      `<p>Riga's day network mostly stops between about 00:30 and 05:00, and not every platform is served at every hour. ` +
      `Try another stop, or leave this open — it refreshes on its own.</p></div>`;
    return;
  }
  body.innerHTML = warn + `<ol class="deps">${deps.map(row).join('')}</ol>`;
}

async function refresh(): Promise<void> {
  if (!current) return;
  const station = current;
  try {
    const env = await getJson<DeparturesPayload>(`departures?stops=${encodeURIComponent(station.stopIds.join(','))}`);
    if (station !== current) return;
    const first = last === null;
    last = env;
    lastError = null;
    if (first) {
      const n = env.data.departures.length;
      $('board-status').textContent = n
        ? `${n} upcoming departure${n === 1 ? '' : 's'} from ${station.name}.`
        : `No departures due from ${station.name} in the next 90 minutes.`;
    }
  } catch (err) {
    if (station !== current) return;
    lastError = err instanceof FetchError ? err : new FetchError('Something went wrong loading departures.', 0);
  }
  nextAt = Date.now() + REFRESH_MS;
  renderBoard();
}

function tickCountdown(): void {
  const el = $('board-refresh');
  const left = Math.max(0, nextAt - Date.now());
  const bar = el.querySelector<HTMLElement>('.refresh-bar i');
  if (bar) bar.style.transform = `scaleX(${1 - left / REFRESH_MS})`;
  const t = el.querySelector('.refresh-t');
  if (t) t.textContent = nextAt ? `${Math.ceil(left / 1000)}s` : '';
}

// ----------------------------------------------------------------- search ----

function setupSearch(): void {
  const input = $<HTMLInputElement>('stop-search');
  const list = $<HTMLUListElement>('stop-results');
  let results: Station[] = [];
  let active = -1;
  let timer = 0;
  let seq = 0;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const paint = (message?: string) => {
    if (message) {
      list.innerHTML = `<li class="opt-msg" role="presentation">${esc(message)}</li>`;
    } else {
      list.innerHTML = results
        .map(
          (s, i) =>
            `<li role="option" id="opt-${i}" class="opt" aria-selected="${i === active}" data-i="${i}">` +
            `<span>${esc(s.name)}</span><small>${esc([s.street, `${s.stopIds.length} pl.`].filter(Boolean).join(' · '))}</small></li>`,
        )
        .join('');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };
  const choose = (i: number) => {
    const s = results[i];
    if (!s) return;
    input.value = '';
    close();
    select(s);
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      close();
      return;
    }
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      paint('Searching…');
      try {
        const env = await getJson<{ results: Station[] }>(`stations/search?q=${encodeURIComponent(q)}`);
        if (mine !== seq) return;
        results = env.data.results;
        active = results.length ? 0 : -1;
        paint(results.length ? undefined : `No Riga stop matches "${q}".`);
      } catch (err) {
        if (mine !== seq) return;
        results = [];
        paint(err instanceof Error ? err.message : 'Search failed.');
      }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      active = (active + 1) % results.length;
      paint();
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      paint();
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (li) choose(Number(li.dataset.i));
  });
  input.addEventListener('blur', () => window.setTimeout(close, 100));
}

// ------------------------------------------------------------------- init ----

export async function initBoard(): Promise<void> {
  $('chips').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
    const s = featured.find((f) => f.key === b?.dataset.key);
    if (s) select(s);
  });
  $('board-body').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-retry]')) {
      if (!featured.length) void loadFeatured();
      else refreshNow();
    }
  });
  setupSearch();
  refreshNow = poll(refresh, REFRESH_MS);
  window.setInterval(() => {
    tickCountdown();
    // Minutes tick down locally between refreshes.
    if (last) renderBoardQuiet();
  }, 1000);

  const remembered = loadStation();
  if (remembered) select(remembered);
  await loadFeatured(!remembered);
}

let quietCounter = 0;
function renderBoardQuiet(): void {
  // Re-render every 5 s: often enough for "now"/minute changes, rare enough that screen
  // readers in the live region are not flooded.
  if (++quietCounter % 5 === 0) renderBoard();
  else renderUpdated($('board-updated'), last);
}

async function loadFeatured(pickFirst = false): Promise<void> {
  try {
    const env = await getJson<{ featured: Station[] }>('stations');
    featured = env.data.featured;
    renderChips();
    const first = featured[0];
    if ((pickFirst || !current) && first) select(first);
  } catch (err) {
    if (!current) {
      $('board-body').innerHTML = errorBlock(
        `Couldn't load the stop list. ${err instanceof Error ? err.message : ''}`.trim(),
      );
      $('board-body').setAttribute('aria-busy', 'false');
    }
  }
}
