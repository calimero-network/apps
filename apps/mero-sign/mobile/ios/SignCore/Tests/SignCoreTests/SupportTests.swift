import CoreGraphics
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import SignCore

final class WireAndIdTests: XCTestCase {
    func testIdsDecodeFromBytesOrTextAndBecomeHex() throws {
        let raw = """
            {"signer":\(bytes(IDs.alice)), "signed_at":1788952411519000123}
            """
        let decoded = try JSONDecoder().decode(DocumentSignature.self, from: Data(raw.utf8))
        XCTAssertEqual(decoded.signer.hex, IDs.alice)
        // A nanosecond u64 past 2^53 survives digit for digit.
        XCTAssertEqual(decoded.signedAt, 1_788_952_411_519_000_123)
        let text = try JSONDecoder().decode(DocumentSignature.self, from: Data(
            "{\"signer\":\"\(IDs.bob.uppercased())\",\"signed_at\":1}".utf8))
        XCTAssertEqual(text.signer.hex, IDs.bob)
        XCTAssertTrue(SignIds.same(decoded.signer, IDs.alice))
        let base58 = InviteCodec.base58Encode(try Hex.decode(IDs.blob, label: "b", bytes: 32))
        XCTAssertEqual(ContractBytes.text(base58).hex, IDs.blob)
    }

    func testBlobIdsAcceptHexAndLegacyBase58() {
        XCTAssertEqual(SignIds.blobHex(IDs.blob.uppercased()), IDs.blob)
        XCTAssertEqual(SignIds.blobHex("0x" + IDs.blob), IDs.blob)
        let base58 = InviteCodec.base58Encode(try! Hex.decode(IDs.blob, label: "b", bytes: 32))
        XCTAssertEqual(SignIds.blobHex(base58), IDs.blob)
        XCTAssertEqual(SignIds.blobHex("nope"), "")
    }

    func testShortIdKeepsBothEnds() {
        XCTAssertEqual(SignIds.short(IDs.alice), "a1a1a1a1…a1a1a1")
    }

    func testIntegrityWarningOnlyOnMismatch() {
        let data = Data("pdf".utf8)
        let hash = DocumentHash.sha256Hex(data)
        XCTAssertEqual(hash.count, 64)
        XCTAssertNil(DocumentHash.integrityWarning(bytes: data, recordedHash: hash.uppercased()))
        XCTAssertNil(DocumentHash.integrityWarning(bytes: data, recordedHash: ""))
        XCTAssertNotNil(DocumentHash.integrityWarning(bytes: Data("other".utf8), recordedHash: hash))
    }

    func testFormatting() {
        XCTAssertEqual(SignFormat.status(.partiallySigned), "In progress")
        XCTAssertEqual(SignFormat.initials("Ada Lovelace", id: IDs.alice), "AL")
        XCTAssertEqual(SignFormat.initials(nil, id: IDs.alice), "A1")
        XCTAssertEqual(SignFormat.fileName("NDA", signed: true), "signed-NDA.pdf")
        XCTAssertEqual(SignFormat.tone(IDs.alice), SignFormat.tone(IDs.alice))
        let date = SignFormat.date(nanos: 1_700_000_000_000_000_000)
        XCTAssertEqual(date.timeIntervalSince1970, 1_700_000_000, accuracy: 0.001)
    }
}

final class InkAndStampTests: XCTestCase {
    func testStrokesUndoAndClear() {
        var ink = SignatureInk()
        XCTAssertTrue(ink.isEmpty)
        ink.begin(.init(x: 0, y: 0, time: 0))
        ink.add(.init(x: 0.5, y: 0, time: 0.01))  // too close: dropped
        ink.add(.init(x: 10, y: 0, time: 0.02))
        ink.add(.init(x: 20, y: 5, time: 0.04))
        ink.begin(.init(x: 50, y: 50, time: 1))
        XCTAssertEqual(ink.strokes.count, 2)
        XCTAssertEqual(ink.strokes[0].count, 3)
        ink.undo()
        XCTAssertEqual(ink.strokes.count, 1)
        ink.clear()
        XCTAssertTrue(ink.isEmpty)
    }

    func testSegmentsAreSmoothAndWidthsStayInRange() {
        let stroke = (0..<20).map { SignatureInk.Point(x: CGFloat($0) * 6, y: CGFloat($0 % 3) * 4, time: Double($0) * 0.01) }
        let segments = SignatureInk.segments(stroke)
        XCTAssertEqual(segments.count, stroke.count - 1)
        // Consecutive curves join, and each ends at a midpoint between samples.
        for (a, b) in zip(segments, segments.dropFirst()) { XCTAssertEqual(a.to, b.from) }
        XCTAssertEqual(segments[0].to, CGPoint(x: 9, y: 6))
        for segment in segments {
            XCTAssertGreaterThanOrEqual(segment.width, SignatureInk.minWidth)
            XCTAssertLessThanOrEqual(segment.width, SignatureInk.maxWidth)
        }
        let dot = SignatureInk.segments([.init(x: 1, y: 1, time: 0)])
        XCTAssertEqual(dot.count, 1)
    }

    func testPNGIsTheWholePadOnWhiteAtScale() throws {
        let png = samplePNG()
        XCTAssertEqual(Array(png.prefix(4)), [0x89, 0x50, 0x4E, 0x47])
        let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        XCTAssertEqual(image.width, 600)
        XCTAssertEqual(image.height, 200)
        XCTAssertNil(SignatureInk().renderPNG(size: CGSize(width: 10, height: 10), scale: 1))
    }

    func testStampingKeepsPagesAndChangesTheFile() throws {
        let pdf = samplePDF(pages: 2)
        XCTAssertEqual(PDFStamper.pageSizes(pdf), [CGSize(width: 612, height: 792), CGSize(width: 612, height: 792)])
        let placement = SignaturePlacement(pageIndex: 1, rect: CGRect(x: 400, y: 680, width: 150, height: 50))
        let signed = try PDFStamper().stamp(pdf: pdf, signaturePNG: samplePNG(), at: placement)
        XCTAssertEqual(PDFStamper.pageSizes(signed).count, 2)
        XCTAssertNotEqual(DocumentHash.sha256Hex(signed), DocumentHash.sha256Hex(pdf))
        XCTAssertThrowsError(
            try PDFStamper().stamp(pdf: pdf, signaturePNG: samplePNG(), at: .init(pageIndex: 5, rect: .zero)))
        XCTAssertThrowsError(try PDFStamper().stamp(pdf: Data("x".utf8), signaturePNG: samplePNG(), at: placement))
    }

    func testPlacementStartsOnThePageAndIsClamped() {
        let page = CGSize(width: 612, height: 792)
        let start = SignaturePlacement.initial(pageIndex: 0, pageSize: page, imageAspect: 3)
        XCTAssertTrue(CGRect(origin: .zero, size: page).contains(start.rect))
        XCTAssertEqual(start.rect.width / start.rect.height, 3, accuracy: 0.001)
        let off = SignaturePlacement(pageIndex: 0, rect: CGRect(x: 700, y: -20, width: 100, height: 50)).clamped(to: page)
        XCTAssertEqual(off.rect.maxX, 612, accuracy: 0.001)
        XCTAssertEqual(off.rect.minY, 0, accuracy: 0.001)
    }
}

final class InvitationCodecTests: XCTestCase {
    func testRoundTripsInTheWebFormat() throws {
        let signed = InMemoryAppBackend.invitation(namespaceId: IDs.workspace)
        let invite = SignInvitation(
            invitation: signed, contextId: IDs.agreementContext, contextName: "Lease", workspaceName: "Acme")
        let link = try invite.link()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-sign/join?invitation="))
        let parsed = try XCTUnwrap(SignInvitation.parse(link))
        XCTAssertEqual(parsed.namespaceId, IDs.workspace)
        XCTAssertEqual(parsed.contextId, IDs.agreementContext)
        XCTAssertEqual(parsed.title, "Lease")
        XCTAssertNotNil(SignInvitation.parse(try invite.token()))
        // The desktop form opens too; another app's link does not.
        XCTAssertNotNil(SignInvitation.parse("calimero://com.calimero.mero-sign/join?invitation=\(try invite.token())"))
        XCTAssertNil(SignInvitation.parse("https://links.calimero.network/com.calimero.mero-forum/join?invitation=\(try invite.token())"))
        XCTAssertNil(SignInvitation.parse("hello"))
    }

    func testReadsTheOrgInvitationPayload() throws {
        let json = #"{"invitation":"inv_abc","namespaceId":"org1","name":"NDA","workspaceName":"Acme","extra":1}"#
        let parsed = try XCTUnwrap(SignInvitation.parse(json: json))
        XCTAssertEqual(parsed.namespaceId, "org1")
        XCTAssertEqual(parsed.invitation.token, "inv_abc")
        XCTAssertEqual(parsed.contextName, "NDA")
        XCTAssertEqual(parsed.workspaceName, "Acme")
        XCTAssertNil(parsed.contextId)
    }

    func testTheLinkCarriesAnOrgInviteAndPre10InvitationsAreRefused() throws {
        let invite = SignInvitation(invitation: OrgInvitation(namespaceId: "org1", token: "inv_abc"), contextId: "app1")
        let json = try XCTUnwrap(InviteCodec.decode(token: try invite.token()))
        XCTAssertTrue(json.contains(#""invitation":"inv_abc""#))
        XCTAssertTrue(json.contains(#""namespaceId":"org1""#))
        // The SDK reads the same link as a plain OrgInvitation.
        XCTAssertEqual(OrgInvitation.decode(try invite.token())?.contextId, "app1")
        let old = #"{"invitation":{"invitation":{"group_id":[170]},"inviter_signature":"sig"},"contextId":"c"}"#
        XCTAssertNil(SignInvitation.parse(json: old))
    }

    func testTheNodesErrorsReadAsWords() {
        XCTAssertEqual(
            SignErrorText.describe(ReleaseDeadlineError("deadline", details: ["release": "2.3.110"])),
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.")
        XCTAssertEqual(SignErrorText.describe(NotFound("no such app")), "This isn't shared with you, or it was deleted.")
        XCTAssertEqual(SignErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
    }

}
