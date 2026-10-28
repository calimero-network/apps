#!/usr/bin/env bash
# Runs publish-bundle.sh end to end against a local stub of the registry and storage.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'kill "${stub:-}" 2>/dev/null || true; rm -rf "$work"' EXIT

cat >"$work/stub.py" <<'PY'
import http.server, json, os, sys

out, push_status = sys.argv[1], int(sys.argv[2])


class H(http.server.BaseHTTPRequestHandler):
    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/api/v2/bundles/upload-url":
            grant = {
                "url": f"http://127.0.0.1:{self.server.server_port}/storage/obj-1?sig=secret",
                "object": "obj-1",
                "method": "PUT",
                "headers": {"Content-Type": "application/gzip", "x-goog-content-length-range": "0,99999"},
            }
            return self.reply(200, json.dumps(grant).encode())
        with open(f"{out}/push.json", "wb") as f:
            f.write(body)
        with open(f"{out}/push.auth", "w") as f:
            f.write(self.headers.get("Authorization", ""))
        self.reply(push_status, b'{"error":"stub rejected"}' if push_status >= 400 else b"{}")

    def do_PUT(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with open(f"{out}/put.bin", "wb") as f:
            f.write(body)
        with open(f"{out}/put.headers", "w") as f:
            f.write(str(self.headers))
        self.reply(200, b"")

    def log_message(self, *a):
        pass


s = http.server.HTTPServer(("127.0.0.1", 0), H)
print(s.server_port, flush=True)
s.serve_forever()
PY

mkdir "$work/pkg"
echo '{"package":"demo","version":"1.0.0"}' >"$work/pkg/manifest.json"
head -c 4096 /dev/urandom >"$work/pkg/payload"
tar -czf "$work/demo.mpk" -C "$work/pkg" manifest.json payload

# Starts the stub with a push status and exports URL and OUT for the run.
start_stub() {
  [ -z "${stub:-}" ] || kill "$stub" 2>/dev/null || true
  OUT="$work/out-$1"
  mkdir -p "$OUT"
  rm -f "$work/port"
  python3 "$work/stub.py" "$OUT" "$1" >"$work/port" &
  stub=$!
  until [ -s "$work/port" ]; do sleep 0.1; done
  port=$(cat "$work/port")
  export CALIMERO_REGISTRY_URL="http://127.0.0.1:$port"
}
export CALIMERO_API_KEY=test-key

fail() { echo "FAIL: $*" >&2; exit 1; }

start_stub 200
bash "$here/publish-bundle.sh" "$work/demo.mpk" >"$work/stdout" 2>&1 || { cat "$work/stdout"; fail "success path exited non-zero"; }
cmp "$work/demo.mpk" "$OUT/put.bin" || fail "PUT body differs from the archive"
grep -qi '^Content-Type: application/gzip' "$OUT/put.headers" || fail "PUT lacks Content-Type"
grep -qi '^x-goog-content-length-range: 0,99999' "$OUT/put.headers" || fail "PUT lacks x-goog-content-length-range"
! grep -qi '^Authorization:' "$OUT/put.headers" || fail "PUT carried Authorization"
[ "$(jq -r ._upload.object "$OUT/push.json")" = obj-1 ] || fail "push body lacks _upload.object"
[ "$(jq -r 'has("_binary")' "$OUT/push.json")" = false ] || fail "push body has _binary"
[ "$(jq -r .package "$OUT/push.json")" = demo ] || fail "push body lacks manifest fields"
[ "$(cat "$OUT/push.auth")" = "Bearer test-key" ] || fail "push lacks bearer auth"
! grep -qE 'secret|test-key' "$work/stdout" || fail "output leaks the signed URL or API key"

start_stub 422
if bash "$here/publish-bundle.sh" "$work/demo.mpk" >"$work/stdout" 2>&1; then fail "rejected push exited zero"; fi
grep -q 'stub rejected' "$work/stdout" || fail "rejected push did not print the response body"

if env -u CALIMERO_API_KEY bash "$here/publish-bundle.sh" "$work/demo.mpk" >"$work/stdout" 2>&1; then fail "unset API key exited zero"; fi
grep -q CALIMERO_API_KEY "$work/stdout" || fail "unset API key not named"

echo "publish-bundle.test.sh: ok"
