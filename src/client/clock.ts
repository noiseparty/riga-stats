import { $, serverNow } from './util';

const timeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Riga',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const tzFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', timeZoneName: 'short' });

function tzName(t: number): string {
  const name = tzFmt.formatToParts(t).find((p) => p.type === 'timeZoneName')?.value ?? '';
  // en-GB renders Riga as "EET"/"EEST" on most engines and "GMT+2"/"GMT+3" on others.
  if (name === 'GMT+2') return 'EET · UTC+2';
  if (name === 'GMT+3') return 'EEST · UTC+3';
  return name;
}

export function initClock(): void {
  const timeEl = $('clock-time');
  const dateEl = $('clock-date');
  const tzEl = $('clock-tz');
  let lastDate = '';

  const tick = () => {
    const now = serverNow();
    const [h, m, s] = timeFmt.format(now).split(':');
    timeEl.innerHTML = `${h}:${m}<span>:${s}</span>`;
    timeEl.setAttribute('aria-label', `${h}:${m} in Riga`);
    const d = dateFmt.format(now);
    if (d !== lastDate) {
      lastDate = d;
      dateEl.textContent = d;
      tzEl.textContent = tzName(now);
    }
    // Align to the next whole second so the display never skips or doubles a second.
    window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  tick();
}
