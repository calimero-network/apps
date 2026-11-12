# Mero Issue Tracker for Android

Jetpack Compose + Material3, minSdk 26. See [`../README.md`](../README.md) for the screens,
the Calimero 1.0 model, sign-in, invitations and approvals.

| Path | What |
| --- | --- |
| `app/src/main/kotlin/network/calimero/issues/contract/` | The contract client (component ABI, camelCase, u64 as strings) |
| `…/core/` | `WorkspaceModel`, `IssuesModel`, `IssueDetailModel`, `ApprovalsModel`, invitations, formatting |
| `…/app/`, `…/ui/` | The session view model and the Compose screens |
| `app/src/test/` | JVM tests of the models against mero-testkit's `InMemoryAppBackend`, and the contract's wire |

```bash
./scripts/fetch-sdk.sh          # the kotlin-sdk at kotlin-sdk.ref, built as a composite build
./gradlew ktlintCheck detekt testDebugUnitTest lint assembleDebug
```

Package `network.calimero.issues`.

- **Sign-in**: `IssuesAppViewModel` opens a `MeroAppSession` on the cluster the person names: a
  Calimero Cloud cluster by name (`CalimeroClient.connect(CalimeroConnectOptions(cluster = …))`) or
  node URL, signed in with the device's passkey (Credential Manager); or a development node
  (`merod local`, `http://10.0.2.2:2501` from the emulator, plain http allowed only to it) with a
  software passkey kept on the device. Prefill them with `-PmeroCluster=…` and `-PmeroDevNodeUrl=…`.
- **Step-ups**: `MainActivity` hands its passkey to the session in `onCreate` and takes it back in
  `onDestroy`, so inviting and member changes are approved with it.
- **Links**: the consent page returns to `mero-issues://consent`; invitation links arrive on
  `https://links.calimero.network/com.calimero.mero-issue-tracker/join?…` and
  `calimero://com.calimero.mero-issue-tracker/join?…`.

`kotlin-sdk.ref` pins the commit of the kotlin-sdk `4.0.0` release (Calimero 1.0, `e18ef8a`); to bump
it, put the new tag's commit there.
