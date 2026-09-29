import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pipeToLog } from "./log";

describe("pipeToLog", () => {
  it("keeps the log open for stderr after stdout has closed", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "e2e-node-")), "node.log");
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });

    const log = pipeToLog(proc as unknown as ChildProcess, file);
    const closed = new Promise<void>((r) => log.once("close", () => r()));
    proc.stdout.end("out\n");
    await new Promise((r) => setTimeout(r, 50));
    proc.stderr.write("late\n");
    proc.stderr.end();
    proc.emit("close");
    await closed;

    expect(readFileSync(file, "utf8")).toBe("out\nlate\n");
  });
});
