import type { ApiError, Envelope } from '../shared/types';

export const API = `${import.meta.env.BASE_URL}api`;

/** Server clock minus local clock. Every response nudges it. */
let clockOffset = 0;
export const serverNow = (): number => Date.now() + clockOffset;

export class FetchError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
  }
}

export async function getJson<T>(path: string, timeoutMs = 10000): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  } catch {
    throw new FetchError('Could not reach the server. Check your connection; the board will retry.', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !body) {
    const msg = (body as ApiError | null)?.message ?? `The server answered ${res.status}.`;
    const ra = Number(res.headers.get('retry-after'));
    throw new FetchError(msg, res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  const env = body as Envelope<T>;
  if (typeof env.now === 'number') clockOffset = env.now - Date.now();
  return env;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const tf = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Riga', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const rigaHM = (t: number): string => tf.format(t);

export function ago(fetchedAt: number): string {
  const s = Math.max(0, Math.round((serverNow() - fetchedAt) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}

/** "Updated 12s ago", or a stale warning with the age of the data. */
export function renderUpdated(el: HTMLElement, env: { fetchedAt: number; stale: boolean } | null): void {
  if (!env) {
    el.textContent = '';
    el.classList.remove('is-stale');
    return;
  }
  el.classList.toggle('is-stale', env.stale);
  el.textContent = env.stale ? `Stale · source down · data from ${rigaHM(env.fetchedAt)}` : `Updated ${ago(env.fetchedAt)}`;
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function errorBlock(message: string, retryLabel = 'Try again'): string {
  return `<div class="state state-error" role="alert"><p>${esc(message)}</p><button type="button" class="btn-sm" data-retry>${esc(retryLabel)}</button></div>`;
}

export function loadingBlock(label: string): string {
  return `<div class="state state-loading"><span class="spinner" aria-hidden="true"></span><p>${esc(label)}</p></div>`;
}

/**
 * Polls `fn` every `ms`, pausing while the tab is hidden and catching up on return.
 * Returns a function that forces an immediate run.
 */
export function poll(fn: () => Promise<void>, ms: number): () => void {
  let timer = 0;
  let running = false;
  let again = false;
  const run = async (): Promise<void> => {
    window.clearTimeout(timer);
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await fn();
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      } else if (!document.hidden) {
        timer = window.setTimeout(run, ms);
      }
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void run();
    else window.clearTimeout(timer);
  });
  void run();
  return () => void run();
}
