# Not ported to Calimero Cloud (release-v2)

This app demonstrates v1's delegated execution: an account with no node signs a
warrant and a relay runs the call as that account. Calimero Cloud has neither
relays nor warrants (a person is a passkey account on the cluster, and a
machine uses a scoped API key), so there is nothing here to port the demo to.

It stays on v1's client (`@calimero-network/mero-js` 26.9.1, pinned in
`app/package.json`, outside the workspace catalog) and runs against a v1 node.
Remove it, or rewrite it as a demo of scoped API keys, once that is decided.
