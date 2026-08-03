#!/usr/bin/env python3
"""
Mero Stream load generator — P3, the failure curve.

Drives `encode_frame` at rising fps and geometry until something breaks, and
emits one CSV row per (geometry, fps) step. The CSV is the Task-3 deliverable:
"a node sustains N KiB/s of fragment traffic at M fps across K peers before
<metric> degrades", with the first bottleneck named.

This is deliberately a separate driver from the browser route. The frontend
measures what a real capture loop experiences (and is the only thing that can
measure end-to-end render latency); this measures how hard a node can be pushed,
with no camera, no canvas and no React in the way.

Usage (against the two nodes `make dev-nodes` leaves running):

    scripts/load-curve.py \\
        --node-url http://localhost:2660 \\
        --context-id <ctx> \\
        --executor-key <sender pk> \\
        --peer-url http://localhost:2661 \\
        --peer-executor-key <peer pk> \\
        --peer-container calimero-node-2 \\
        --out load-curve.csv

Only --node-url, --context-id and --executor-key are required. Supplying the
peer flags adds receive-side coverage (does the far node actually see the
frames), and --peer-container adds RocksDB growth by shelling into the
container — the C3 tombstone slope, which no node metric exposes today.

Stdlib only, so it runs anywhere python3 does with no install step.
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request

# ── Break conditions ─────────────────────────────────────────────────────────
# A step "breaks" when the node demonstrably cannot keep up. Both of these are
# about the SENDER failing to sustain the offered load, which is the honest
# reading of "how much can it take" — a step that merely gets slow is still a
# valid data point and stays in the CSV.
#
# Deliberately NOT a break condition: high latency. The task doc expects latency
# to be unusable (that is RESEARCH-01's whole point); stopping the ramp on it
# would truncate the curve right where it gets interesting.
ACHIEVED_FPS_FLOOR = 0.5   # achieved < 50% of target ⇒ cannot sustain
ERROR_RATE_CEILING = 0.10  # >10% of mutations rejected ⇒ backpressure


def rpc(url: str, context_id: str, executor: str, method: str, args: dict, timeout: float):
    """One JSON-RPC `execute`. Returns (output, error_string, elapsed_ms).

    Never raises for a call-level failure: at the top of the ramp failures ARE
    the measurement, so a transport error or a guest panic has to become a data
    point rather than a traceback.
    """
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": "1",
            "method": "execute",
            "params": {
                "contextId": context_id,
                "method": method,
                "argsJson": args,
                "executorPublicKey": executor,
            },
        }
    ).encode()
    req = urllib.request.Request(
        f"{url}/jsonrpc", data=payload, headers={"Content-Type": "application/json"}
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = json.load(resp)
        elapsed = (time.monotonic() - started) * 1000
        if "error" in body:
            return None, json.dumps(body["error"])[:200], elapsed
        return body.get("result", {}).get("output"), None, elapsed
    except (urllib.error.URLError, OSError, json.JSONDecodeError, TimeoutError) as exc:
        return None, f"{type(exc).__name__}: {exc}"[:200], (time.monotonic() - started) * 1000


def synthetic_frame(width: int, height: int, seq: int) -> list[int]:
    """A quant-aligned luma frame that CHANGES with `seq`.

    Quant-aligned ((q<<4)|q) so the codec round-trips bit-identically, matching
    what the unit tests and the e2e assert.

    Changing per frame matters more than it looks: a constant frame RLE-compresses
    to a couple of bytes, so a ramp driven with one would report a compression
    ratio and a delta size that no real capture could ever reproduce — the curve
    would be measuring the generator, not the node. The diagonal gradient below
    keeps run lengths short and realistic.
    """
    frame = []
    for y in range(height):
        for x in range(width):
            q = (x + y + seq) % 16
            frame.append((q << 4) | q)
    return frame


def store_bytes(container: str) -> int | None:
    """On-disk size of a merobox node's data dir, via `du` inside the container.

    §2d of the cross-repo plan wants RocksDB growth over a sustained run to chart
    the C3 tombstone slope. Core exposes no such metric (its only process gauges
    are linux-only RSS/FD counters), so we measure it from outside. Returns None
    if docker or the container is unavailable — a missing column beats a fake one.
    """
    for path in ("/app/data", "/data", "/root/.calimero"):
        try:
            # check=False is explicit: a container without this path is the normal
            # case (we probe three candidates), so a non-zero exit is data, not an
            # error to raise on.
            out = subprocess.run(
                ["docker", "exec", container, "du", "-sb", path],
                capture_output=True, text=True, timeout=30, check=False,
            )
            if out.returncode == 0 and out.stdout.strip():
                return int(out.stdout.split()[0])
        except (subprocess.SubprocessError, OSError, ValueError):
            continue
    return None


def run_step(args, width: int, height: int, target_fps: float) -> dict:
    """Drive one (geometry, fps) step for --step-seconds and summarize it."""
    period = 1.0 / target_fps
    deadline = time.monotonic() + args.step_seconds
    raw_bytes_per_frame = width * height

    rtts: list[float] = []
    errors = 0
    sent = 0
    first_error = None
    seq_local = 0

    store_before = store_bytes(args.peer_container) if args.peer_container else None
    wall_start = time.monotonic()

    while time.monotonic() < deadline:
        slot = time.monotonic() + period
        frame = synthetic_frame(width, height, seq_local)
        seq_local += 1
        # `now` is unix MILLISECONDS for encode_frame — see Fragment::created_at.
        output, err, elapsed = rpc(
            args.node_url, args.context_id, args.executor_key, "encode_frame",
            {
                "raw": frame, "width": width, "height": height,
                "track": 0, "now": int(time.time() * 1000),
            },
            args.timeout,
        )
        sent += 1
        if err is not None or output is None:
            errors += 1
            if first_error is None:
                first_error = err or "null output"
        else:
            rtts.append(elapsed)
        # Hold the offered cadence. If the call already overran the slot we do NOT
        # sleep — the node is the bottleneck at that point, and achieved_fps
        # falling below target is precisely the signal we are ramping to find.
        remaining = slot - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)

    wall = time.monotonic() - wall_start
    ok = sent - errors
    achieved_fps = ok / wall if wall > 0 else 0.0

    stats, stats_err, _ = rpc(
        args.node_url, args.context_id, args.executor_key, "get_stats", {}, args.timeout
    )
    stats = stats if isinstance(stats, dict) else {}

    # Receive-side coverage: did the far node actually see them? A sender that
    # keeps up while the peer sees nothing is the most important failure this
    # harness can catch, and it is invisible from the sending node alone.
    peer_live = peer_next_seq = None
    if args.peer_url and args.peer_executor_key:
        peer_stats, _, _ = rpc(
            args.peer_url, args.context_id, args.peer_executor_key, "get_stats", {}, args.timeout
        )
        if isinstance(peer_stats, dict):
            peer_live = peer_stats.get("liveFragments")
            peer_next_seq = peer_stats.get("nextSeq")

    store_after = store_bytes(args.peer_container) if args.peer_container else None

    return {
        "width": width,
        "height": height,
        "raw_bytes_per_frame": raw_bytes_per_frame,
        "target_fps": target_fps,
        "achieved_fps": round(achieved_fps, 3),
        "raw_bytes_per_sec": round(achieved_fps * raw_bytes_per_frame, 1),
        "frames_sent": sent,
        "frames_ok": ok,
        "errors": errors,
        "error_rate": round(errors / sent, 4) if sent else 0.0,
        "encode_rtt_p50_ms": round(statistics.median(rtts), 2) if rtts else "",
        "encode_rtt_p95_ms": round(sorted(rtts)[min(len(rtts) - 1, int(0.95 * len(rtts)))], 2) if rtts else "",
        "encode_rtt_max_ms": round(max(rtts), 2) if rtts else "",
        "live_fragments": stats.get("liveFragments", ""),
        "next_seq": stats.get("nextSeq", ""),
        "pruned_frames": stats.get("prunedFrames", ""),
        "peer_live_fragments": peer_live if peer_live is not None else "",
        "peer_next_seq": peer_next_seq if peer_next_seq is not None else "",
        "store_bytes_before": store_before if store_before is not None else "",
        "store_bytes_after": store_after if store_after is not None else "",
        "store_growth_bytes": (store_after - store_before)
        if (store_before is not None and store_after is not None)
        else "",
        "first_error": first_error or "",
        "stats_error": stats_err or "",
    }


def parse_geometries(spec: str) -> list[tuple[int, int]]:
    out = []
    for token in spec.split(","):
        w, _, h = token.strip().lower().partition("x")
        out.append((int(w), int(h)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node-url", required=True, help="Sending node RPC base, e.g. http://localhost:2660")
    ap.add_argument("--context-id", required=True)
    ap.add_argument("--executor-key", required=True, help="Sender's context member public key")
    ap.add_argument("--peer-url", help="Receiving node RPC base (adds receive-side columns)")
    ap.add_argument("--peer-executor-key", help="Peer's context member public key")
    ap.add_argument("--peer-container", help="Docker container name of a node, for RocksDB size sampling")
    ap.add_argument("--geometries", default="64x48,96x72,128x96",
                    help="Comma-separated WxH ladder (default: 64x48,96x72,128x96)")
    ap.add_argument("--fps", default="1,2,5,10,15",
                    help="Comma-separated fps ladder per geometry (default: 1,2,5,10,15)")
    ap.add_argument("--step-seconds", type=float, default=30.0, help="Seconds per ramp step (default 30)")
    ap.add_argument("--timeout", type=float, default=30.0, help="Per-RPC timeout in seconds")
    ap.add_argument("--out", default="load-curve.csv")
    ap.add_argument("--keep-ramping", action="store_true",
                    help="Do not stop a geometry's ladder at the first break (fills the whole grid)")
    args = ap.parse_args()

    geometries = parse_geometries(args.geometries)
    fps_ladder = [float(f) for f in args.fps.split(",")]

    rows: list[dict] = []
    print(f"Ramping {len(geometries)} geometries x {len(fps_ladder)} fps steps "
          f"@ {args.step_seconds}s each (~{len(geometries) * len(fps_ladder) * args.step_seconds / 60:.1f} min max)")

    for (width, height) in geometries:
        for target_fps in fps_ladder:
            label = f"{width}x{height} @ {target_fps} fps"
            print(f"\n▶ {label} ...", flush=True)
            row = run_step(args, width, height, target_fps)
            rows.append(row)
            print(f"  achieved {row['achieved_fps']} fps · "
                  f"encode p50 {row['encode_rtt_p50_ms']} ms / p95 {row['encode_rtt_p95_ms']} ms · "
                  f"errors {row['errors']}/{row['frames_sent']} · "
                  f"live {row['live_fragments']} · pruned {row['pruned_frames']}")
            if row["first_error"]:
                print(f"  first error: {row['first_error']}")

            # Name the bottleneck the moment it shows, and say which condition
            # tripped — an unexplained early stop reads as "we covered the grid".
            broke = None
            if row["achieved_fps"] < target_fps * ACHIEVED_FPS_FLOOR:
                broke = (f"achieved {row['achieved_fps']} fps < "
                         f"{ACHIEVED_FPS_FLOOR:.0%} of {target_fps} target — sender cannot sustain")
            elif row["error_rate"] > ERROR_RATE_CEILING:
                broke = f"error rate {row['error_rate']:.1%} > {ERROR_RATE_CEILING:.0%} — mutations rejected"

            if broke:
                print(f"  ⚠ BREAK at {label}: {broke}")
                if not args.keep_ramping:
                    print(f"  → skipping the rest of the {width}x{height} fps ladder "
                          f"(pass --keep-ramping to fill the grid anyway)")
                    break

    if not rows:
        print("No steps ran.", file=sys.stderr)
        return 1

    with open(args.out, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n✓ {len(rows)} rows → {args.out}")
    if not args.peer_url:
        print("  note: no --peer-url, so the receive-side columns are empty — "
              "this run says nothing about whether frames actually crossed the wire")
    if not args.peer_container:
        print("  note: no --peer-container, so store-growth columns are empty — "
              "the C3 tombstone slope was NOT measured")
    return 0


if __name__ == "__main__":
    sys.exit(main())
