// Per-IP and per-instance limits on every POST, the recipe from the old
// demo's api/generate.js (11/6/26). Best effort, in memory, per warm worker
// instance: it stops casual hammering. The hard backstop is the monthly
// spend cap in the Anthropic console plus the per-user quota in quota.ts.
export class RateLimiter {
  private perIp = new Map<string, number[]>();
  private perInstance: number[] = [];

  constructor(
    private windowMs = 60 * 60 * 1000,
    private ipLimit = 120,
    private instanceLimit = 2000,
  ) {}

  // true = over the limit, refuse.
  check(ip: string, now: number): boolean {
    const cutoff = now - this.windowMs;
    this.perInstance = this.perInstance.filter((t) => t > cutoff);
    if (this.perInstance.length >= this.instanceLimit) return true;
    const hits = (this.perIp.get(ip) ?? []).filter((t) => t > cutoff);
    if (hits.length >= this.ipLimit) {
      this.perIp.set(ip, hits);
      return true;
    }
    hits.push(now);
    this.perIp.set(ip, hits);
    this.perInstance.push(now);
    if (this.perIp.size > 10000) this.perIp.clear(); // never grow without bound
    return false;
  }
}
