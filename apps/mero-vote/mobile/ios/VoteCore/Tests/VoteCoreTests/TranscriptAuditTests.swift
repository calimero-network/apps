import Foundation
import VoteCore
import XCTest

/// The re-audit agrees with the web's `verifyTranscript`, check for check, on
/// every transcript in the vectors (honest, tampered, disagreeing, anchored).
final class TranscriptAuditTests: XCTestCase {
    func testEveryAuditMatchesTheWeb() throws {
        let audits = Vectors.json["audits"] as! [[String: Any]]
        XCTAssertFalse(audits.isEmpty)
        for case let entry in audits {
            let name = entry["name"] as! String
            let transcript = try Vectors.decode(Transcript.self, entry["transcript"]!)
            let web = entry["audit"] as! [String: Any]
            let mine = TranscriptAudit.verify(transcript)
            XCTAssertEqual(mine.verified, web["verified"] as? Bool, name)
            XCTAssertEqual(mine.agreesWithNode, web["agreesWithNode"] as? Bool, name)
            XCTAssertEqual(mine.counts, (web["counts"] as? [Int])?.map { UInt64($0) }, name)
            XCTAssertEqual(mine.digest, web["digest"] as? String, name)
            let checks = (web["checks"] as! [[String: Any]]).map {
                AuditCheck(
                    name: $0["name"] as! String, ok: $0["ok"] as! Bool,
                    detail: ($0["detail"] as! String).replacingOccurrences(of: "in this browser", with: "on this device"))
            }
            XCTAssertEqual(mine.checks, checks, name)
        }
    }

    func testTranscriptTextDigestIsTheWebs() throws {
        let honest = (Vectors.json["audits"] as! [[String: Any]]).first { $0["name"] as? String == "honest" }!
        let t = try Vectors.decode(Transcript.self, honest["transcript"]!)
        let text = TranscriptAudit.transcriptText(
            pollId: t.pollId, definition: t.definition, election: t.state.election!, counted: t.state.closure!.counted,
            counts: t.report.counts!)
        XCTAssertEqual(TranscriptAudit.digest(text), Vectors.json["transcript_digest"] as? String)
    }
}
