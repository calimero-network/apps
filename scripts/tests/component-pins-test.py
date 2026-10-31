#!/usr/bin/env python3
"""check-component-pins.py catches every way a component crate drifts off the core tag."""

import pathlib
import subprocess
import sys
import tempfile

CHECK = pathlib.Path(__file__).resolve().parents[1] / "check-component-pins.py"

ROOT_TOML = """
[workspace]
members = ["apps/*/logic"]
exclude = [{exclude}]
[workspace.metadata.mero-apps]
component-core-tag = "1.0.0-rc.7"
component-min-runtime-version = "1.0.0-rc.7"
"""

APP = """
[package]
name = "kv-store"
version = "0.1.0"
[dependencies]
calimero-app-sdk = {{ git = "https://github.com/calimero-network/core", {pin} }}
[target.'cfg(not(target_arch = "wasm32"))'.dev-dependencies]
calimero-app-build = {{ git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.7" }}
serde_json = "1"
[package.metadata.calimero]
package = "com.calimero.kv-store"
min-runtime-version = "{runtime}"
{workspace}
"""

V1 = """
[package]
name = "chat"
[dependencies]
calimero-sdk.workspace = true
"""


def run(pin='tag = "1.0.0-rc.7"', runtime="1.0.0-rc.7", workspace="[workspace]", exclude='"apps/kv-store/logic"'):
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "Cargo.toml").write_text(ROOT_TOML.format(exclude=exclude))
        for app, body in (("kv-store", APP.format(pin=pin, runtime=runtime, workspace=workspace)), ("chat", V1)):
            (root / "apps" / app / "logic").mkdir(parents=True)
            (root / "apps" / app / "logic" / "Cargo.toml").write_text(body)
        r = subprocess.run([sys.executable, str(CHECK), str(root)], capture_output=True, text=True)
        return r.returncode, r.stdout


code, out = run()
assert code == 0, out
assert "kv-store" in out and "chat" not in out, out

code, out = run(pin='tag = "1.0.0-rc.6"')
assert code == 1 and "pins 1.0.0-rc.6" in out, out

code, out = run(pin='branch = "master"')
assert code == 1 and "pins master" in out, out

code, out = run(runtime="1.0.0-rc.6")
assert code == 1 and "min-runtime-version" in out, out

code, out = run(workspace="")
assert code == 1 and "own workspace root" in out, out

code, out = run(exclude="")
assert code == 1 and "does not exclude apps/kv-store/logic" in out, out

print("ok")
