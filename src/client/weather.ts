import type { Envelope, WeatherPayload } from '../shared/types';
import { compass, describeCode } from '../shared/weather';
import { skyIcon } from './icons';
import { $, errorBlock, esc, FetchError, getJson, loadingBlock, poll, renderUpdated } from './util';

let last: Envelope<WeatherPayload> | null = null;

const t = (n: number) => `${Math.round(n)}°`;
const hourOf = (iso: string) => iso.slice(11, 16);
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dayName = (ymd: string, i: number) => (i === 0 ? 'Today' : dayFmt.format(new Date(`${ymd}T12:00:00Z`)));

function renderWeather(w: WeatherPayload): void {
  const c = w.current;
  const d = describeCode(c.code);
  const today = w.daily[0];

  // Temperature line across the hourly strip: scale to the strip's own range.
  const temps = w.hourly.map((h) => h.temp);
  const lo = Math.min(...temps);
  const hi = Math.max(...temps);
  const span = Math.max(1, hi - lo);
  const n = w.hourly.length;
  const pts = w.hourly.map((h, i) => `${((i + 0.5) / n) * 100},${28 - ((h.temp - lo) / span) * 22}`).join(' ');

  $('weather-body').innerHTML =
    `<div class="wx-now">` +
    `<div class="wx-icon">${skyIcon(d.sky, c.isDay, d.label)}</div>` +
    `<div><p class="wx-temp">${esc(t(c.temp))}</p><p class="label wx-label">${esc(d.label)}</p></div>` +
    `<dl class="meta wx-meta">` +
    `<dt>Feels like</dt><dd>${esc(t(c.feels))}</dd>` +
    `<dt>Wind</dt><dd>${esc(c.wind.toFixed(1))} m/s ${esc(compass(c.windDir))}</dd>` +
    `<dt>Humidity</dt><dd>${esc(Math.round(c.humidity))}%</dd>` +
    (today ? `<dt>Today</dt><dd>${esc(t(today.min))} / ${esc(t(today.max))}</dd>` : '') +
    `</dl></div>` +
    `<div class="hourly" tabindex="0" role="region" aria-label="Next 24 hours, hourly">` +
    `<div class="hourly-inner" style="--n:${n}"><ol class="hours">` +
    w.hourly
      .map((h, i) => {
        const hd = describeCode(h.code);
        return (
          `<li class="hour${i === 0 ? ' is-now' : ''}">` +
          `<span class="hour-t mono">${i === 0 ? 'Now' : esc(hourOf(h.time))}</span>` +
          skyIcon(hd.sky, h.isDay, hd.label) +
          `<span class="hour-temp">${esc(t(h.temp))}</span>` +
          `<span class="hour-pop mono">${h.pop !== null && h.pop >= 10 ? `${esc(h.pop)}%` : '&nbsp;'}</span>` +
          `</li>`
        );
      })
      .join('') +
    `</ol><svg class="hourly-line" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" vector-effect="non-scaling-stroke" /></svg></div></div>`;

  $('week-body').innerHTML =
    `<ol class="days">` +
    w.daily
      .map((day, i) => {
        const dd = describeCode(day.code);
        return (
          `<li class="day">` +
          `<span class="label day-n">${esc(dayName(day.date, i))}</span>` +
          skyIcon(dd.sky, true, dd.label) +
          `<span class="day-l mono small">${esc(dd.label)}</span>` +
          `<span class="day-t mono"><b>${esc(t(day.max))}</b> ${esc(t(day.min))}</span>` +
          `<span class="day-p mono small">${day.precip >= 0.1 ? `${esc(day.precip.toFixed(1))} mm` : ''}</span>` +
          `</li>`
        );
      })
      .join('') +
    `</ol>`;

  const sun = $('sun');
  sun.innerHTML = today
    ? `<dt>Sunrise</dt><dd>${esc(hourOf(today.sunrise))}</dd><dt>Sunset</dt><dd>${esc(hourOf(today.sunset))}</dd>`
    : '';
}

async function refresh(): Promise<void> {
  const body = $('weather-body');
  try {
    last = await getJson<WeatherPayload>('weather');
    renderWeather(last.data);
    body.setAttribute('aria-busy', 'false');
    $('week-body').setAttribute('aria-busy', 'false');
  } catch (err) {
    const msg = err instanceof FetchError ? err.message : 'Weather failed to load.';
    if (!last) {
      body.innerHTML = errorBlock(`No weather right now. ${msg}`);
      $('week-body').innerHTML = `<div class="state state-error"><p>Forecast unavailable.</p></div>`;
      body.setAttribute('aria-busy', 'false');
    }
  }
  renderUpdated($('weather-updated'), last);
}

export function initWeather(): void {
  $('weather-body').innerHTML = loadingBlock('Reading the sky over Riga…');
  const again = poll(refresh, 5 * 60_000);
  $('weather-body').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-retry]')) again();
  });
  window.setInterval(() => renderUpdated($('weather-updated'), last), 15_000);
}
