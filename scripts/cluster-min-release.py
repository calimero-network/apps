#!/usr/bin/env python3
"""Print the lowest mero-tee release a Calimero Cloud cluster's nodes run now.

The publish workflow builds the frontend packed into a bundle with
VITE_CALIMERO_MIN_RELEASE, the attestation floor: the client refuses any node
whose signed mero-tee release is older. When the repository variable
CALIMERO_MIN_RELEASE is not set, the floor is what the cluster runs right now,
read from its public data, the same way mero-js reads it:

1. the node directory, GET {directory}/{cluster} -> {nodes: [{url, weight}]};
2. each node's attestation, GET {node}/attestation?nonce=<64 hex> ->
   {release: {version}} ("2.3.136", "v2.3.136" or "mero-tee-v2.3.136").

The LOWEST release among the nodes that answer is the floor, so a cluster
halfway through a rollout still passes. Not mero-tee's newest GitHub release:
that is published before the nodes roll to it, and a frontend built in that
window would refuse every node.

Prints the version on stdout; reasons on stderr; exits 1 when no node names a
release.
"""

import argparse
import json
import re
import secrets
import sys
import urllib.parse
import urllib.request

DEFAULT_DIRECTORY = "https://manager.cloud.calimero.network/api/v2/directory"
RELEASE_VERSION = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")


def release_version(raw):
    """The release a node names, as mero-js reads it, or None."""
    value = str(raw or "").strip()
    value = re.sub(r"^mero-tee-v", "", value)
    value = re.sub(r"^v", "", value)
    match = RELEASE_VERSION.match(value)
    if not match:
        return None
    pre = match.group(4)
    if pre is not None and any(part == "" for part in pre.split(".")):
        return None
    return value


def _ident_key(ident):
    # SemVer: numeric identifiers sort before alphanumeric ones.
    return (0, int(ident), "") if ident.isdigit() else (1, 0, ident)


def version_key(version):
    """A sort key in SemVer precedence (build metadata ignored)."""
    match = RELEASE_VERSION.match(version)
    core = tuple(int(match.group(i)) for i in (1, 2, 3))
    pre = match.group(4)
    if pre is None:
        return core + (1, ())
    return core + (0, tuple(_ident_key(i) for i in pre.split(".")))


def get_json(url, timeout):
    request = urllib.request.Request(url, headers={"accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def cluster_nodes(directory, cluster, timeout):
    url = f"{directory.rstrip('/')}/{urllib.parse.quote(cluster, safe='')}"
    body = get_json(url, timeout)
    nodes = []
    for entry in (body or {}).get("nodes") or []:
        if not isinstance(entry, dict):
            continue
        node, weight = entry.get("url"), entry.get("weight")
        # The entries mero-js would use: an http(s) URL and a positive weight.
        if not isinstance(node, str) or not re.match(r"^https?://", node):
            continue
        if not isinstance(weight, int) or isinstance(weight, bool) or weight < 1:
            continue
        node = node.rstrip("/")
        if node not in nodes:
            nodes.append(node)
    return nodes


def node_release(node, timeout):
    url = f"{node}/attestation?nonce={secrets.token_hex(32)}"
    body = get_json(url, timeout)
    return release_version(((body or {}).get("release") or {}).get("version"))


def lowest_release(directory, cluster, timeout=10.0, log=sys.stderr):
    try:
        nodes = cluster_nodes(directory, cluster, timeout)
    except Exception as e:  # noqa: BLE001 - any failure means "no answer"
        print(f"the directory for {cluster} could not be read: {e}", file=log)
        return None
    if not nodes:
        print(f"the directory lists no usable node for {cluster}", file=log)
        return None
    found = []
    for node in nodes:
        try:
            version = node_release(node, timeout)
        except Exception as e:  # noqa: BLE001 - an unhealthy node is skipped
            print(f"{node}: no attestation ({e}); skipped", file=log)
            continue
        if version is None:
            print(f"{node}: names no release; skipped", file=log)
            continue
        print(f"{node}: mero-tee {version}", file=log)
        found.append(version)
    if not found:
        print(f"no node of {cluster} names a mero-tee release", file=log)
        return None
    return min(found, key=version_key)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cluster", default="eu-shared-1")
    parser.add_argument("--directory", default=DEFAULT_DIRECTORY)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args(argv)
    version = lowest_release(args.directory, args.cluster, args.timeout)
    if version is None:
        return 1
    print(version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
