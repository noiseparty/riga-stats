import type { IncomingMessage } from 'node:http';

/**
 * Per-IP token bucket, in memory. One process serves the app, so memory is the right
 * store; if it were ever scaled out this would need to move.
 */
export class TokenBuckets {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly maxKeys = 10000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes one token. Returns 0 if allowed, otherwise seconds until one is available. */
  take(key: string): number {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.sweep(now);
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
      b.at = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerSec));
  }

  private sweep(now: number): void {
    const fullAfterMs = (this.capacity / this.refillPerSec) * 1000;
    for (const [k, b] of this.buckets) if (now - b.at > fullAfterMs) this.buckets.delete(k);
    // Still full of active keys: drop the oldest insertions rather than grow without bound.
    while (this.buckets.size >= this.maxKeys) {
      const first = this.buckets.keys().next().value;
      if (first === undefined) break;
      this.buckets.delete(first);
    }
  }
}

/**
 * Caddy sets X-Forwarded-For to the real remote address and strips anything the client
 * sent, so its first entry is trustworthy here. Outside Caddy (local runs) fall back to
 * the socket.
 */
export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  if (first && first.length <= 64) return first;
  return req.socket.remoteAddress ?? 'unknown';
}
