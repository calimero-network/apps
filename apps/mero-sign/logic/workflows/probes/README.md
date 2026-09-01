# Legacy scenarios — written against an API the fleet no longer has

`bootstrap.yml`, `e2e-test.yml` and `test.yml` came from the standalone repo and
cannot run as written. Two reasons, both structural:

1. **`invite_open` / `join_open`.** These step types appear in NO other app in
   this monorepo. Every migrated app uses the namespace model:
   `create_namespace` → `create_namespace_invitation` → `join_namespace` →
   `create_context` → `join_context`.
2. **`create_context` with no `group_id`.** These scenarios create a context per
   node with no namespace at all, which predates namespaces existing. Two
   independently-created contexts are two different contexts; nothing syncs.

They also pinned `ghcr.io/calimero-network/merod:edge`, a floating tag, so
whatever they last passed against is unknown.

`e2e.yml` one directory up replaces them for CI: same app, namespace model,
asserting the document flow across two nodes. These three are kept because
`e2e-test.yml` in particular covers ground the new one does not yet — the
private-context signature flow, blob upload, and consent — and porting that is
worth doing deliberately rather than in a migration PR.

**To port one:** replace the per-node `create_context` pair with a namespace
bootstrap (see `../e2e.yml` steps 0–14), one `create_context` on node 1 and a
`join_context` on node 2; delete the `invite_open`/`join_open` pair. Then pin the
merod image to `[workspace.metadata.mero-apps].merod-image` and add `mdns: true`.
