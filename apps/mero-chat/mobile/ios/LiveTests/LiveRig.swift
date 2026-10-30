import Foundation
import MeroKit
import MeroKitUI
import XCTest

/// The Calimero 1.0 development node the live tests run against
/// (`merod local`: `--dev`, mock attestation), and what they need to know
/// about it.
///
/// xcodebuild hands the test process only variables prefixed `TEST_RUNNER_`,
/// with the prefix stripped, so CI exports `TEST_RUNNER_MERO_E2E_NODE_URL`
/// and the test reads `MERO_E2E_NODE_URL`.
///
///   MERO_E2E_NODE_URL          a node of the cluster, on loopback (its mock quote is accepted only with allowMock)
///   MERO_E2E_NODES             the cluster's other nodes, comma-separated (failover on 421 WRONG_NODE)
///   MERO_E2E_PACKAGE_VERSION   the chat version installed there (default: the latest)
///
/// Install chat on it first (`meroctl app install --path mero-chat.mpk`).
/// Without a node URL every live test skips itself, so the ordinary
/// unit-test job stays offline.
struct LiveRig: Sendable {
    let nodeURL: String
    let nodes: [String]
    let packageVersion: String?

    /// What a channel's app instance is created from: chat's package.
    var appId: String { ChatConstants.packageName }

    /// The rig, or an `XCTSkip` when no node is configured.
    static func require() throws -> LiveRig {
        let values = environment()
        guard let node = values["MERO_E2E_NODE_URL"], !node.isEmpty else {
            throw XCTSkip("MERO_E2E_NODE_URL not set: skipping the live tests (start a node with `merod local`)")
        }
        var trimmed = node
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        let others = (values["MERO_E2E_NODES"] ?? "").split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return LiveRig(
            nodeURL: trimmed, nodes: others,
            packageVersion: values["MERO_E2E_PACKAGE_VERSION"].flatMap { $0.isEmpty ? nil : $0 })
    }

    /// The process environment (`MERO_E2E_*`, or `TEST_RUNNER_MERO_E2E_*`).
    private static func environment() -> [String: String] {
        var values: [String: String] = [:]
        for (key, value) in ProcessInfo.processInfo.environment where !value.isEmpty {
            if key.hasPrefix("MERO_E2E_") {
                values[key] = value
            } else if key.hasPrefix("TEST_RUNNER_MERO_E2E_") {
                values[String(key.dropFirst("TEST_RUNNER_".count))] = value
            }
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

/// One person on one phone: an account created on the development node with
/// a software passkey (what `MeroClient` does for a node it trusts with mock
/// attestation), and the app's own session wiring on top: ``backend`` is
/// built the way `SessionModel.rebuild` builds it.
@MainActor
final class LiveAccount {
    let label: String
    /// The account id.
    let accountId: String
    let client: MeroClient
    private(set) var backend: CloudChatBackend

    /// The account's `UserId` in the contract (base58), when the id is 64 hex.
    var userId: String { ChatIdentity.userId(accountHex: accountId) ?? "" }

    private init(label: String, accountId: String, client: MeroClient, backend: CloudChatBackend) {
        self.label = label
        self.accountId = accountId
        self.client = client
        self.backend = backend
    }

    /// Create an account named after `label` (plus a nonce) and sign it in.
    static func mint(_ label: String, rig: LiveRig) async throws -> LiveAccount {
        let client = MeroClient(
            config: MeroProviderConfig(
                nodeURL: rig.nodeURL, nodes: rig.nodes, policy: .development, packageName: ChatConstants.packageName,
                packageVersion: rig.packageVersion),
            store: MemoryCloudSessionStore(), session: URLSession(configuration: .ephemeral))
        client.connect(nodeURL: rig.nodeURL, nodes: rig.nodes, allowMock: true)
        let signedUp = await client.signUp(name: "\(label)-\(UUID().uuidString.prefix(6))")
        guard signedUp, let cloud = client.cloud, let account = client.account else {
            throw LiveFailure("\(label): sign-up on \(rig.nodeURL) failed: \(client.errorMessage ?? "no reason")")
        }
        let app = CloudAppBackend(
            client: cloud, account: account, packageName: ChatConstants.packageName,
            packageVersion: rig.packageVersion)
        let backend = CloudChatBackend(
            app: app,
            privateTeams: { org in
                guard let info = try? await cloud.getOrg(org) else { return [] }
                return Set(info.teams.values.filter { $0.join == .invite }.map(\.teamId))
            })
        return LiveAccount(label: label, accountId: account, client: client, backend: backend)
    }

    /// `SessionModel.didJoinWorkspace`: on 1.0 the session needs nothing
    /// after a join (there is no relay to move to).
    func didJoinWorkspace() async throws {}
}

/// Poll `check` until it holds, or fail after `timeout` seconds.
///
/// Membership and metadata a write changes land when the node applies
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
