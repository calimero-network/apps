// A write returns the character ids it minted, and the event it causes carries
// the same ids. Anything not fully covered by what we minted is treated as
// remote: a missed echo costs one re-read, a wrong echo loses a peer's edit.

/** A run of character ids, as the backend reports them. */
export interface Run {
  replica: string;
  counter: number;
  len: number;
}

const DEFAULT_LIMIT = 512; // runs retained; one local write is a handful

export class EchoGuard {
  private readonly minted: Run[] = [];

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /** Record the runs a local write returned. */
  remember(runs: Run[]): void {
    for (const run of runs) {
      if (run.len > 0) this.minted.push(run);
    }
    if (this.minted.length > this.limit) {
      this.minted.splice(0, this.minted.length - this.limit);
    }
  }

  /** True only when every run in the event came from a write of ours. */
  isEcho(runs: Run[]): boolean {
    return runs.length > 0 && runs.every((run) => this.covers(run));
  }

  private covers(run: Run): boolean {
    if (run.len <= 0) return false;
    const end = run.counter + run.len;
    let reached = run.counter;
    const ours = this.minted
      .filter((m) => m.replica === run.replica)
      .sort((a, b) => a.counter - b.counter);
    for (const mine of ours) {
      if (mine.counter > reached) break;
      reached = Math.max(reached, mine.counter + mine.len);
      if (reached >= end) return true;
    }
    return false;
  }
}
