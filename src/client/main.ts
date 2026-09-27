import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';

import { initBoard } from './board';
import { initClock } from './clock';
import { initPrices } from './prices';
import { initWeather } from './weather';
import { $ } from './util';

/**
 * Wall-display mode: hides the page chrome and lets the grid fill the screen. Uses the
 * Fullscreen API where it exists (not on iPhone Safari), and works as a plain layout
 * toggle where it does not.
 */
function initKiosk(): void {
  const btn = $<HTMLButtonElement>('kiosk');
  const root = document.documentElement;
  const set = (on: boolean) => {
    root.classList.toggle('kiosk', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('.label')!.textContent = on ? 'Exit wall display' : 'Wall display';
  };
  btn.addEventListener('click', async () => {
    const on = !root.classList.contains('kiosk');
    set(on);
    try {
      if (on && !document.fullscreenElement && root.requestFullscreen) await root.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* fullscreen refused (iframe, iOS): the layout toggle still applies */
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && root.classList.contains('kiosk')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('kiosk') && !document.fullscreenElement) set(false);
  });
  if (new URLSearchParams(location.search).has('kiosk')) set(true);
}

initClock();
initKiosk();
void initBoard();
initWeather();
initPrices();
