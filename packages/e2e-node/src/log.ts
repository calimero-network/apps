import type { ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";

// Both streams feed one file, so neither may end it: the first to close would
// make the other's next chunk a write-after-end. Close it once the process is done.
export function pipeToLog(proc: ChildProcess, file: string): WriteStream {
  const log = createWriteStream(file);
  proc.stdout?.pipe(log, { end: false });
  proc.stderr?.pipe(log, { end: false });
  proc.once("close", () => log.end());
  return log;
}
