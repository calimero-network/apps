import XCTest

@testable import StreamCore

/// The framing against slices the WEB APP's own encoder produced
/// (Fixtures/frame-vectors.json, from mobile/scripts/gen-frame-vectors.ts).
final class FrameVectorTests: XCTestCase {
    struct Vectors: Decodable {
        struct Frame: Decodable {
            let msgSeq: UInt32
            let track: Int
            let isKeyframe: Bool
            let width: Int
            let height: Int
            let timestampUs: UInt64
            let createdAtMs: UInt64
            let startedAtMs: UInt64
            let codec: String
            let bytes: String?
            let byteLength: Int?
            let patternSeed: Int?
        }
        struct Case: Decodable {
            let name: String
            let frame: Frame
            let fragments: [String]
        }
        struct Multi: Decodable {
            let frame: Frame
            let fragmentLengths: [Int]
            let headersHex: [String]
        }
        let maxPayloadAvc: Int
        let cases: [Case]
        let multi: Multi
    }

    private func vectors() throws -> Vectors {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "frame-vectors", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    static func pattern(_ count: Int, seed: Int) -> [UInt8] {
        (0..<count).map { UInt8(truncatingIfNeeded: $0 * 31 + seed) }
    }

    private func frame(_ f: Vectors.Frame, bytes: [UInt8]) -> LiveFrame {
        LiveFrame(
            msgSeq: f.msgSeq, track: f.track, isKeyframe: f.isKeyframe, width: f.width, height: f.height,
            timestampUs: f.timestampUs, createdAtMs: f.createdAtMs, startedAtMs: f.startedAtMs, codec: f.codec, bytes: bytes)
    }

    func testPayloadCapacityMatchesTheWeb() throws {
        XCTAssertEqual(LiveFrames.maxPayloadBytes(codec: "avc1.42001f"), try vectors().maxPayloadAvc)
    }

    func testEncodesExactlyWhatTheWebEncodes() throws {
        for c in try vectors().cases {
            let bytes = try XCTUnwrap([UInt8](hex: c.frame.bytes ?? ""))
            let encoded = try LiveFrames.encodeFragments(frame(c.frame, bytes: bytes))
            XCTAssertEqual(encoded.map(\.hex), c.fragments, c.name)
        }
    }

    func testDecodesWhatTheWebEncodes() throws {
        for c in try vectors().cases {
            let bytes = try XCTUnwrap([UInt8](hex: c.frame.bytes ?? ""))
            let slice = try XCTUnwrap([UInt8](hex: c.fragments[0]))
            let fragment = try XCTUnwrap(LiveFrames.decodeFragment(slice), c.name)
            let out = try XCTUnwrap(FrameReassembler().push("a", fragment))
            XCTAssertEqual(out, frame(c.frame, bytes: bytes), c.name)
        }
    }

    func testMultiFragmentFrameSplitsLikeTheWebAndReassemblesOutOfOrder() throws {
        let multi = try vectors().multi
        let bytes = Self.pattern(try XCTUnwrap(multi.frame.byteLength), seed: try XCTUnwrap(multi.frame.patternSeed))
        let source = frame(multi.frame, bytes: bytes)
        let slices = try LiveFrames.encodeFragments(source)
        XCTAssertEqual(slices.map(\.count), multi.fragmentLengths)
        XCTAssertEqual(slices.map { Array($0.prefix(51)).hex }, multi.headersHex)

        let reassembler = FrameReassembler()
        let fragments = slices.compactMap(LiveFrames.decodeFragment)
        XCTAssertNil(reassembler.push("a", fragments[2]))
        XCTAssertNil(reassembler.push("a", fragments[0]))
        XCTAssertNil(reassembler.push("a", fragments[0]), "a duplicate does not complete the frame")
        XCTAssertEqual(reassembler.push("a", fragments[1]), source)
        XCTAssertNil(reassembler.push("a", fragments[1]), "a replay after completion is ignored")
    }

    func testAFrameMissingAFragmentIsNeverEmitted() throws {
        let slices = try LiveFrames.encodeFragments(
            LiveFrame(
                msgSeq: 3, track: 0, isKeyframe: true, width: 640, height: 480, timestampUs: 0, createdAtMs: 0,
                startedAtMs: 0, codec: "avc1.42001f", bytes: Self.pattern(20_000, seed: 2)))
        let reassembler = FrameReassembler()
        XCTAssertNil(reassembler.push("a", try XCTUnwrap(LiveFrames.decodeFragment(slices[0]))))
        // The next frame completes; the hole behind it is dropped, not held.
        let next = try LiveFrames.encodeFragments(
            LiveFrame(
                msgSeq: 4, track: 0, isKeyframe: false, width: 640, height: 480, timestampUs: 1, createdAtMs: 0,
                startedAtMs: 0, codec: "avc1.42001f", bytes: [1, 2, 3]))
        XCTAssertEqual(reassembler.push("a", try XCTUnwrap(LiveFrames.decodeFragment(next[0])))?.msgSeq, 4)
        XCTAssertEqual(reassembler.pendingCount("a"), 0)
        XCTAssertNil(reassembler.push("a", try XCTUnwrap(LiveFrames.decodeFragment(slices[1]))))
    }

    func testForeignSlicesAreIgnored() {
        XCTAssertNil(LiveFrames.decodeFragment(Array("{\"typing\":true}".utf8)))
        XCTAssertNil(LiveFrames.decodeFragment([0x4D, 0x53, 1] + [UInt8](repeating: 0, count: 60)), "old header version")
        var zeroCount = [UInt8](repeating: 0, count: 50)
        zeroCount[0] = 0x4D
        zeroCount[1] = 0x53
        zeroCount[2] = 2
        XCTAssertNil(LiveFrames.decodeFragment(zeroCount), "fragCount 0")
    }

    func testMsgSeqWraps() {
        XCTAssertEqual(LiveFrames.nextMsgSeq(UInt32.max), 0)
    }
}
