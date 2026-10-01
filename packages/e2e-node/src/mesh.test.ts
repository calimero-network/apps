import { appendFileSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { meshSnapshots } from "./rig";

const ESC = String.fromCharCode(27);
const PREFIX = `${ESC}[2m2026-10-01T11:07:26.329Z${ESC}[0m ${ESC}[34mDEBUG${ESC}[0m ${ESC}[2mcalimero_node::manager::startup${ESC}[0m${ESC}[2m:${ESC}[0m`;

function snapshot(topics: Record<string, number>): string {
  const sizes = Object.entries(topics).map(
    ([topic, peers]) =>
      `${PREFIX} gossipsub mesh size ${ESC}[3mtopic${ESC}[0m${ESC}[2m=${ESC}[0m${topic} ${ESC}[3mmesh_peers${ESC}[0m${ESC}[2m=${ESC}[0m${peers}\n`,
  );
  const total = Object.values(topics).reduce((a, b) => a + b, 0);
  return sizes.join("") + `${PREFIX} gossipsub mesh summary topics=${sizes.length} total_mesh_peers=${total}\n`;
}

describe("meshSnapshots", () => {
  it("groups coloured per-topic mesh sizes by summary, from an offset on", () => {
    const log = path.join(mkdtempSync(path.join(tmpdir(), "e2e-node-")), "node.log");
    writeFileSync(log, snapshot({ "ns/aa": 1, ctx1: 1 }) + "INFO something else\n");
    expect(meshSnapshots(log)).toEqual([
      new Map([
        ["ns/aa", 1],
        ["ctx1", 1],
      ]),
    ]);

    const offset = statSync(log).size;
    appendFileSync(log, snapshot({ ctx1: 0, "ns/aa": 0 }) + snapshot({ ctx1: 1, "ns/aa": 0 }));
    expect(meshSnapshots(log)).toHaveLength(3);
    expect(meshSnapshots(log, offset).map((s) => s.get("ctx1"))).toEqual([0, 1]);
  });

  it("is empty for a missing log", () => {
    expect(meshSnapshots(path.join(tmpdir(), "no-such-node.log"))).toEqual([]);
  });
});
