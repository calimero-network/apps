import { appendFileSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { meshTotals } from "./rig";

const ESC = String.fromCharCode(27);

function summary(total: number): string {
  return (
    `${ESC}[2m2026-09-30T17:26:35.327Z${ESC}[0m ${ESC}[34mDEBUG${ESC}[0m ` +
    `${ESC}[2mcalimero_node::manager::startup${ESC}[0m${ESC}[2m:${ESC}[0m gossipsub mesh summary ` +
    `${ESC}[3mtopics${ESC}[0m${ESC}[2m=${ESC}[0m4 ${ESC}[3mtotal_mesh_peers${ESC}[0m${ESC}[2m=${ESC}[0m${total}\n`
  );
}

describe("meshTotals", () => {
  it("reads total_mesh_peers from coloured summary lines, from an offset on", () => {
    const log = path.join(mkdtempSync(path.join(tmpdir(), "e2e-node-")), "node.log");
    writeFileSync(log, summary(4) + "INFO something else\n");
    expect(meshTotals(log)).toEqual([4]);

    const offset = statSync(log).size;
    appendFileSync(log, summary(0) + summary(3));
    expect(meshTotals(log)).toEqual([4, 0, 3]);
    expect(meshTotals(log, offset)).toEqual([0, 3]);
  });

  it("is empty for a missing log", () => {
    expect(meshTotals(path.join(tmpdir(), "no-such-node.log"))).toEqual([]);
  });
});
