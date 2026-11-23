import XCTest

@testable import StreamCore

final class CodecTests: XCTestCase {
    // CPython audioop.lin2ulaw / ulaw2lin (CCITT G.711 reference).
    func testMulawEncodeMatchesReference() {
        let samples: [Int16] = [0, 1, -1, 8, -8, 100, -100, 1000, -1000, 8159, -8159, 32767, -32768, 12345, -12345]
        let expected: [UInt8] = [255, 255, 126, 254, 126, 242, 114, 206, 78, 159, 31, 128, 0, 151, 23]
        XCTAssertEqual(Mulaw.encode(samples), expected)
    }

    func testMulawDecodeMatchesReference() {
        let bytes: [UInt8] = [0x00, 0x7F, 0x80, 0xFF, 0x0F, 0x8F, 0x55, 0xD5]
        XCTAssertEqual(Mulaw.decode(bytes), [-32124, 0, 32124, 0, -16764, 16764, -716, 716])
    }

    func testMulawRoundTripStaysClose() {
        for sample in stride(from: -32000, through: 32000, by: 997) {
            let back = Int(Mulaw.decode(Mulaw.encode(Int16(sample))))
            XCTAssertLessThanOrEqual(abs(back - sample), max(8, abs(sample) / 16), "\(sample)")
        }
    }

    // MARK: H.264 Annex-B

    let sps: [UInt8] = [0x67, 0x42, 0xC0, 0x1F, 0xDA, 0x02, 0x80]
    let pps: [UInt8] = [0x68, 0xCE, 0x3C, 0x80]
    let idr: [UInt8] = [0x65, 0x88, 0x84, 0x00, 0x33]
    let slice: [UInt8] = [0x41, 0x9A, 0x02]

    func testSplitsAnnexBWithThreeAndFourByteStartCodes() {
        let stream: [UInt8] = [0, 0, 0, 1] + sps + [0, 0, 1] + pps + [0, 0, 0, 1] + idr
        XCTAssertEqual(AnnexB.units(stream), [sps, pps, idr])
        XCTAssertTrue(AnnexB.isKeyframe(stream))
        XCTAssertFalse(AnnexB.isKeyframe(AnnexB.stream([slice])))
    }

    func testAVCCRoundTrip() {
        let avcc = AnnexB.avcc([sps, pps, idr])
        XCTAssertEqual(Array(avcc.prefix(4)), [0, 0, 0, 7])
        XCTAssertEqual(AnnexB.unitsFromAVCC(avcc), [sps, pps, idr])
        XCTAssertEqual(AnnexB.units(AnnexB.stream(AnnexB.unitsFromAVCC(avcc))), [sps, pps, idr])
    }

    func testParameterSetsAndCodecString() throws {
        let stream = AnnexB.stream([sps, pps, idr])
        let sets = try XCTUnwrap(AnnexB.parameterSets(stream))
        XCTAssertEqual(sets.sps, sps)
        XCTAssertEqual(sets.pps, pps)
        XCTAssertEqual(AnnexB.codecString(sps: sps), "avc1.42c01f")
        XCTAssertEqual(AnnexB.codecString(sps: [0x67, 0x42, 0x00, 0x1F]), "avc1.42001f", "the web's own string")
        XCTAssertNil(AnnexB.codecString(sps: pps))
    }

    // MARK: Slots (lib/slots.ts) and the shared encoding (lib/capacity.ts)

    func testFirstComeFirstServedWithTwoSlots() {
        let a = Claim(id: "a", startedAtMs: 1_000, firstSeenAt: 1_000, lastSeenAt: 9_000)
        let b = Claim(id: "b", startedAtMs: 2_000, firstSeenAt: 2_000, lastSeenAt: 9_000)
        let view = Slots.evaluate(others: [a, b], me: "me", myStartedAtMs: nil, nowMs: 10_000, timeoutMs: 6_000)
        XCTAssertEqual(view.occupied, 2)
        XCTAssertTrue(view.full)
        XCTAssertFalse(view.mayClaim)

        let late = Slots.evaluate(others: [a, b], me: "me", myStartedAtMs: 3_000, nowMs: 10_000, timeoutMs: 6_000)
        XCTAssertEqual(late.myRank, 2)
        XCTAssertTrue(late.mustYield)
    }

    func testABackdatedClaimIsFlooredAndSilentSendersExpire() {
        let liar = Claim(id: "z", startedAtMs: 0, firstSeenAt: 20_000, lastSeenAt: 21_000)
        let early = Claim(id: "y", startedAtMs: 10_000, firstSeenAt: 10_000, lastSeenAt: 21_000)
        let gone = Claim(id: "x", startedAtMs: 1, firstSeenAt: 1, lastSeenAt: 2)
        let view = Slots.evaluate(others: [liar, early, gone], me: nil, myStartedAtMs: nil, nowMs: 21_000, timeoutMs: 6_000)
        XCTAssertEqual(view.ranked.map(\.id), ["y", "z"])
    }

    func testEncodingIsSharedAmongBroadcasters() {
        let base = Encoding(fps: 25, bitrate: 1_500_000)
        XCTAssertEqual(Encoding.adaptive(base, broadcasters: 1), base)
        XCTAssertEqual(Encoding.adaptive(base, broadcasters: 2), Encoding(fps: 13, bitrate: 750_000))
        XCTAssertEqual(Encoding.adaptive(base, broadcasters: 5), Encoding(fps: 10, bitrate: 400_000))
        XCTAssertEqual(Encoding.adaptive(Encoding(fps: 5, bitrate: 100_000), broadcasters: 3), Encoding(fps: 5, bitrate: 100_000))
    }

    // MARK: People (lib/people.ts)

    func testInitialsAndRoster() {
        XCTAssertEqual(People.initials("Ana Maria Lopez"), "AL")
        XCTAssertEqual(People.initials("bo"), "BO")
        XCTAssertEqual(People.initials("  "), "??")
        let rows = People.roster(
            members: [("b", "Bo"), ("me", "old"), ("a", "")], liveIds: ["b", "c"], me: "me", selfName: "Me",
            selfLive: false)
        XCTAssertEqual(rows.map(\.memberId), ["me", "b", "c", "a"])
        XCTAssertEqual(rows[0].name, "Me")
        XCTAssertEqual(rows[3].name, "a…")
    }
}
