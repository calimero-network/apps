/**
 * Speech waiting for the model, one stretch at a time, oldest first across
 * both sources, and whether the model keeps up with the conversation.
 */
import type { Chunk } from "./segmenter";
import type { Speaker } from "./queue";
import { fallingBehind } from "./tiers";

export interface Job extends Chunk {
  id: number;
  speaker: Speaker;
}

export class Scheduler {
  private jobs: Job[] = [];
  private nextId = 1;
  private busy: Job | null = null;
  /** Seconds of compute per second of speech, smoothed. */
  realtime = 0;
  private samples = 0;

  enqueue(chunk: Chunk, speaker: Speaker): Job {
    const job = { ...chunk, speaker, id: this.nextId++ };
    this.jobs.push(job);
    this.jobs.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
    return job;
  }

  /** The next stretch to send, if the model is free. */
  take(): Job | null {
    if (this.busy) return null;
    const job = this.jobs.shift() ?? null;
    this.busy = job;
    return job;
  }

  /** The model answered `id` after `ms`. Returns the job. */
  done(id: number, ms: number): Job | null {
    const job = this.busy;
    if (!job || job.id !== id) return null;
    this.busy = null;
    const audioMs = Math.max(1, job.endMs - job.startMs);
    const factor = ms / audioMs;
    this.samples += 1;
    // The first answers include warm-up; weigh later ones more.
    const weight = this.samples < 3 ? 0.5 : 0.25;
    this.realtime = this.samples === 1 ? factor : this.realtime + (factor - this.realtime) * weight;
    return job;
  }

  /** Puts a stretch back at the front (the model is being replaced). */
  requeueBusy(): void {
    if (this.busy) this.jobs.unshift(this.busy);
    this.busy = null;
  }

  /** Seconds of speech waiting, including the one being transcribed. */
  get backlogSec(): number {
    const all = this.busy ? [this.busy, ...this.jobs] : this.jobs;
    return all.reduce((s, j) => s + (j.endMs - j.startMs), 0) / 1000;
  }

  /** Whether a stretch is with the model now. */
  get working(): boolean {
    return this.busy !== null;
  }

  get idle(): boolean {
    return !this.busy && this.jobs.length === 0;
  }

  /** Whether to move to a lighter model: only after a few answers, so a slow first one doesn't count. */
  behind(): boolean {
    return this.samples >= 3 && fallingBehind(this.backlogSec, this.realtime);
  }

  /** Forget the speed measured so far (a new model). */
  resetSpeed(): void {
    this.realtime = 0;
    this.samples = 0;
  }
}
