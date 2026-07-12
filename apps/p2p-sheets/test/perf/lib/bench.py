"""Node-side timing harness for the perf workflows. Wraps merobox's authenticated
node client with timed calls, chunked apply, derive, sync-poll, and a reporter."""
import json
import time

from merobox.commands.client import get_client_for_node, get_client_for_rpc_url

COLUMNS = ["size", "input_cells", "formula_cells", "apply_ms",
           "derive_active_ms", "derive_all_ms", "sync_ms", "correct"]


def chunked(seq, size):
    return [seq[i:i + size] for i in range(0, len(seq), size)]


def node_client(node_name):
    """Return an UNAUTHENTICATED client for a local merobox node.

    These local docker nodes don't enable embedded auth (no /auth/token → 404),
    so merobox's own steps talk to them with `node_name=None` (no token). A
    token-bound client (`get_client_for_node(name)`) instead demands a token the
    node has no way to issue and falls back to interactive auth, which hangs/fails
    in a non-interactive run. So: resolve the RPC URL (discard the throwaway
    token-bound client — creating it makes no network call), then build a
    no-token client with `node_name=None`.
    """
    _throwaway, rpc_url = get_client_for_node(node_name)
    return get_client_for_rpc_url(rpc_url, node_name=None)


def _output(res):
    """Normalize execute_function's return to the method's `output` payload.
    The client may return a dict {"output": ...} / {"result": {"output": ...}}
    or an object; unwrap defensively."""
    if isinstance(res, dict):
        if "output" in res:
            return res["output"]
        if "result" in res and isinstance(res["result"], dict):
            return res["result"].get("output", res["result"])
        return res
    return getattr(res, "output", res)


def timed_execute(client, cid, method, args):
    t0 = time.perf_counter()
    res = client.execute_function(context_id=cid, method=method, args=json.dumps(args))
    ms = (time.perf_counter() - t0) * 1000.0
    # A node-side failure comes back as a JSON-RPC error envelope, not an
    # exception. Raise it so a failed apply/derive can never silently produce a
    # wrong value (e.g. an "events overflow" apply that leaves the sheet empty,
    # which then reads back as a plausible-but-wrong 0).
    if isinstance(res, dict) and res.get("error"):
        raise RuntimeError(f"{method} failed: {res['error']}")
    return _output(res), ms


# The node caps events per commit (core runtime `max_events` = 100; the
# spreadsheet app emits ~1 event per cell op), so an apply_cell_ops batch larger
# than that fails with "events overflow". Chunk well under the cap.
APPLY_CHUNK = 40


def apply_ops(client, cid, sheet_id, ops, chunk_size=APPLY_CHUNK):
    """Apply ops via apply_cell_ops in commits of <= chunk_size (to stay under the
    node's per-commit event cap). Total wall-clock summed. Returns (ms, n_chunks)."""
    batches = chunked(ops, chunk_size) if chunk_size and len(ops) > chunk_size else [ops]
    total = 0.0
    for batch in batches:
        _, ms = timed_execute(client, cid, "apply_cell_ops",
                              {"sheet_id": sheet_id, "ops": batch})
        total += ms
    return total, len(batches)


def derive_active(client, cid, sheet_id):
    out, ms = timed_execute(client, cid, "get_cells", {"sheet_id": sheet_id})
    return out, ms


def derive_all(client, cid):
    out, ms = timed_execute(client, cid, "get_all_cells", {})
    return out, ms


def wait_converged(client2, cid, min_cells, timeout_s=60.0):
    """Poll node 2's get_all_cells until it reports >= min_cells. Returns ms."""
    t0 = time.perf_counter()
    while True:
        try:
            out, _ = timed_execute(client2, cid, "get_all_cells", {})
        except Exception:
            out = None  # node 2 may transiently error while catching up — retry
        if isinstance(out, list) and len(out) >= min_cells:
            return (time.perf_counter() - t0) * 1000.0
        if time.perf_counter() - t0 > timeout_s:
            raise TimeoutError(
                f"node 2 did not reach {min_cells} cells within {timeout_s}s "
                f"(saw {len(out) if isinstance(out, list) else out})")
        time.sleep(0.25)


def format_summary(rows):
    header = "| " + " | ".join(COLUMNS) + " |"
    sep = "| " + " | ".join("---" for _ in COLUMNS) + " |"
    lines = [header, sep]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(c, "")) for c in COLUMNS) + " |")
    return "\n".join(lines)
