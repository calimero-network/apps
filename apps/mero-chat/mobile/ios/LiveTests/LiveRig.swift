import Foundation
import MeroKit
import MeroKitUI
import XCTest

/// The real relay the live tests run against, and what they need to know
/// about it.
///
/// Set by `.github/workflows/mero-chat-ios-live.yml` from the `.relay.env`
/// that `mobile/e2e/run-relay.sh` writes. xcodebuild hands the test process
/// only variables prefixed `TEST_RUNNER_`, with the prefix stripped, so CI
/// exports `TEST_RUNNER_MERO_E2E_RELAY_URL` and the test reads
/// `MERO_E2E_RELAY_URL` (the swift-sdk's `chat-multi-e2e.sh` relies on the
/// same). Locally, with neither set, `mobile/e2e/.relay.env` is read
/// directly: the simulator sees the host's file system.
///
///   MERO_E2E_RELAY_URL      the relay, on loopback (its mock quote is accepted only there)
///   MERO_E2E_APP_ID         mero-chat's application id as installed on it
///   MERO_E2E_APP_VERSION    that bundle's version (default 0.0.0, what run-relay.sh builds)
///   MERO_E2E_RELAY_ACCOUNT  the relay's own account, if known; else asked of the relay
///   MERO_E2E_RELAY_ADMIN_USER / MERO_E2E_RELAY_ADMIN_PASSWORD
///                           the relay operator's login (default dev / dev-password, run-relay.sh's)
///
/// Without a relay URL and an application id every live test skips itself,
/// so the ordinary unit-test job stays offline.
struct LiveRig: Sendable {
    let relayURL: String
    let appId: String
    let appVersion: String
    let relayAccount: String?
    let adminUser: String
    let adminPassword: String

    /// Where the Cloud manager and the registry would be. Nothing listens
    /// there: this rig has no cloud and no registry, and every call the SDK
    /// makes to them fails at once, which it treats as best-effort (HA after
    /// founding, the invitation routing check, the registry lookup of the
    /// application id). Founding and joining are pointed at the relay instead,
    /// through ``DelegatedChatBackend``'s two seams.
    static let noCloud = URL(string: "http://127.0.0.1:9")!

    /// The rig, or an `XCTSkip` when no relay is configured.
    static func require() throws -> LiveRig {
        let values = environment()
        guard let relay = values["MERO_E2E_RELAY_URL"], !relay.isEmpty,
            let appId = values["MERO_E2E_APP_ID"], !appId.isEmpty
        else {
            throw XCTSkip(
                "MERO_E2E_RELAY_URL / MERO_E2E_APP_ID not set and no mobile/e2e/.relay.env: "
                    + "skipping the live-relay tests (start one with mobile/e2e/run-relay.sh)")
        }
        var trimmed = relay
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        return LiveRig(
            relayURL: trimmed, appId: appId.lowercased(), appVersion: values["MERO_E2E_APP_VERSION"] ?? "0.0.0",
            relayAccount: values["MERO_E2E_RELAY_ACCOUNT"].flatMap { $0.isEmpty ? nil : $0.lowercased() },
            adminUser: values["MERO_E2E_RELAY_ADMIN_USER"] ?? "dev",
            adminPassword: values["MERO_E2E_RELAY_ADMIN_PASSWORD"] ?? "dev-password")
    }

    /// The process environment over `mobile/e2e/.relay.env`.
    private static func environment() -> [String: String] {
        var values = relayEnvFile()
        for (key, value) in ProcessInfo.processInfo.environment where !value.isEmpty {
            if key.hasPrefix("MERO_E2E_") {
                values[key] = value
            } else if key.hasPrefix("TEST_RUNNER_MERO_E2E_") {
                values[String(key.dropFirst("TEST_RUNNER_".count))] = value
            }
        }
        return values
    }

    /// `KEY=VALUE` lines of `mobile/e2e/.relay.env`, found from this file's path.
    private static func relayEnvFile() -> [String: String] {
        let file = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // LiveTests
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // mobile
            .appendingPathComponent("e2e")
            .appendingPathComponent(".relay.env")
        guard let text = try? String(contentsOf: file, encoding: .utf8) else { return [:] }
        var values: [String: String] = [:]
        for line in text.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces)
            let value = parts[1].trimmingCharacters(in: .whitespaces)
            if !key.isEmpty, !key.hasPrefix("#") { values[key] = value }
        }
        return values
    }
}

/// A live-test failure with words, for a step that cannot go on.
struct LiveFailure: Error, CustomStringConvertible, LocalizedError {
    let description: String
    init(_ description: String) { self.description = description }
    var errorDescription: String? { description }
}

/// The relay's own account: the executor a founding warrant names.
///
/// In the app the Cloud manager reports it beside the relay
/// (`getAccountRelays` → `executor_account`, kept in ``CloudSession``). There
/// is no cloud here, and an account's own relay session may not read the
/// node's identity (`/admin-api/identity` needs `namespace:list`), so the
/// rig's operator login reads it once. This is the only operator call the
/// live tests make, and it stands in for the cloud, not for anything the app
/// does.
@MainActor
enum LiveRelayIdentity {
    private static var cached: String?

    static func executorAccount(_ rig: LiveRig) async throws -> String {
        if let known = rig.relayAccount { return known }
        if let learned = cached { return learned }
        guard let url = URL(string: rig.relayURL) else { throw LiveFailure("bad relay URL \(rig.relayURL)") }
        let operatorClient = Mero(config: MeroConfig(baseURL: url, timeout: 15, tokenStore: MemoryTokenStore()))
        do {
            try await operatorClient.authenticate(Credentials(username: rig.adminUser, password: rig.adminPassword))
        } catch {
            throw LiveFailure(
                "could not log in to the relay as its operator (\(rig.adminUser)) to learn its account; "
                    + "set MERO_E2E_RELAY_ACCOUNT instead: \(error)")
        }
        let identity = try await operatorClient.admin.getNodeIdentity()
        let account = identity.accountId.lowercased()
        cached = account
        return account
    }
}

/// The wallet is never opened: every account here is minted offline.
struct NoWalletAuthenticator: WebAuthenticating {
    func authenticate(url: URL, callback: CloudCallback) async throws -> URL {
        throw LiveFailure("the live tests mint their accounts offline; nothing should open the wallet (\(url))")
    }
}

/// One person on one phone: an account minted offline, this device certified
/// into it, and the app's own session wiring on top.
///
/// **Offline account.** A fresh BIP39 root (``generateAccountRoot()``)
/// certifies a fresh device key (``DeviceCertificates/certify(rootSeed:device:signPublicKey:kemPublicKey:deviceEpoch:)``)
/// — exactly what the wallet does at enrolment, and what the swift-sdk's own
/// tests do with their `TestWallet`. The root is dropped after: the phone
/// holds only the device key and its certificate, as in the app.
///
/// **Session.** The certificate and the relay go into a ``CloudSignIn`` as the
/// session the wallet + Cloud manager would have stored, and a
/// ``MeroClient`` restores it (`restoreCloudSession`, the app's relaunch
/// path): it attests the relay (a mock quote, which the SDK refuses unless
/// `DcapRelayKeyVerifier(allowMock: true)`, so the rig opts in), logs in
/// with the certificate (`account_proof`) and builds the account admin.
/// ``backend`` is then built the way `SessionModel.rebuild` builds it.
@MainActor
final class LiveAccount {
    let label: String
    /// The account, 64 hex.
    let accountId: String
    let client: MeroClient
    private let rig: LiveRig
    private(set) var backend: DelegatedChatBackend

    /// The account's `UserId` in the contract (base58).
    var userId: String { ChatIdentity.userId(accountHex: accountId) ?? "" }

    private init(label: String, accountId: String, client: MeroClient, rig: LiveRig, backend: DelegatedChatBackend) {
        self.label = label
        self.accountId = accountId
        self.client = client
        self.rig = rig
        self.backend = backend
    }

    /// Mint an account and sign this device in. `withRelay`: the session
    /// names the relay (an account the cloud already serves); without it the
    /// account is relayless until it redeems an invitation, as a brand-new
    /// one is in the app.
    static func mint(_ label: String, rig: LiveRig, withRelay: Bool) async throws -> LiveAccount {
        let root = try generateAccountRoot()
        let rootSeed = try Hex.decode(root.secret, label: "root secret", bytes: 32)
        let keys = DeviceKeys.generate()
        let nonce = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
        let device = try DeviceCertificates.mintDeviceId(account: root.accountId, nonce: nonce)
        let credential = try DeviceCertificates.certify(
            rootSeed: rootSeed, device: device, signPublicKey: keys.signPublicKey, kemPublicKey: keys.kemPublicKey)
        let certified = try DeviceCertificates.verify(credential)
        guard certified.account == root.accountId, certified.signPublicKey == keys.signPublicKey else {
            throw LiveFailure("the offline certificate does not name the minted account and device key")
        }

        var executor: String?
        if withRelay { executor = try await LiveRelayIdentity.executorAccount(rig) }
        let session = CloudSession(
            account: root.accountId, device: device, credential: credential,
            relayUrl: withRelay ? rig.relayURL : nil, executorAccount: executor)
        let urlSession = URLSession(configuration: .ephemeral)
        let signIn = CloudSignIn(
            config: CloudConfig(
                cloudBaseURL: LiveRig.noCloud, audience: .codeSigningId("network.calimero.chat"),
                relayKeyVerifier: DcapRelayKeyVerifier(allowMock: true)),
            keyStore: .memory(keys), sessionStore: .memory(session), tokenStore: MemoryTokenStore(),
            nonces: MemoryWarrantNonceStore(), urlSession: urlSession, delegatedStore: .memory())
        let defaults = UserDefaults(suiteName: "network.calimero.chat.live.\(UUID().uuidString)") ?? .standard
        let client = MeroClient(
            session: urlSession, cloud: signIn, webAuthenticator: NoWalletAuthenticator(),
            config: MeroProviderConfig(
                packageName: ChatConstants.packageName, registryURL: LiveRig.noCloud.absoluteString,
                cloudBaseURL: LiveRig.noCloud),
            storage: MeroAppStorage(defaults: defaults))
        let restored = await client.restoreCloudSession()
        guard restored else { throw LiveFailure("\(label): the stored session was not restored") }
        let backend = try makeBackend(client, rig: rig, label: label)
        if withRelay, backend.connection.mero == nil {
            throw LiveFailure(
                "\(label): the relay session was not established: \(backend.connection.readNote ?? "no reason")")
        }
        return LiveAccount(label: label, accountId: root.accountId, client: client, rig: rig, backend: backend)
    }

    /// `SessionModel.didJoinWorkspace`: a relayless session now has the
    /// admitting relay, so reconnect to it and rebuild the backend.
    func didJoinWorkspace() async throws {
        guard !backend.hasRelay else { return }
        _ = await client.restoreCloudSession()
        backend = try Self.makeBackend(client, rig: rig, label: label)
        guard backend.hasRelay, backend.connection.mero != nil else {
            throw LiveFailure(
                "\(label): after joining, the session has no relay session: "
                    + (backend.connection.readNote ?? backend.connection.session.note ?? "no reason"))
        }
    }

    /// `SessionModel.rebuild`, plus the two seams that stand in for the cloud
    /// and the registry.
    private static func makeBackend(_ client: MeroClient, rig: LiveRig, label: String) throws -> DelegatedChatBackend {
        guard client.isAuthenticated, client.isDelegated, let connection = client.connection,
            let admin = client.admin
        else {
            throw LiveFailure("\(label): the client holds no delegated session: \(client.errorMessage ?? "no reason")")
        }
        return DelegatedChatBackend(
            connection: connection, admin: admin, signIn: client.cloudSignIn,
            foundingApplication: FoundingApplication(
                applicationId: rig.appId, package: ChatConstants.packageName, version: rig.appVersion),
            joinNodeURL: rig.relayURL)
    }
}

/// Poll `check` until it holds, or fail after `timeout` seconds.
///
/// Membership and metadata a governance op writes land when the relay applies
/// the op, so a listing read straight after a write may not show it yet.
@MainActor
func eventually(
    _ what: String, timeout: TimeInterval = 30, every interval: TimeInterval = 1,
    detail: @autoclosure () -> String = "", _ check: () async throws -> Bool
) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while true {
        if try await check() { return }
        if Date() >= deadline {
            let more = detail()
            throw LiveFailure("timed out after \(Int(timeout))s waiting until \(what)" + (more.isEmpty ? "" : ": \(more)"))
        }
        try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
    }
}
