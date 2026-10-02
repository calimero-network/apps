import { readTomlString, setTomlKey } from "./toml";

const CONFIG = `[bootstrap]
nodes = [
    "/ip4/18.156.18.6/udp/4001/quic-v1/p2p/12D3KooWMgoF9xzyeKJHtRvrYwdomheRbHPELagWZwTLmXb6bCVC",
    "/ip4/18.156.18.6/tcp/4001/p2p/12D3KooWMgoF9xzyeKJHtRvrYwdomheRbHPELagWZwTLmXb6bCVC",
]

[discovery]
advertise_address = false
mdns = false

[discovery.rendezvous]
namespace = "/calimero/devnet/global"

[identity]
keypair = "abc"
peer_id = "12D3KooWFafnjA7Qr8UHR8NSa1S4vW8xUsvT9cMgHws6orcyauEx"

[sync]
frequency_ms = 10000
interval_ms = 5000
`;

describe("setTomlKey", () => {
  it("replaces a multi-line array in place", () => {
    const out = setTomlKey(CONFIG, "bootstrap", "nodes", ["/ip4/127.0.0.1/tcp/2701/p2p/X"]);
    expect(out).toContain('nodes = [\n    "/ip4/127.0.0.1/tcp/2701/p2p/X",\n]');
    expect(out).not.toContain("18.156.18.6");
    expect(out).toContain("[discovery]\nadvertise_address = false");
  });

  it("empties an array", () => {
    const out = setTomlKey(CONFIG, "bootstrap", "nodes", []);
    expect(out).toContain("[bootstrap]\nnodes = []\n\n[discovery]");
  });

  it("replaces a scalar only inside its own section", () => {
    const out = setTomlKey(CONFIG, "discovery", "mdns", true);
    expect(out).toContain("mdns = true");
    expect(out.match(/mdns/g)).toHaveLength(1);
  });

  it("does not touch a same-named key in a subsection", () => {
    const out = setTomlKey(CONFIG, "discovery.rendezvous", "namespace", "/calimero/journey/x");
    expect(out).toContain('namespace = "/calimero/journey/x"');
    expect(out).not.toContain("devnet/global");
  });

  it("adds a key that is missing and a section that is missing", () => {
    const added = setTomlKey(CONFIG, "sync", "timeout_ms", 30000);
    expect(added).toContain("[sync]\ntimeout_ms = 30000\nfrequency_ms = 10000");
    const created = setTomlKey(CONFIG, "journey", "flag", true);
    expect(created.trimEnd().endsWith("[journey]\nflag = true")).toBe(true);
  });
});

describe("readTomlString", () => {
  it("reads the peer id from its section", () => {
    expect(readTomlString(CONFIG, "identity", "peer_id")).toBe(
      "12D3KooWFafnjA7Qr8UHR8NSa1S4vW8xUsvT9cMgHws6orcyauEx",
    );
    expect(readTomlString(CONFIG, "identity", "missing")).toBeUndefined();
  });
});
