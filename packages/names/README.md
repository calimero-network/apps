# @calimero-apps/names

What to call an account, a team and a project — the same answer in every app.

mero-chat fixed "random-looking bytes" by reading names from the namespace's
replicated records instead of rendering ids. This package is that fix, shared.

| Thing | Source of truth | Read with |
| --- | --- | --- |
| A person | Namespace **member metadata** (`setMemberMetadata`), returned as `name` on `listGroupMembers(namespaceId)` | `useMemberNames(admin, namespaceId)` |
| A team / space / workspace | **Group metadata** (`GroupMetadataSet`) | `useGroupName(admin, groupId, { localName, fallback })` |
| A project / board / doc | **Context metadata** | `useGroupName(admin, groupId, …, { contextId })` |

Member names are read from the **namespace**, never a subgroup: member metadata
is per group and the namespace is the one group everyone is in.

```tsx
const { admin } = useMero();
const { displayName } = useMemberNames(admin, namespaceId);
<span title={account}>{displayName(account, contractUsername)}</span>;

// When the user picks a name anywhere, publish it for every app:
await publishMemberName(admin, namespaceId, selfAccount, name);
```

- Accounts are compared canonically (`canonicalAccount`): the admin API speaks
  hex, contracts stamp base58.
- The fallback is `shortAccount(id)` (`5926f2…1334`), never 64 hex.
- `useGroupName(..., { backfillLocal: true })` promotes a name only this browser
  knows into the replicated record, once, without wiping its `data`.
