import type { Envelope, PriceDay, PricesPayload } from '../shared/types';
import { $, errorBlock, esc, FetchError, getJson, loadingBlock, poll, renderUpdated, rigaHM, serverNow } from './util';

let last: Envelope<PricesPayload> | null = null;
let dayIdx = 0;
let cursor = -1;

const W = 960;
const H = 200;
const c = (eurMwh: number) => (eurMwh / 10).toFixed(2);
const e = (eurMwh: number) => eurMwh.toFixed(2);

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDate = (ymd: string) => dateFmt.format(new Date(`${ymd}T12:00:00Z`));

function slotAt(day: PriceDay, t: number): number {
  return day.slots.findIndex((s) => t >= s.t && t < s.t + s.mins * 60000);
}

function extreme(day: PriceDay, pick: 'min' | 'max') {
  let best = day.slots[0]!;
  for (const s of day.slots) if (pick === 'min' ? s.p < best.p : s.p > best.p) best = s;
  return best;
}

function chart(day: PriceDay, p: PricesPayload): string {
  const n = day.slots.length;
  const lo = Math.min(0, day.min);
  const hi = Math.max(day.max, lo + 1);
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const bw = W / n;
  const now = serverNow();
  const nowIdx = slotAt(day, now);
  const cw = p.cheapest;
  const bars = day.slots
    .map((s, i) => {
      const cls = ['bar'];
      if (cw && s.t >= cw.start && s.t < cw.end) cls.push('cheap');
      if (i === nowIdx) cls.push('now');
      if (s.t + s.mins * 60000 <= now) cls.push('past');
      if (s.p < 0) cls.push('neg');
      if (i === cursor) cls.push('cur');
      const top = Math.min(y(s.p), y(0));
      const h = Math.max(1, Math.abs(y(s.p) - y(0)));
      return `<rect class="${cls.join(' ')}" x="${(i * bw + bw * 0.12).toFixed(2)}" y="${top.toFixed(2)}" width="${(bw * 0.76).toFixed(2)}" height="${h.toFixed(2)}" />`;
    })
    .join('');
  const zero = lo < 0 ? `<line class="zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" />` : '';
  let nowLine = '';
  const ns = day.slots[nowIdx];
  if (ns) {
    const x = ((nowIdx + (now - ns.t) / (ns.mins * 60000)) * bw).toFixed(2);
    nowLine = `<line class="now-line" x1="${x}" x2="${x}" y1="0" y2="${H}" />`;
  }
  // Hour ticks every 3 hours, as HTML so the text does not stretch with the SVG.
  const ticks = day.hours
    .map((h, i) => (i % 3 === 0 ? `<span style="left:${((day.slots.findIndex((s) => s.t === h.t) / n) * 100).toFixed(2)}%">${esc(rigaHM(h.t))}</span>` : ''))
    .join('');
  return (
    `<div class="chart" tabindex="0" role="group" aria-roledescription="price chart" ` +
    `aria-label="Price per 15 minutes for ${esc(fmtDate(day.date))}. Use left and right arrow keys to read each slot.">` +
    `<span class="axis axis-hi mono">${esc(Math.round(hi))}</span><span class="axis axis-lo mono">${esc(Math.round(lo))}</span>` +
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${zero}${bars}${nowLine}</svg>` +
    `<div class="ticks mono" aria-hidden="true">${ticks}</div></div>`
  );
}

function readout(day: PriceDay): string {
  const i = cursor >= 0 ? cursor : slotAt(day, serverNow());
  const s = day.slots[i];
  if (!s) return `Hover or use the arrow keys to read a slot.`;
  const end = s.t + s.mins * 60000;
  const tag = cursor < 0 ? 'Now' : '';
  return `${tag ? `<b>${tag}</b> ` : ''}${esc(rigaHM(s.t))}–${esc(rigaHM(end))} · <b>${esc(c(s.p))}</b> c/kWh · ${esc(e(s.p))} €/MWh`;
}

function render(): void {
  const body = $('prices-body');
  if (!last) return;
  const p = last.data;
  const today = p.days[0];
  if (!today) {
    body.innerHTML = `<div class="state state-empty"><p>No prices published for today yet.</p></div>`;
    return;
  }
  if (dayIdx >= p.days.length) dayIdx = 0;
  const day = p.days[dayIdx]!;
  const hasTomorrow = p.days.length > 1;
  const nowSlot = today.slots[slotAt(today, serverNow())];
  const lo = extreme(day, 'min');
  const hi = extreme(day, 'max');
  const cw = p.cheapest;
  const cwDay = cw ? p.days.findIndex((d) => cw.start >= d.slots[0]!.t && cw.start <= d.slots[d.slots.length - 1]!.t) : -1;

  body.innerHTML =
    `<div class="price-top">` +
    `<div class="price-now"><p class="label dim">Right now</p>` +
    (nowSlot
      ? `<p class="price-big">${esc(c(nowSlot.p))}<small> c/kWh</small></p><p class="mono small dim">${esc(e(nowSlot.p))} €/MWh · ${esc(rigaHM(nowSlot.t))}–${esc(rigaHM(nowSlot.t + nowSlot.mins * 60000))}</p>`
      : `<p class="price-big">—</p>`) +
    `</div>` +
    (cw
      ? `<div class="cheap-call"><p class="label">Cheapest 3 hours${cwDay === 1 ? ' · tomorrow' : ''}</p>` +
        `<p class="cheap-when">${esc(rigaHM(cw.start))}–${esc(rigaHM(cw.end))}</p>` +
        `<p class="mono small">avg ${esc(c(cw.avg))} c/kWh · ${esc(e(cw.avg))} €/MWh</p></div>`
      : `<div class="cheap-call"><p class="label">Cheapest 3 hours</p><p class="mono small">Not enough of today left to fit one — tomorrow's prices usually land around 14:00.</p></div>`) +
    `</div>` +
    `<div class="tabs" role="tablist" aria-label="Day">` +
    p.days
      .map(
        (d, i) =>
          `<button type="button" role="tab" class="tab" aria-selected="${i === dayIdx}" data-day="${i}">${i === 0 ? 'Today' : 'Tomorrow'} <span class="mono">${esc(fmtDate(d.date))}</span></button>`,
      )
      .join('') +
    (hasTomorrow ? '' : `<span class="tab tab-off mono small">Tomorrow · published ~14:00 Riga time</span>`) +
    `</div>` +
    chart(day, p) +
    `<p class="readout mono small" aria-live="polite">${readout(day)}</p>` +
    `<dl class="meta price-stats">` +
    `<dt>Low</dt><dd>${esc(c(lo.p))} c/kWh at ${esc(rigaHM(lo.t))}</dd>` +
    `<dt>High</dt><dd>${esc(c(hi.p))} c/kWh at ${esc(rigaHM(hi.t))}</dd>` +
    `<dt>Average</dt><dd>${esc(c(day.avg))} c/kWh · ${esc(e(day.avg))} €/MWh</dd>` +
    `</dl>` +
    `<p class="legend mono small"><i class="k-cheap"></i>cheapest 3 h <i class="k-now"></i>now <i class="k-bar"></i>15-min slot · excl. VAT and fees</p>`;
}

function onChartInput(clientX: number, chartEl: HTMLElement): void {
  const day = last?.data.days[dayIdx];
  if (!day) return;
  const r = chartEl.querySelector('svg')!.getBoundingClientRect();
  const i = Math.floor(((clientX - r.left) / r.width) * day.slots.length);
  if (i < 0 || i >= day.slots.length || i === cursor) return;
  cursor = i;
  paintCursor();
}

/** Cheap update for hover/keys: move the highlight and rewrite the readout, not the chart. */
function paintCursor(): void {
  const day = last?.data.days[dayIdx];
  const body = $('prices-body');
  if (!day) return;
  body.querySelectorAll('rect.cur').forEach((r) => r.classList.remove('cur'));
  body.querySelectorAll('rect')[cursor]?.classList.add('cur');
  const ro = body.querySelector('.readout');
  if (ro) ro.innerHTML = readout(day);
}

async function refresh(): Promise<void> {
  const body = $('prices-body');
  try {
    last = await getJson<PricesPayload>('prices');
    render();
  } catch (err) {
    const msg = err instanceof FetchError ? err.message : 'Prices failed to load.';
    if (!last) body.innerHTML = errorBlock(`No price data right now. ${msg}`);
  }
  body.setAttribute('aria-busy', 'false');
  renderUpdated($('prices-updated'), last);
}

export function initPrices(): void {
  const body = $('prices-body');
  body.innerHTML = loadingBlock('Fetching the Nord Pool day-ahead prices…');
  const again = poll(refresh, 5 * 60_000);

  body.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest('[data-retry]')) return again();
    const tab = t.closest<HTMLElement>('[data-day]');
    if (tab) {
      dayIdx = Number(tab.dataset.day);
      cursor = -1;
      render();
      body.querySelector<HTMLElement>(`[data-day="${dayIdx}"]`)?.focus();
    }
  });
  body.addEventListener('keydown', (ev) => {
    const chartEl = (ev.target as HTMLElement).closest<HTMLElement>('.chart');
    const tab = (ev.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    const days = last?.data.days ?? [];
    if (tab && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && days.length > 1) {
      ev.preventDefault();
      dayIdx = (dayIdx + (ev.key === 'ArrowRight' ? 1 : days.length - 1)) % days.length;
      cursor = -1;
      render();
      body.querySelector<HTMLElement>(`[data-day="${dayIdx}"]`)?.focus();
      return;
    }
    if (!chartEl) return;
    const day = days[dayIdx];
    if (!day) return;
    const n = day.slots.length;
    const start = cursor >= 0 ? cursor : Math.max(0, slotAt(day, serverNow()));
    let next = -2;
    if (ev.key === 'ArrowRight') next = Math.min(n - 1, start + (cursor < 0 ? 0 : 1));
    else if (ev.key === 'ArrowLeft') next = Math.max(0, start - (cursor < 0 ? 0 : 1));
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = n - 1;
    else if (ev.key === 'Escape') next = -1;
    if (next === -2) return;
    ev.preventDefault();
    cursor = next;
    paintCursor();
  });
  body.addEventListener('pointermove', (ev) => {
    const chartEl = (ev.target as HTMLElement).closest<HTMLElement>('.chart');
    if (chartEl) onChartInput(ev.clientX, chartEl);
  });
  body.addEventListener('pointerleave', () => {
    if (cursor !== -1 && document.activeElement?.closest('.chart') == null) {
      cursor = -1;
      paintCursor();
    }
  });
  // Redraw each minute so the "now" line and slot move without a refetch.
  window.setInterval(() => {
    if (last && !document.hidden && document.activeElement?.closest('#prices-body') == null) render();
    renderUpdated($('prices-updated'), last);
  }, 60_000);
}
