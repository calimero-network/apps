import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import PassCore

/// The view models against the SDK's fakes (`InMemoryAppBackend`) and the
/// in-memory vault. Android's `ModelTest` mirrors this file.
@MainActor
final class ModelTests: XCTestCase {
    private func ref() -> VaultRef {
        VaultRef(namespaceId: "ns", teamName: "Acme", vaultId: "g1", vaultName: "Shared", contextId: "ctx")
    }

    private func vaultModel(_ vault: FakeVault, _ account: String, prefs: PassPreferences = MemoryPreferences())
        -> VaultModel
    {
        VaultModel(ref: ref(), api: vault.api(account), device: .generate(), label: "iPhone", preferences: prefs)
    }

    // MARK: Teams

    func testTeamsListAndCreate() async throws {
        let backend = InMemoryAppBackend()
        let teams = TeamsModel(backend: backend)
        await teams.load()
        XCTAssertEqual(teams.phase, .loaded)
        XCTAssertTrue(teams.teams.isEmpty)

        let made = try await teams.create(name: "  Acme  ")
        XCTAssertEqual(made.name, "Acme")
        XCTAssertEqual(teams.teams.map(\.name), ["Acme"])
        XCTAssertTrue(backend.log.contains("foundNamespace Acme"))
        do {
            _ = try await teams.create(name: " ")
            XCTFail("a blank name was accepted")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Give the team a name.")
        }
    }

    func testTeamsFailureIsShownInWords() async {
        let backend = InMemoryAppBackend()
        backend.failure = URLError(.notConnectedToInternet)
        let teams = TeamsModel(backend: backend)
        await teams.load()
        XCTAssertEqual(teams.phase, .failed("You're offline. Check your connection and try again."))
    }

    func testCreatingAVaultMakesAnOpenSubgroupWithANamedContract() async throws {
        let backend = InMemoryAppBackend()
        let founded = try await backend.foundNamespace(name: "Acme")
        let team = TeamModel(
            backend: backend, namespaceId: founded.namespaceId, teamName: "Acme", applicationId: backend.applicationId)
        let vault = try await team.create(name: "Bank logins")
        XCTAssertEqual(vault.vaultName, "Bank logins")
        XCTAssertTrue(backend.publicSubgroups.contains(vault.vaultId))
        XCTAssertEqual(backend.initArgs[vault.contextId], .object(["name": .string("Bank logins")]))
        await team.load()
        XCTAssertEqual(team.vaults.map(\.name), ["Bank logins"])
        XCTAssertEqual(team.vaults.first?.joined, true)
    }

    func testEnteringAVaultJoinsItFirst() async throws {
        let backend = InMemoryAppBackend()
        backend.subgroups = ["ns": [AppSubgroup(groupId: "g1", name: "Shared", contextIds: ["ctx"])]]
        let team = TeamModel(backend: backend, namespaceId: "ns", teamName: "Acme", applicationId: "app")
        await team.load()
        XCTAssertEqual(team.vaults.first?.joined, false)
        let ref = try await team.enter(team.vaults[0])
        XCTAssertEqual(ref.contextId, "ctx")
        XCTAssertTrue(backend.log.contains("joinContext ctx"))
        XCTAssertEqual(team.vaults.first?.joined, true)
    }

    // MARK: Invitations

    func testAVaultInvitationRoundTripsAndLandsInTheVault() async throws {
        let inviter = InMemoryAppBackend()
        let founded = try await inviter.foundNamespace(name: "Acme")
        let link = try await TeamModel.vaultInvite(
            backend: inviter,
            ref: VaultRef(
                namespaceId: founded.namespaceId, teamName: "Acme", vaultId: "g1", vaultName: "Shared", contextId: "ctx"))
        XCTAssertTrue(link.contains("com.calimero.mero-pass/join?invitation="))

        let parsed = try XCTUnwrap(PassInvitation.parse(link))
        XCTAssertEqual(parsed.kind, .vault)
        XCTAssertEqual(parsed.vaultName, "Shared")
        XCTAssertEqual(parsed.teamName, "Acme")
        XCTAssertEqual(parsed.namespaceId, founded.namespaceId)
        XCTAssertNotNil(PassInvitation.parse(try parsed.token()))
        XCTAssertNil(PassInvitation.parse(link.replacingOccurrences(of: "com.calimero.mero-pass", with: "com.calimero.chat")))

        let joiner = InMemoryAppBackend(account: String(repeating: "cd", count: 32))
        let model = InvitationModel(vaultAttempts: 1, vaultRetryDelay: .zero)
        XCTAssertTrue(model.open(link))
        XCTAssertEqual(model.stage, .confirm(title: "Shared", isVault: true, teamName: "Acme"))
        var joined = false
        await model.accept(backend: { joiner }, didJoin: { joined = true })
        XCTAssertTrue(joined)
        guard case .joined(let destination) = model.stage else { return XCTFail("\(model.stage)") }
        XCTAssertEqual(destination.vault?.contextId, "ctx")
        XCTAssertEqual(destination.namespaceId, founded.namespaceId)
    }

    func testANonInvitationIsRefusedInWords() {
        let model = InvitationModel()
        XCTAssertFalse(model.open("https://example.com/nothing"))
        XCTAssertEqual(model.stage, .failed("This isn't a Mero Pass invitation. Check the link and try again."))
    }

    // MARK: Vault

    func testAnAdminOpensAddsFindsEditsAndTrashes() async throws {
        let vault = FakeVault(creator: alice)
        let model = vaultModel(vault, alice)
        let opened = await model.open()
        XCTAssertTrue(opened)
        XCTAssertEqual(model.state, .ready)
        XCTAssertTrue(model.canWrite)
        XCTAssertEqual(model.subtitle, "End-to-end encrypted · you are an Admin")
        XCTAssertEqual(model.holders, Holders(browsers: 1, recovery: 0, agents: 0))

        let id = try await model.save(
            SecretDraft(kind: "login", name: "GitHub", tags: ["dev", " "], fields: ["username": "alice", "password": "pw", "bogus": "x"]),
            editing: nil)
        _ = try await model.save(
            SecretDraft(kind: "secure_note", name: "Wifi", tags: [], fields: ["notes": "guest"]), editing: nil)
        XCTAssertEqual(model.live.count, 2)
        XCTAssertEqual(model.secret(id)?.tags, ["dev"])
        XCTAssertNil(model.secret(id)?.fields["bogus"])
        XCTAssertEqual(model.counts["login"], 1)
        XCTAssertEqual(model.flagged, 1)

        model.query = "alice"
        XCTAssertEqual(model.shown.map(\.name), ["GitHub"])
        model.query = "pw"
        XCTAssertTrue(model.shown.isEmpty, "search must never match a secret value")
        model.query = ""
        model.filter = .kind("secure_note")
        XCTAssertEqual(model.shown.map(\.name), ["Wifi"])
        model.filter = .tag("dev")
        XCTAssertEqual(model.shown.map(\.name), ["GitHub"])

        let before = try XCTUnwrap(model.secret(id))
        var fields = before.fields
        fields["password"] = "new-password-123!"
        _ = try await model.save(SecretDraft(kind: "login", name: "GitHub", tags: ["dev"], fields: fields), editing: before)
        XCTAssertEqual(model.secret(id)?.fields["password"], "new-password-123!")
        let history = await model.history(id)
        XCTAssertEqual(history.map(\.previous), ["pw"])
        await model.restoreRevision(history[0], of: try XCTUnwrap(model.secret(id)))
        XCTAssertEqual(model.secret(id)?.fields["password"], "pw")

        await model.trash(id)
        XCTAssertEqual(model.trashed.map(\.id), [id])
        XCTAssertEqual(model.live.count, 1)
        await model.restore(id)
        XCTAssertTrue(model.trashed.isEmpty)
        await model.trash(id)
        await model.purge(id)
        XCTAssertNil(model.secret(id))
        let activity = await model.activity()
        XCTAssertFalse(activity.isEmpty)
    }

    func testABadAuthenticatorSeedIsRefused() async throws {
        let vault = FakeVault(creator: alice)
        let model = vaultModel(vault, alice)
        await model.open()
        do {
            _ = try await model.save(SecretDraft(kind: "totp", name: "Bank 2FA", tags: [], fields: ["secret": "not a seed!"]), editing: nil)
            XCTFail("accepted a bad seed")
        } catch {
            XCTAssertEqual(error.localizedDescription, "Seed or otpauth:// URI: not a base32 seed or an otpauth://totp URI.")
        }
    }

    func testANewcomerWaitsThenAnAdminPhoneLetsThemIn() async throws {
        let vault = FakeVault(creator: alice)
        let admin = vaultModel(vault, alice)
        await admin.open()
        _ = try await admin.save(SecretDraft(kind: "login", name: "Bank", tags: [], fields: ["password": "p"]), editing: nil)

        let newcomer = vaultModel(vault, bob)
        await newcomer.open()
        XCTAssertEqual(newcomer.state, .waiting)
        XCTAssertEqual(newcomer.role, .pending)
        XCTAssertTrue(newcomer.secrets.allSatisfy(\.unreadable))

        await admin.reload()
        await newcomer.reload()
        XCTAssertEqual(newcomer.state, .ready)
        XCTAssertEqual(newcomer.role, .editor)
        XCTAssertEqual(newcomer.live.first?.fields["password"], "p")

        // Bob's second phone waits for approval, and shows its code.
        let second = vaultModel(vault, bob)
        await second.open()
        XCTAssertTrue(second.awaitingApproval)
        await newcomer.reload()
        XCTAssertEqual(newcomer.approvals.map(\.fingerprint), [second.session.fingerprint])
        await newcomer.approve(newcomer.approvals[0])
        await second.reload()
        XCTAssertEqual(second.state, .ready)
    }

    func testARememberedRecoveryKeyIsGivenToEveryVaultOpened() async throws {
        let vault = FakeVault(creator: alice)
        let prefs = MemoryPreferences()
        prefs.recoveryKey = RecoveryCode.create().key
        let model = vaultModel(vault, alice, prefs: prefs)
        await model.open()
        XCTAssertEqual(model.holders?.recovery, 1)
    }

    // MARK: People

    func testRemovingSomeoneRotatesTheKey() async throws {
        let vault = FakeVault(creator: alice)
        let admin = vaultModel(vault, alice)
        await admin.open()
        let other = vaultModel(vault, bob)
        await other.open()
        await admin.reload()
        let oldKey = vault.currentKey

        let people = PeopleModel(session: admin.session, api: vault.api(alice))
        await people.load()
        XCTAssertEqual(people.members.map(\.role), [.admin, .editor])
        await people.setRole(bob, to: .viewer)
        XCTAssertEqual(vault.roles[bob], .viewer)
        let removed = await people.remove(bob)
        XCTAssertTrue(removed)
        XCTAssertEqual(vault.roles[bob], .removed)
        XCTAssertNotEqual(vault.currentKey, oldKey)
        XCTAssertEqual(people.status, "Removed. The vault key was rotated.")
        await people.setDefaultRole(.viewer)
        XCTAssertEqual(vault.defaultRole, "viewer")
        await people.rotate()
        XCTAssertEqual(people.status, "Rotated. 0 secrets re-encrypted.")
    }

    func testAViewerCannotChangeRoles() async throws {
        let vault = FakeVault(creator: alice)
        vault.roles[bob] = .viewer
        let viewer = vaultModel(vault, bob)
        await viewer.open()
        let people = PeopleModel(session: viewer.session, api: vault.api(bob))
        let changed = await people.setRole(alice, to: .viewer)
        XCTAssertFalse(changed)
        XCTAssertEqual(people.error, "Only a vault Admin can do that.")
    }

    // MARK: Security

    func testARecoveryKeyCoversEveryVaultAndRestoresAFreshPhone() async throws {
        let backend = InMemoryAppBackend()
        backend.namespaces = [AppNamespace(id: "ns", name: "Acme", applicationId: "app")]
        backend.subgroups = ["ns": [AppSubgroup(groupId: "g1", name: "Shared", contextIds: ["ctx"])]]
        backend.members = ["ctx"]
        let vault = FakeVault(creator: backend.account)
        let directory = VaultDirectory(backend: backend) { _ in vault.api(backend.account) }
        let phone = DeviceKeyPair.generate()
        _ = try await VaultSession(
            api: vault.api(backend.account), device: phone, fingerprint: PassCrypto.fingerprint(of: phone.publicRaw),
            label: "iPhone"
        ).open()

        let prefs = MemoryPreferences()
        let security = SecurityModel(preferences: prefs)
        await security.createRecoveryKey(directory: directory, device: phone, label: "iPhone")
        let code = try XCTUnwrap(security.shownCode)
        XCTAssertEqual(security.status, "Recovery key created for 1 vault.")
        XCTAssertNotNil(prefs.recoveryKey)
        security.dismissCode()
        XCTAssertNil(security.shownCode)

        // A new phone, with nothing: the code hands it the vault.
        let fresh = DeviceKeyPair.generate()
        let restoring = SecurityModel(preferences: MemoryPreferences())
        let restored = await restoring.restore(code: code, directory: directory, device: fresh, label: "New iPhone")
        XCTAssertEqual(restored, 1)
        let after = VaultSession(
            api: vault.api(backend.account), device: fresh, fingerprint: PassCrypto.fingerprint(of: fresh.publicRaw),
            label: "New iPhone")
        let state = try await after.open()
        XCTAssertEqual(state, .ready)

        let wrong = await restoring.restore(code: RecoveryCode.create().code, directory: directory, device: fresh, label: "x")
        XCTAssertEqual(wrong, 0)
        XCTAssertEqual(restoring.error, "That code does not match a recovery key in any of your vaults.")
        security.autoLockMinutes = 15
        XCTAssertEqual(prefs.autoLockMinutes, 15)
    }

    func testTheKeeperMakesTheKeyOnceAndLocks() throws {
        let store = MemoryDeviceKeyStore()
        let keeper = DeviceKeeper(store: store)
        XCTAssertFalse(keeper.hasKey)
        let first = try keeper.unlock()
        XCTAssertTrue(keeper.isUnlocked)
        keeper.lock()
        XCTAssertFalse(keeper.isUnlocked)
        let again = try keeper.unlock()
        XCTAssertEqual(first.publicRaw, again.publicRaw)
        XCTAssertEqual(keeper.generation, 3)
        try keeper.reset()
        XCTAssertFalse(keeper.hasKey)
    }

    func testItemPresentation() {
        let card = Secret(id: "1", kind: "payment_card", name: "Visa", tags: [], fields: ["card_number": "4111 1111 1111 1234"])
        XCTAssertEqual(ItemView.subtitle(card), "•••• 1234")
        let login = Secret(id: "2", kind: "login", name: "x", tags: [], fields: ["url": "https://www.github.com/login"])
        XCTAssertEqual(ItemView.subtitle(login), "github.com")
        XCTAssertEqual(ItemView.openableURL("github.com")?.absoluteString, "https://github.com")
        XCTAssertEqual(ItemView.monogram("  ébène"), "É")
        XCTAssertEqual(ItemView.shortAccount(String(repeating: "ab", count: 32)), "ababab…abab")
        XCTAssertTrue(SecretKind.isSensitive(kind: "login", field: "password"))
        XCTAssertFalse(SecretKind.isSensitive(kind: "login", field: "username"))
        XCTAssertTrue(SecretKind.isSensitive(kind: "custom", field: "api_token"))
        XCTAssertEqual(ItemView.orderedFields(login).map(\.label), ["Website"])
    }
}
