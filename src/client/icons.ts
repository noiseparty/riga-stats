import type { Sky } from '../shared/weather';

/**
 * Line-drawn weather glyphs. Inline SVG, stroke = currentColor, so they take the card's
 * colour and need no icon font or image requests.
 */

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
const CLOUD = '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z"/>';
const SMALL_SUN = '<circle cx="8" cy="8" r="3"/><path d="M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7"/>';
const SMALL_MOON = '<path d="M11 9.5A4.5 4.5 0 0 1 6.5 4 4.5 4.5 0 1 0 11 9.5z"/>';
const CLOUD_LOW = '<path d="M8 19h9a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 13a3 3 0 0 0 0 6z"/>';

function wrap(body: string, label: string): string {
  return `<svg class="wx" viewBox="0 0 24 24" role="img" aria-label="${label}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function skyIcon(sky: Sky, isDay: boolean, label: string): string {
  switch (sky) {
    case 'clear':
      return wrap(isDay ? SUN : MOON, label);
    case 'partly':
      return wrap((isDay ? SMALL_SUN : SMALL_MOON) + CLOUD_LOW, label);
    case 'cloudy':
      return wrap(CLOUD, label);
    case 'fog':
      return wrap('<path d="M4 9h16M3 13h18M5 17h14"/>', label);
    case 'drizzle':
      return wrap('<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7a3.5 3.5 0 0 0 1 7z"/><path d="M9 18v1M13 18v1M17 18v1"/>', label);
    case 'rain':
      return wrap('<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7a3.5 3.5 0 0 0 1 7z"/><path d="M9 17l-1 3M13 17l-1 3M17 17l-1 3"/>', label);
    case 'snow':
      return wrap('<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7a3.5 3.5 0 0 0 1 7z"/><path d="M9 18h.01M13 19h.01M17 18h.01M11 21h.01M15 21h.01"/>', label);
    case 'storm':
      return wrap('<path d="M7 14h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 7a3.5 3.5 0 0 0 1 7z"/><path d="M12 14l-2 4h3l-2 4"/>', label);
  }
}
