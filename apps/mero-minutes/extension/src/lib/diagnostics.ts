/**
 * A short log of what the recorder did, kept for the browser session only
 * (`storage.session`), so a person can copy it from Settings when a recording
 * goes wrong. It names steps, models and errors; never transcript text,
 * sessions or tokens.
 */
import { read, write } from "./storage";

export const LOG_KEY = "minutes:log";
const LIMIT = 300;

export async function log(message: string, now: Date = new Date()): Promise<void> {
  const lines = (await read<string[]>("session", LOG_KEY)) ?? [];
  lines.push(`${now.toISOString().slice(11, 23)} ${message}`);
  await write("session", LOG_KEY, lines.slice(-LIMIT));
}

export async function readLog(): Promise<string[]> {
  return (await read<string[]>("session", LOG_KEY)) ?? [];
}
