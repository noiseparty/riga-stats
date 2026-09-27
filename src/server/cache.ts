/**
 * A tiny read-through cache with three properties the board depends on:
 *
 *  1. At most one upstream request per key per TTL, however many visitors are watching.
 *  2. Concurrent misses share one in-flight request instead of stampeding upstream.
 *  3. Stale-while-error: if a refresh fails, the last good value is served, flagged stale,
 *     for up to `staleFor` ms. After a failure the key backs off for `retryAfterError`
 *     ms so a dead upstream is not hammered on every request.
 */

export interface CacheResult<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

interface Entry<T> {
  value?: T;
  fetchedAt: number;
  expires: number;
  retryAt: number;
  inflight?: Promise<CacheResult<T>>;
  lastUsed: number;
}

export interface CacheOptions {
  ttl: number;
  staleFor: number;
  retryAfterError?: number;
  maxKeys?: number;
  now?: () => number;
}

export class UpstreamError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
  }
}

export class SwrCache<T> {
  private entries = new Map<string, Entry<T>>();
  private readonly now: () => number;

  constructor(private readonly opts: CacheOptions) {
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  async get(key: string, load: () => Promise<T>): Promise<CacheResult<T>> {
    const now = this.now();
    let e = this.entries.get(key);
    if (e) e.lastUsed = now;

    if (e && e.value !== undefined && now < e.expires) {
      return { value: e.value, fetchedAt: e.fetchedAt, stale: false };
    }
    if (e?.inflight) return e.inflight;

    // Backing off after a failure: serve stale if we have it, otherwise fail fast.
    if (e && now < e.retryAt) {
      if (e.value !== undefined && now - e.fetchedAt < this.opts.staleFor) {
        return { value: e.value, fetchedAt: e.fetchedAt, stale: true };
      }
      throw new UpstreamError('upstream recently failed');
    }

    if (!e) {
      this.evict();
      e = { fetchedAt: 0, expires: 0, retryAt: 0, lastUsed: now };
      this.entries.set(key, e);
    }
    const entry = e;
    entry.inflight = (async () => {
      try {
        const value = await load();
        const t = this.now();
        entry.value = value;
        entry.fetchedAt = t;
        entry.expires = t + this.opts.ttl;
        entry.retryAt = 0;
        return { value, fetchedAt: t, stale: false };
      } catch (err) {
        const t = this.now();
        entry.retryAt = t + (this.opts.retryAfterError ?? Math.min(this.opts.ttl, 30000));
        if (entry.value !== undefined && t - entry.fetchedAt < this.opts.staleFor) {
          return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true };
        }
        if (entry.value === undefined) {
          // Keep the failure marker (for backoff) but do not let it pin memory forever.
          entry.lastUsed = t;
        }
        throw err;
      } finally {
        entry.inflight = undefined;
      }
    })();
    return entry.inflight;
  }

  private evict(): void {
    const max = this.opts.maxKeys ?? 500;
    if (this.entries.size < max) return;
    let oldestKey: string | undefined;
    let oldest = Infinity;
    for (const [k, v] of this.entries) {
      if (!v.inflight && v.lastUsed < oldest) {
        oldest = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) this.entries.delete(oldestKey);
  }
}
