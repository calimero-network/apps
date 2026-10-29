import Foundation
import XCTest

@testable import PassCore

/// The web's `vaultSession.test.ts`, case for case where it applies.
/// Android's `VaultSessionTest` mirrors this file.
final class VaultSessionTests: XCTestCase {
    func testBootstrapsAKeyAndSealsEverythingItWrites() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        let state = try await a.session.open()
        XCTAssertEqual(state, .ready)
        XCTAssertNotNil(vault.currentKey.range(of: "^[0-9a-f]{64}$", options: .regularExpression))

        let id = try await a.session.add(
            SecretDraft(kind: "login", name: "GitHub", tags: ["dev"], fields: ["username": "alice", "password": "hunter2"]))
        let stored = vault.secrets[id]!
        let onDisk = "\(stored.name)\(stored.tags)\(stored.fields)"
        XCTAssertFalse(onDisk.contains("GitHub"))
        XCTAssertFalse(onDisk.contains("hunter2"))
        XCTAssertFalse(onDisk.contains("dev"))
        XCTAssertEqual(PassCrypto.keyId(of: stored.fields["password"]!), vault.currentKey)

        let plain = try await a.session.list()[0]
        XCTAssertEqual(plain.name, "GitHub")
        XCTAssertEqual(plain.tags, ["dev"])
        XCTAssertEqual(plain.fields["password"], "hunter2")
        XCTAssertFalse(plain.unreadable)
    }

    func testANewcomerWaitsUntilAKeyHolderAdmitsThem() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        try await a.session.add(SecretDraft(kind: "login", name: "Bank", tags: [], fields: ["password": "p"]))

        let b = browser(vault, bob)
        let waiting = try await b.session.open()
        XCTAssertEqual(waiting, .waiting)
        let locked = try await b.session.list()[0]
        XCTAssertTrue(locked.unreadable)
        XCTAssertEqual(locked.name, "Locked item")

        let chores = try await a.session.housekeep()
        XCTAssertEqual(chores, Chores(admitted: 1, wrapped: 1, removed: 0))
        XCTAssertEqual(vault.roles[bob], .editor)

        let ready = try await b.session.refreshKeys()
        XCTAssertEqual(ready, .ready)
        let open = try await b.session.list()[0]
        XCTAssertEqual(open.fields["password"], "p")
        let canWrite = await b.session.canWrite
        XCTAssertTrue(canWrite)
    }

    func testDoesNotAdmitAnAccountOutsideTheAllowedSet() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let b = browser(vault, bob)
        try await b.session.open()
        let chores = try await a.session.housekeep(allowed: [alice])
        XCTAssertEqual(chores, Chores(admitted: 0, wrapped: 0, removed: 0))
        let state = try await b.session.refreshKeys()
        XCTAssertEqual(state, .waiting)
    }

    func testSendsOnlyTheFieldsThatChanged() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let id = try await a.session.add(
            SecretDraft(kind: "login", name: "Mail", tags: [], fields: ["username": "u", "password": "old", "url": "https://mail"]))
        let before = try await a.session.list()[0]
        let urlEnvelope = vault.secrets[id]!.fields["url"]

        var fields = before.fields
        fields["password"] = "new"
        try await a.session.update(before, to: SecretDraft(kind: before.kind, name: before.name, tags: before.tags, fields: fields))

        XCTAssertEqual(vault.secrets[id]!.fields["url"], urlEnvelope)
        let history = try await a.session.history(id)
        XCTAssertEqual(history.count, 1)
        XCTAssertEqual(history[0].field, "password")
        XCTAssertEqual(history[0].previous, "old")
        XCTAssertFalse(history[0].unreadable)
    }

    func testRotationLocksOutARemovedMemberFromAnythingWrittenAfterwards() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let b = browser(vault, bob)
        try await b.session.open()
        try await a.session.housekeep()
        try await b.session.refreshKeys()
        let oldKey = vault.currentKey

        vault.roles[bob] = nil
        try await a.session.add(SecretDraft(kind: "login", name: "Before", tags: [], fields: ["password": "b"]))
        let rekeyed = try await a.session.rotate(allowed: [alice])
        XCTAssertEqual(rekeyed, 1)
        XCTAssertNotEqual(vault.currentKey, oldKey)
        try await a.session.add(SecretDraft(kind: "login", name: "After", tags: [], fields: ["password": "a"]))

        for s in vault.secrets.values { XCTAssertEqual(PassCrypto.keyId(of: s.fields["password"]!), vault.currentKey) }
        let bobState = try await b.session.refreshKeys()
        XCTAssertEqual(bobState, .waiting)
        let seen = try await b.session.list()
        XCTAssertTrue(seen.allSatisfy(\.unreadable))

        let mine = try await a.session.list()
        XCTAssertEqual(mine.compactMap { $0.fields["password"] }.sorted(), ["a", "b"])
        XCTAssertTrue(vault.history.isEmpty)
    }

    func testAnAdminFinishesATeamLevelRemoval() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let b = browser(vault, bob)
        try await b.session.open()
        try await a.session.housekeep(allowed: [alice, bob])
        try await b.session.refreshKeys()
        let oldKey = vault.currentKey

        let chores = try await a.session.housekeep(allowed: [alice])
        XCTAssertEqual(chores.removed, 1)
        XCTAssertEqual(vault.roles[bob], .removed)
        XCTAssertNotEqual(vault.currentKey, oldKey)
        let state = try await b.session.refreshKeys()
        XCTAssertEqual(state, .waiting)
    }

    func testDoesNotRemoveAnyoneOnAListingWithoutItself() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        vault.roles[bob] = .editor
        let chores = try await a.session.housekeep(allowed: [])
        XCTAssertEqual(chores.removed, 0)
        XCTAssertEqual(vault.roles[bob], .editor)
    }

    func testHandsEveryKeyOverToANewKeyPair() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        try await a.session.add(SecretDraft(kind: "login", name: "Old", tags: [], fields: ["password": "o"]))
        try await a.session.rotate(allowed: nil)

        let next = DeviceKeyPair.generate()
        let nextFp = PassCrypto.fingerprint(of: next.publicRaw)
        let moved = try await a.session.handOver(publicRaw: next.publicRaw, fingerprint: nextFp, label: "pin")
        XCTAssertEqual(moved, 2)

        let after = VaultSession(api: vault.api(alice), device: next, fingerprint: nextFp, label: "pin")
        let state = try await after.open()
        XCTAssertEqual(state, .ready)
        let size = await after.keyring.count
        XCTAssertEqual(size, 2)
        let first = try await after.list()[0]
        XCTAssertEqual(first.fields["password"], "o")
    }

    func testAViewerCannotWrite() async throws {
        let vault = FakeVault(creator: alice)
        vault.defaultRole = "viewer"
        let a = browser(vault, alice)
        try await a.session.open()
        let b = browser(vault, bob)
        try await b.session.open()
        try await a.session.housekeep()
        try await b.session.refreshKeys()
        let state = await b.session.state
        let canWrite = await b.session.canWrite
        XCTAssertEqual(state, .ready)
        XCTAssertFalse(canWrite)
    }

    // MARK: Device approval

    private func aliceWithBob() async throws -> (
        FakeVault, (fp: String, device: DeviceKeyPair, session: VaultSession),
        (fp: String, device: DeviceKeyPair, session: VaultSession)
    ) {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let b = browser(vault, bob)
        try await b.session.open()
        try await a.session.housekeep()
        try await b.session.refreshKeys()
        return (vault, a, b)
    }

    func testASecondDeviceOfAnAccountWaitsForApproval() async throws {
        let (vault, a, b) = try await aliceWithBob()
        let b2 = browser(vault, bob)
        let opened = try await b2.session.open()
        XCTAssertEqual(opened, .waiting)
        let awaiting = try await b2.session.awaitingApproval()
        XCTAssertTrue(awaiting)

        let aChores = try await a.session.housekeep()
        let bChores = try await b.session.housekeep()
        XCTAssertEqual(aChores.wrapped, 0)
        XCTAssertEqual(bChores.wrapped, 0)

        let forBob = try await b.session.pendingApprovals()
        XCTAssertEqual(forBob.map(\.fingerprint), [b2.fp])
        let forAlice = try await a.session.pendingApprovals()
        XCTAssertEqual(forAlice.count, 1)
        let forItself = try await b2.session.pendingApprovals()
        XCTAssertTrue(forItself.isEmpty)

        let granted = try await b.session.approve(forBob[0])
        XCTAssertEqual(granted, 1)
        let state = try await b2.session.refreshKeys()
        XCTAssertEqual(state, .ready)
        let left = try await b.session.pendingApprovals()
        XCTAssertTrue(left.isEmpty)
    }

    func testADeniedRequestIsWithdrawn() async throws {
        let (vault, _, b) = try await aliceWithBob()
        let b2 = browser(vault, bob)
        try await b2.session.open()
        let requests = try await b.session.pendingApprovals()
        try await b.session.deny(requests[0])
        XCTAssertNil(vault.devices[b2.fp])
        let left = try await b.session.pendingApprovals()
        XCTAssertTrue(left.isEmpty)
    }

    func testAReplacementForARevokedDeviceIsLetInWithoutApproval() async throws {
        let (vault, a, b) = try await aliceWithBob()
        try await a.session.deny(vault.devices[b.fp]!)
        XCTAssertEqual(vault.devices[b.fp]?.revoked, true)

        let b2 = browser(vault, bob)
        try await b2.session.open()
        let awaiting = try await b2.session.awaitingApproval()
        XCTAssertFalse(awaiting)
        let chores = try await a.session.housekeep()
        XCTAssertEqual(chores.wrapped, 1)
        let state = try await b2.session.refreshKeys()
        XCTAssertEqual(state, .ready)
    }

    func testRotationReachesApprovedDevicesAndRecoveryKeysNotRequests() async throws {
        let (vault, a, b) = try await aliceWithBob()
        let rec = DeviceKeyPair.generate()
        let recFp = PassCrypto.fingerprint(of: rec.publicRaw)
        try await b.session.handOver(publicRaw: rec.publicRaw, fingerprint: recFp, label: recoveryLabel, kind: .recovery)
        let b2 = browser(vault, bob)
        try await b2.session.open()

        try await a.session.rotate(allowed: nil)
        let holding = vault.wraps.values.filter { $0.wrap.keyId == vault.currentKey }.map(\.wrap.recipient).sorted()
        XCTAssertEqual(holding, [a.fp, b.fp, recFp].sorted())
        let holders = try await a.session.holders()
        XCTAssertEqual(holders, Holders(browsers: 2, recovery: 1, agents: 0))
    }

    func testARecoveryKeyRestoresAFreshDevice() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let made = RecoveryCode.create()
        let adopted = try await a.session.adoptRecoveryKey(made.key)
        XCTAssertEqual(adopted, 1)
        let approvals = try await a.session.pendingApprovals()
        XCTAssertTrue(approvals.isEmpty)

        let devices = try await vault.api(alice).listDevices()
        guard let pair = try RecoveryCode.pair(from: made.code, candidates: devices) else {
            return XCTFail("the code did not match its recovery device")
        }
        let restorer = VaultSession(api: vault.api(alice), device: pair.device, fingerprint: pair.fingerprint, label: "")
        let state = try await restorer.refreshKeys()
        XCTAssertEqual(state, .ready)
        let fresh = DeviceKeyPair.generate()
        let freshFp = PassCrypto.fingerprint(of: fresh.publicRaw)
        let handed = try await restorer.handOver(publicRaw: fresh.publicRaw, fingerprint: freshFp, label: "phone")
        XCTAssertEqual(handed, 1)
        let after = VaultSession(api: vault.api(alice), device: fresh, fingerprint: freshFp, label: "phone")
        let opened = try await after.open()
        XCTAssertEqual(opened, .ready)
    }

    func testANewRecoveryKeyReplacesTheOldOneAndIsNotReGiven() async throws {
        let vault = FakeVault(creator: alice)
        let a = browser(vault, alice)
        try await a.session.open()
        let first = RecoveryCode.create().key
        var n = try await a.session.adoptRecoveryKey(first)
        XCTAssertEqual(n, 1)
        n = try await a.session.adoptRecoveryKey(first)
        XCTAssertEqual(n, 0)
        let second = RecoveryCode.create().key
        n = try await a.session.adoptRecoveryKey(second)
        XCTAssertEqual(n, 0)
        XCTAssertNil(vault.devices[second.fingerprint])
        n = try await a.session.adoptRecoveryKey(second, replace: true)
        XCTAssertEqual(n, 1)
        XCTAssertNil(vault.devices[first.fingerprint])
        XCTAssertEqual(vault.devices[second.fingerprint]?.kind, "recovery")
    }

    func testAnAgentIsNeverAdmittedByHousekeepingAndAnEditorCannotLetItIn() async throws {
        let (vault, a, b) = try await aliceWithBob()
        let agentKey = DeviceKeyPair.generate()
        let agentFp = PassCrypto.fingerprint(of: agentKey.publicRaw)
        let agent = VaultSession(
            api: vault.api("c" + String(repeating: "0", count: 63)), device: agentKey, fingerprint: agentFp,
            label: "mero-bot", kind: .agent)
        try await agent.open()
        let chores = try await a.session.housekeep()
        XCTAssertEqual(chores.admitted, 0)

        vault.roles["c" + String(repeating: "0", count: 63)] = .viewer
        let forEditor = try await b.session.pendingApprovals()
        XCTAssertTrue(forEditor.isEmpty)
        let forAdmin = try await a.session.pendingApprovals()
        XCTAssertEqual(forAdmin.map(\.fingerprint), [agentFp])
        do {
            try await b.session.approve(forAdmin[0])
            XCTFail("an editor let an agent in")
        } catch {}
        try await a.session.approve(forAdmin[0])
        let state = try await agent.refreshKeys()
        XCTAssertEqual(state, .ready)
        let holders = try await a.session.holders()
        XCTAssertEqual(holders.agents, 1)
    }
}
