// In-memory cache on a Map, limited by bytes (not by count, no TTL). Over budget, the least requested
// entries leave first (LFU); hit counts halve every 10 minutes so old popularity fades.
// Values are already-compressed responses keyed by version (project rev), so an entry is never stale:
// a change bumps the version and the old entry is deleted at once.
type Entry<T> = { value: T; size: number; hits: number; last: number };

export class ByteLFU<T = unknown> {
  private bytes = 0;
  private map = new Map<string, Entry<T>>();
  private loading = new Map<string, Promise<T>>(); // one load per key, however many requests wait
  readonly stats = { hits: 0, misses: 0, evicted: 0 };

  constructor(private max: number, decayMs = 10 * 60_000) {
    setInterval(() => {
      for (const e of this.map.values()) e.hits = Math.max(1, e.hits >> 1);
    }, decayMs).unref();
  }

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    e.hits++;
    e.last = Date.now();
    this.stats.hits++;
    return e.value;
  }

  set(key: string, value: T, size: number): T {
    if (size > this.max / 8) return value; // one huge item must not flush everything
    const old = this.map.get(key);
    if (old) this.bytes -= old.size;
    this.map.set(key, { value, size, hits: old?.hits ?? 1, last: Date.now() });
    this.bytes += size;
    if (this.bytes > this.max) this.shrink(0.85);
    return value;
  }

  delete(key: string) {
    const e = this.map.get(key);
    if (!e) return;
    this.bytes -= e.size;
    this.map.delete(key);
  }

  async getOrLoad(key: string, loader: () => Promise<{ value: T; size: number }>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const pending = this.loading.get(key);
    if (pending) return pending;
    this.stats.misses++;
    const p = loader()
      .then((r) => this.set(key, r.value, r.size))
      .finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  shrink(ratio: number) {
    const target = this.max * ratio;
    if (this.bytes <= target) return;
    const order = [...this.map.entries()].sort((a, b) => a[1].hits - b[1].hits || a[1].last - b[1].last);
    for (const [key, e] of order) {
      if (this.bytes <= target) break;
      this.map.delete(key);
      this.bytes -= e.size;
      this.stats.evicted++;
    }
  }

  info() {
    const { hits, misses } = this.stats;
    return {
      entries: this.map.size,
      mb: +(this.bytes / 2 ** 20).toFixed(1),
      maxMb: Math.round(this.max / 2 ** 20),
      ...this.stats,
      hitRate: hits + misses ? +(hits / (hits + misses)).toFixed(3) : 0,
    };
  }
}
