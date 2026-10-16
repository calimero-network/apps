# @calimero-apps/members

Who is in a workspace and what they may do, with the same guards in every app.

Before this, each app had its own member list and most of them could not remove
anybody: mero-crm and mero-issue-tracker had a role control and no Remove,
mero-calendar changed a capability mask and called it a role, mero-pixart could
promote but not remove. This is mero-docs' namespace member panel, shared.

```tsx
import { MembersPanel } from "@calimero-apps/members";
import "@calimero-apps/members/members.css";

const { admin } = useMero();
<MembersPanel
  admin={admin}                 // the session-aware client
  groupId={namespaceId}         // the namespace, for a workspace roster
  selfAccount={accountId}       // getNodeIdentity().accountId, never a key
  onInvite={() => setInviteOpen(true)}
  onRoleChanged={(account, role) => cascade(account, role)} // optional
/>;
```

| Piece | What it is |
| --- | --- |
| `MembersPanel` | The list: names (via `@calimero-apps/names`), Admin/Member select, Remove with an inline confirm, Invite button or slot, TEE badge. Read-only for anyone who cannot manage members. |
| `useWorkspaceMembers(admin, groupId)` | The roster without the UI, with `setRole` and `remove`; both re-read the roster after writing and throw the node's refusal. |
| `canChangeRole`, `canRemoveMember` | The guards, for an app that keeps its own list. |
| `RemoveMemberButton` | Remove with an inline "Remove Ana?" confirm. |

## The rules

- **Accounts, not keys.** Every member call takes the ACCOUNT the listing keys
  rows by. A signing key is also 32 bytes, so passing one names nobody and
  raises nothing.
- **Never the last admin.** Nobody can demote or remove the only admin; the
  workspace would be left with nobody who could appoint one again.
- **Never yourself from here.** Removing yourself is leaving, which each app
  does with its own cleanup. Stepping down from admin is allowed while another
  admin remains, after a confirm.
- **The client, not the mutation hooks.** mero-react's `useRemoveGroupMembers`
  and `useUpdateMemberRole` resolve to `null` on a refusal, so an awaiting
  caller cannot tell it failed. The panel calls the same admin methods, which
  throw, and shows the node's reason.
- **Read back, never patch.** A refused change must not look like an accepted
  one, so every write is followed by a fresh listing.

`members.css` uses `--glass-*` tokens with fallbacks and `cm-` class names, so it
fits an app on `@calimero-apps/glass` and stays readable in one that is not.
