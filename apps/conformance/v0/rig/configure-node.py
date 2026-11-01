#!/usr/bin/env python3
"""Rewrite a fresh node's config.toml for the conformance rig.

`merod init` points every node at the public devnet boot node and its global
rendezvous namespace. The rig's two nodes must find each other and nothing else
(another rig may be running on this machine), so:

  * `bootstrap.nodes` becomes exactly the list given (empty for the owner, the
    owner's address for the relay);
  * the rendezvous namespace is private to this rig;
  * mDNS stays off, so neither node announces itself on the LAN;
  * sync runs as often as merobox's e2e defaults have it, so a write on one
    node is visible on the other within a second or two.

Usage: configure-node.py <config.toml> [<boot multiaddr> ...]
"""
import re
import sys

path, boot = sys.argv[1], sys.argv[2:]
s = open(path, encoding="utf-8").read()

nodes = "".join(f'    "{a}",\n' for a in boot)
s, n = re.subn(r"(?ms)^\[bootstrap\]\nnodes = \[.*?\]\n", f"[bootstrap]\nnodes = [\n{nodes}]\n", s, count=1)
assert n == 1, "no [bootstrap] nodes list"

s, n = re.subn(r'(?m)^namespace = "/calimero/devnet/global"$', 'namespace = "/calimero/conformance-rig"', s, count=1)
assert n == 1, "no rendezvous namespace"

s = re.sub(r"(?m)^mdns = true$", "mdns = false", s)
s = re.sub(r"(?m)^interval_ms = \d+$", "interval_ms = 500", s)
s = re.sub(r"(?m)^frequency_ms = \d+$", "frequency_ms = 1000", s)

open(path, "w", encoding="utf-8").write(s)
