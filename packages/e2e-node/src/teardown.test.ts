import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stopNodesAndRemove } from "./teardown";

// A stand-in for merod: it keeps writing under <dir>/data and, like rocksdb,
// takes a while to finish after SIGTERM.
const WRITER = `
const fs = require("node:fs");
const path = require("node:path");
const data = path.join(process.argv[1], "data");
let n = 0;
const write = () => { fs.mkdirSync(data, { recursive: true }); for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(data, String(n++)), "x"); };
const timer = setInterval(write, 1);
process.on("SIGTERM", () => setTimeout(() => { clearInterval(timer); process.exit(0); }, 400));
process.stdout.write("ready\\n");
`;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stopNodesAndRemove", () => {
  it("waits for a node that is still writing to exit, then removes its data dir", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "e2e-node-")), "pw");
    const child = spawn(process.execPath, ["-e", WRITER, dir], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r) => child.stdout.once("data", r));

    await stopNodesAndRemove([child.pid!], dir);

    expect(alive(child.pid!)).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });
});
