import Foundation
import XCTest

@testable import IssueTrackerCore

/// The client speaks the component contract's wire (`logic/res/abi.json`):
/// camelCase names, u64 as decimal strings, explicit `null` for an empty option.
final class ContractWireTests: XCTestCase {
    /// `kind` and `params` of every method in the contract's ABI, minus `init`.
    static let abi: [String: (kind: String, params: [String])] = [
        "addComment": ("call", ["issueId", "body"]),
        "addLabel": ("call", ["issueId", "label"]),
        "createIssue": ("call", ["title", "summary", "impact", "repro", "resolutionCriteria", "priority", "labels"]),
        "deleteComment": ("call", ["commentId"]),
        "deleteIssue": ("call", ["issueId"]),
        "editComment": ("call", ["commentId", "newBody"]),
        "getIssue": ("view", ["issueId"]),
        "getRepoInfo": ("view", []),
        "getStatusCounts": ("view", []),
        "listIssues": ("view", ["status", "assignee", "label"]),
        "removeLabel": ("call", ["issueId", "label"]),
        "setAssignee": ("call", ["issueId", "assignee"]),
        "setImpact": ("call", ["issueId", "impact"]),
        "setPriority": ("call", ["issueId", "priority"]),
        "setRepoUrl": ("call", ["url"]),
        "setRepro": ("call", ["issueId", "repro"]),
        "setResolutionCriteria": ("call", ["issueId", "resolutionCriteria"]),
        "setStatus": ("call", ["issueId", "status"]),
        "setSummary": ("call", ["issueId", "summary"]),
    ]

    func testMethodListsMatchTheABI() {
        XCTAssertEqual(Set(IssueTrackerClient.calls), Set(Self.abi.filter { $0.value.kind == "call" }.keys))
        XCTAssertEqual(Set(IssueTrackerClient.views), Set(Self.abi.filter { $0.value.kind == "view" }.keys))
    }

    func testEveryCallSendsTheABIsArgumentNames() async throws {
        let wire = Recorder()
        let c = IssueTrackerClient(transport: wire)
        _ = try? await c.getRepoInfo()
        _ = try? await c.listIssues()
        _ = try? await c.getIssue(issueId: "i")
        _ = try? await c.getStatusCounts()
        try await c.setRepoUrl(url: "u")
        _ = try? await c.createIssue(
            title: "t", summary: "s", impact: "i", repro: "r", resolutionCriteria: "c", priority: "low")
        try await c.setStatus(issueId: "i", status: "Done")
        try await c.setSummary(issueId: "i", summary: "s")
        try await c.setImpact(issueId: "i", impact: "s")
        try await c.setRepro(issueId: "i", repro: "s")
        try await c.setResolutionCriteria(issueId: "i", resolutionCriteria: "s")
        try await c.setPriority(issueId: "i", priority: "high")
        try await c.setAssignee(issueId: "i", assignee: nil)
        try await c.addLabel(issueId: "i", label: "l")
        try await c.removeLabel(issueId: "i", label: "l")
        _ = try? await c.addComment(issueId: "i", body: "b")
        try await c.editComment(commentId: "c", newBody: "b")
        try await c.deleteComment(commentId: "c")
        try await c.deleteIssue(issueId: "i")

        XCTAssertEqual(Set(wire.sent.map(\.method)), Set(Self.abi.keys))
        for call in wire.sent {
            let spec = try XCTUnwrap(Self.abi[call.method])
            XCTAssertEqual(call.view, spec.kind == "view", call.method)
            XCTAssertEqual(Set(call.args.keys), Set(spec.params), call.method)
        }
    }

    func testAnswersReadDecimalStrings() throws {
        let issue = #"""
            {"id":"issue-1","title":"T","summary":"S","impact":"I","repro":"R","resolutionCriteria":"C",
             "status":"Open","priority":"low","assignee":null,"labels":["ci"],"createdBy":"acc",
             "createdAt":"1767225600000"}
            """#
        let detail = try JSONDecoder().decode(
            IssueDetail.self,
            from: Data(
                #"{"issue":\#(issue),"comments":[{"id":"c","issueId":"issue-1","author":"acc","body":"b","createdAt":"5","editedAt":null}]}"#
                    .utf8))
        XCTAssertEqual(detail.issue.createdAt, 1_767_225_600_000)
        XCTAssertEqual(detail.issue.resolutionCriteria, "C")
        XCTAssertNil(detail.comments[0].editedAt)
        let counts = try JSONDecoder().decode(
            [StatusCount].self, from: Data(#"[{"status":"Open","count":"3"},{"status":"Done","count":0}]"#.utf8))
        XCTAssertEqual(counts.map(\.count), [3, 0])
        // And they go back out as strings, as the node sends them.
        let out = String(decoding: try JSONEncoder().encode(detail.comments[0]), as: UTF8.self)
        XCTAssertTrue(out.contains(#""createdAt":"5""#), out)
    }
}

/// Records each request; answers `null` (so typed answers fail to decode, which the test ignores).
private final class Recorder: ContextContractCalling, @unchecked Sendable {
    struct Sent {
        let method: String
        let view: Bool
        let args: [String: Any]
    }

    private let lock = NSLock()
    private var log: [Sent] = []
    var sent: [Sent] { lock.withLock { log } }

    func query(method: String, argsJSON: Data) async throws -> Data { record(method, argsJSON, view: true) }
    func execute(method: String, argsJSON: Data) async throws -> Data { record(method, argsJSON, view: false) }

    private func record(_ method: String, _ args: Data, view: Bool) -> Data {
        let parsed = (try? JSONSerialization.jsonObject(with: args)) as? [String: Any] ?? [:]
        lock.withLock { log.append(Sent(method: method, view: view, args: parsed)) }
        return Data("null".utf8)
    }
}
