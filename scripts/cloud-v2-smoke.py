#!/usr/bin/env python3
"""Deploy every app's contract to a local release-v2 cluster and report which run.

release-v2 runs the same WASM on the same runtime, replicated by Raft inside
attested nodes instead of synced peer to peer. This checks the claim app by app:
upload each bundle and create an app, which runs its `init` with the arguments in
cloud-v2-init-args.json (a failed init is a 422 INIT_FAILED). kv_store also
round-trips a write and a read.

Needs:
  - `merod-v2` from core's `release-v2` branch (MEROD_V2_BINARY, default ../core/target/debug/merod-v2)
  - calimero-client-py with `CloudClient` (its `release-v2` branch)
  - the contracts: cargo build --workspace --target wasm32-unknown-unknown --profile app-release

Usage: scripts/cloud-v2-smoke.py [--json out.json] [app.wasm ...]
Exit status is non-zero when an app that passed in BASELINE fails.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WASM_DIR = ROOT / "target/wasm32-unknown-unknown/app-release"
BINARY = os.environ.get("MEROD_V2_BINARY", str(ROOT.parent / "core/target/debug/merod-v2"))

# Contracts that deploy and initialise on release-v2 today. A regression here
# fails the run; an app that newly passes is reported so the list can grow.
BASELINE_FILE = Path(__file__).with_name("cloud-v2-baseline.json")
INIT_ARGS = json.loads(Path(__file__).with_name("cloud-v2-init-args.json").read_text())
# wasm in the target dir that is not a contract (a wasm-bindgen library for a frontend).
NOT_CONTRACTS = {"recalc_wasm"}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_cluster(n: int = 3) -> tuple[list[str], list[subprocess.Popen]]:
    ports = [free_port() for _ in range(n)]
    urls = [f"http://127.0.0.1:{p}" for p in ports]
    peers = ",".join(f"{i + 1}={u}/" for i, u in enumerate(urls))
    logs = None if os.environ.get("MEROD_V2_LOGS") else subprocess.DEVNULL
    procs = []
    for i, (port, url) in enumerate(zip(ports, urls, strict=True)):
        args = [BINARY, "--node-id", str(i + 1), "--listen", f"127.0.0.1:{port}"]
        args += ["--public-url", f"{url}/", "--data-dir", tempfile.mkdtemp(prefix="merod-v2-")]
        args += ["--peers", peers, "--cluster", "apps-smoke", "--dev"]
        args += ["--origins", "http://localhost:3000"]
        if i == 0:
            args.append("--bootstrap")
        procs.append(subprocess.Popen(args, stdout=logs, stderr=logs))
    deadline = time.time() + 30
    while True:
        try:
            with urllib.request.urlopen(f"{urls[0]}/health", timeout=1) as r:
                if json.load(r).get("systemLeader"):
                    break
        except OSError:
            pass
        if time.time() > deadline:
            raise SystemExit("cluster did not start")
        time.sleep(0.2)
    time.sleep(1.5)
    return urls, procs


def try_app(client, wasm: Path) -> dict:
    from calimero_client_py import CloudError

    out: dict = {"app": wasm.stem}
    try:
        bundle = client.upload_bundle(wasm.read_bytes())
        out["bundle"] = "ok"
        app = client.create_app(wasm.stem, bundle, {"initArgs": INIT_ARGS.get(wasm.stem)})
        out["init"] = "ok"
        # The reference app also round-trips a write and a read.
        if wasm.stem == "kv_store":
            client.call(app, "set", {"key": "smoke", "value": "1"})
            got = client.view(app, "get", {"key": "smoke"})["result"]
            if got != "1":
                raise CloudError(f"kv_store read back {got!r}", 0, "MISMATCH", "null")
            out["call"] = "ok"
    except CloudError as e:
        detail = json.loads(e.args[3] or "null") or {}
        why = (detail.get("error") or {}).get("error") if isinstance(detail, dict) else None
        out["error"] = f"{e.args[0]}: {why}" if why else e.args[0]
    out["ok"] = "error" not in out
    return out


def battleships_two_players(urls: list[str], wasm: Path) -> dict:
    """Two people in one lobby: each registers a distinct player key, and one
    challenges the other. Needs a distinct executor identity per caller."""
    from calimero_client_py import CloudClient, CloudError, SoftPasskey

    out: dict = {"app": "flow:battleships_two_players"}
    try:
        alice = CloudClient(urls[0], allow_mock=True)
        alice.sign_up(SoftPasskey(), "alice")
        bob = CloudClient(urls[1], allow_mock=True)
        bob.sign_up(SoftPasskey(), "bob")
        bob_id = bob.me()["accountId"]
        app = alice.create_app(
            "lobby",
            alice.upload_bundle(wasm.read_bytes()),
            {"access": {"kind": "accounts", "accounts": [bob_id]}},
        )
        a = alice.call(app, "register_player")["result"]
        b = bob.call(app, "register_player")["result"]
        if a == b:
            raise CloudError(f"both players registered the same key {a}", 0, "SAME_KEY", "null")
        alice.call(app, "create_match", {"player2": b})
    except CloudError as e:
        detail = json.loads(e.args[3] or "null") or {}
        why = detail.get("error") if isinstance(detail, dict) else None
        out["error"] = f"{e.args[0]}: {why}" if why else e.args[0]
    out["ok"] = "error" not in out
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wasm", nargs="*", type=Path)
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    from calimero_client_py import CloudClient, SoftPasskey

    files = args.wasm or sorted(f for f in WASM_DIR.glob("*.wasm") if f.stem not in NOT_CONTRACTS)
    if not files:
        raise SystemExit(f"no contracts in {WASM_DIR}; build them first")
    urls, procs = start_cluster()
    try:
        client = CloudClient(urls[0], allow_mock=True)
        client.sign_up(SoftPasskey(), "smoke")
        results = [try_app(client, f) for f in files]
        lobby = WASM_DIR / "battleships.wasm"
        if not args.wasm and lobby.exists():
            results.append(battleships_two_players(urls, lobby))
    finally:
        for p in procs:
            p.kill()
            p.wait()

    width = max(len(r["app"]) for r in results)
    for r in results:
        print(f"{r['app']:<{width}}  {'ok' if r['ok'] else 'FAIL'}  {r.get('error', '')}")
    if args.json:
        args.json.write_text(json.dumps(results, indent=2) + "\n")

    baseline = set(json.loads(BASELINE_FILE.read_text())) if BASELINE_FILE.exists() else set()
    passed = {r["app"] for r in results if r["ok"]}
    regressed = sorted(baseline & {r["app"] for r in results} - passed)
    newly = sorted(passed - baseline)
    print(f"\n{len(passed)}/{len(results)} deploy and initialise on release-v2")
    if newly:
        print("newly passing (add to cloud-v2-baseline.json):", ", ".join(newly))
    if regressed:
        print("REGRESSED:", ", ".join(regressed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
