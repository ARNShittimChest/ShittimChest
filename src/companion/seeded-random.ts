/**
 * Seedable Pseudo-Random Number Generator.
 *
 * Uses the Mulberry32 algorithm for fast, deterministic random number
 * generation. Same seed always produces the same sequence — enabling
 * reproducible scheduling behavior across restarts.
 *
 * Used by proactive and health schedulers to replace Math.random()
 * with deterministic daily-seeded randomness.
 */

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1) — drop-in replacement for Math.random() */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Pick a random element from a non-empty array */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}

/**
 * Create a daily seed from a date.
 * Same calendar day always produces the same seed, ensuring
 * deterministic scheduling within a single day.
 */
export function dailySeed(date: Date = new Date()): number {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return (y * 10000 + m * 100 + d) | 0;
}
