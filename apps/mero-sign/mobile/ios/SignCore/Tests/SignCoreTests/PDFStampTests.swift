import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import XCTest

@testable import SignCore

/// A PDF written by hand with a text form field (AcroForm + widget) and a link
/// annotation, so nothing in it was produced by PDFKit.
func formPDF(rotate: Int = 0) -> Data {
    let content = "BT /F1 18 Tf 72 720 Td (Lease agreement) Tj ET"
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /DA (/Helv 0 Tf 0 g) >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate \(rotate) /Contents 4 0 R "
            + "/Resources << /Font << /F1 7 0 R >> >> /Annots [5 0 R 6 0 R] >>",
        "<< /Length \(content.utf8.count) >>\nstream\n\(content)\nendstream",
        "<< /Type /Annot /Subtype /Widget /FT /Tx /T (tenant_name) /V (Ada) /Rect [72 600 300 624] /P 3 0 R /F 4 >>",
        "<< /Type /Annot /Subtype /Link /Rect [72 560 300 580] /Border [0 0 0] "
            + "/A << /S /URI /URI (https://calimero.network/terms) >> >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    var out = "%PDF-1.7\n"
    var offsets: [Int] = []
    for (i, body) in objects.enumerated() {
        offsets.append(out.utf8.count)
        out += "\(i + 1) 0 obj\n\(body)\nendobj\n"
    }
    let xref = out.utf8.count
    out += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
    for offset in offsets { out += String(format: "%010d 00000 n \n", offset) }
    out += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
    return Data(out.utf8)
}

func cgDocument(_ pdf: Data) -> CGPDFDocument { CGPDFDocument(CGDataProvider(data: pdf as CFData)!)! }

/// The page's annotations as (subtype, dictionary), read with Core Graphics —
/// independent of PDFKit and of the writer, as another viewer reads the file.
/// `doc` must outlive the returned dictionaries.
func annotations(_ doc: CGPDFDocument, page: Int = 1) -> [(String, CGPDFDictionaryRef)] {
    guard let page = doc.page(at: page), let dict = page.dictionary else { return [] }
    var annots: CGPDFArrayRef?
    guard CGPDFDictionaryGetArray(dict, "Annots", &annots), let annots else { return [] }
    var out: [(String, CGPDFDictionaryRef)] = []
    for i in 0..<CGPDFArrayGetCount(annots) {
        var a: CGPDFDictionaryRef?
        var subtype: UnsafePointer<CChar>?
        if CGPDFArrayGetDictionary(annots, i, &a), let a, CGPDFDictionaryGetName(a, "Subtype", &subtype), let subtype {
            out.append((String(cString: subtype), a))
        }
    }
    return out
}

func pdfString(_ dict: CGPDFDictionaryRef, _ key: String) -> String? {
    var value: CGPDFStringRef?
    guard CGPDFDictionaryGetString(dict, key, &value), let value, let text = CGPDFStringCopyTextString(value) else {
        return nil
    }
    return text as String
}

/// The page rendered as shown (rotation applied) at 1 px per point, and how
/// many dark pixels fall inside `rect` (top-left origin).
func inkPixels(_ pdf: Data, page index: Int = 1, in rect: CGRect) -> Int {
    let doc = cgDocument(pdf)
    let page = doc.page(at: index)!
    let size = PDFStamper.pageSizes(pdf)[index - 1]
    let w = Int(size.width)
    let h = Int(size.height)
    let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: w, height: h), rotate: 0, preserveAspectRatio: true))
    ctx.drawPDFPage(page)
    let px = ctx.data!.bindMemory(to: UInt8.self, capacity: w * h * 4)
    var dark = 0
    // Bitmap rows run top-down in memory.
    for y in Int(rect.minY)..<Int(rect.maxY) {
        for x in Int(rect.minX)..<Int(rect.maxX) {
            let o = (y * w + x) * 4
            if px[o] < 80, px[o + 1] < 80, px[o + 2] < 80 { dark += 1 }
        }
    }
    return dark
}

final class PDFStampTests: XCTestCase {
    private let placed = CGRect(x: 380, y: 640, width: 150, height: 50)

    func testSigningKeepsTheOriginalFileAndItsFormFieldAndLink() throws {
        let original = formPDF()
        let signed = try PDFStamper().stamp(
            pdf: original, signaturePNG: samplePNG(), at: SignaturePlacement(pageIndex: 0, rect: placed))

        // An incremental update: the original bytes are untouched.
        XCTAssertEqual(signed.prefix(original.count), original)
        XCTAssertGreaterThan(signed.count, original.count)

        // Read back by Core Graphics: the field (same object in the page and in
        // the form) and the link are as they were.
        let doc = cgDocument(signed)
        let annots = annotations(doc)
        XCTAssertEqual(annots.map(\.0), ["Widget", "Link"])
        XCTAssertEqual(pdfString(annots[0].1, "T"), "tenant_name")
        XCTAssertEqual(pdfString(annots[0].1, "V"), "Ada")
        var action: CGPDFDictionaryRef?
        XCTAssertTrue(CGPDFDictionaryGetDictionary(annots[1].1, "A", &action))
        XCTAssertEqual(pdfString(action!, "URI"), "https://calimero.network/terms")
        var form: CGPDFDictionaryRef?
        var fields: CGPDFArrayRef?
        var field: CGPDFDictionaryRef?
        XCTAssertTrue(CGPDFDictionaryGetDictionary(doc.catalog!, "AcroForm", &form))
        XCTAssertTrue(CGPDFDictionaryGetArray(form!, "Fields", &fields))
        XCTAssertTrue(CGPDFArrayGetDictionary(fields!, 0, &field))
        XCTAssertEqual(field, annots[0].1, "the form's field and the page's widget are one object")

        // The updated page refers to the very same annotation objects.
        let parsed = try PDFIncremental.Document(signed)
        let page = try PDFIncremental.page(parsed, index: 0)
        guard case .array(let refs)? = page.dict.last(where: { $0.0 == "Annots" })?.1 else { return XCTFail("no Annots") }
        XCTAssertEqual(refs.map { if case .ref(let n, _) = $0 { return n } else { return -1 } }, [5, 6])

        // The signature is in the page content: another renderer draws it where it was placed.
        XCTAssertEqual(inkPixels(original, in: placed), 0)
        XCTAssertGreaterThan(inkPixels(signed, in: placed), 50)
        XCTAssertEqual(inkPixels(signed, in: CGRect(x: 380, y: 300, width: 150, height: 50)), 0)
        // And the original text is still drawn.
        XCTAssertGreaterThan(inkPixels(signed, in: CGRect(x: 72, y: 50, width: 160, height: 25)), 20)
    }

    func testAFileWithCrossReferenceAndObjectStreamsIsUpdatedTheSameWay() throws {
        let original = try objectStreamPDF()
        XCTAssertNotNil(CGPDFDocument(CGDataProvider(data: original as CFData)!))
        let signed = try PDFStamper().stamp(
            pdf: original, signaturePNG: samplePNG(), at: SignaturePlacement(pageIndex: 0, rect: placed))
        XCTAssertEqual(signed.prefix(original.count), original)
        XCTAssertTrue(try PDFIncremental.Document(signed).usesXrefStream)
        let doc = cgDocument(signed)
        XCTAssertEqual(annotations(doc).map(\.0), ["Link"])
        XCTAssertGreaterThan(inkPixels(signed, in: placed), 50)
    }

    func testASignatureOnARotatedPageLandsWhereItWasPlaced() throws {
        let original = formPDF(rotate: 90)
        XCTAssertEqual(PDFStamper.pageSizes(original), [CGSize(width: 792, height: 612)])
        let shown = CGRect(x: 560, y: 480, width: 150, height: 50)
        let signed = try PDFStamper().stamp(
            pdf: original, signaturePNG: samplePNG(), at: SignaturePlacement(pageIndex: 0, rect: shown))
        XCTAssertGreaterThan(inkPixels(signed, in: shown), 50)
        // Upright: nothing spills above or below the placed box, as a sideways image would.
        XCTAssertEqual(inkPixels(signed, in: CGRect(x: 560, y: 380, width: 150, height: 95)), 0)
        XCTAssertEqual(inkPixels(signed, in: CGRect(x: 560, y: 535, width: 150, height: 70)), 0)
        XCTAssertEqual(annotations(cgDocument(signed)).map(\.0), ["Widget", "Link"])
        // PDFKit (another parser) reads the update too.
        XCTAssertEqual(PDFKit.PDFDocument(data: signed)?.page(at: 0)?.annotations.count, 2)
    }

    func testTheMatrixMatchesAndroid() {
        let crop = CGRect(x: 0, y: 0, width: 612, height: 792)
        let rect = CGRect(x: 100, y: 50, width: 150, height: 50)
        XCTAssertEqual(SignaturePlacement.imageMatrix(rect, cropBox: crop, rotation: 0), [150, 0, 0, 50, 100, 692])
        XCTAssertEqual(
            SignaturePlacement.imageMatrix(rect, cropBox: CGRect(x: 10, y: 20, width: 612, height: 792), rotation: 0),
            [150, 0, 0, 50, 110, 712])
        XCTAssertEqual(SignaturePlacement.imageMatrix(rect, cropBox: crop, rotation: 90), [0, 150, -50, 0, 100, 100])
    }

    func testTheFallbackAnnotationKeepsFieldsAndLinksAndDrawsInEveryViewer() throws {
        let document = try XCTUnwrap(PDFKit.PDFDocument(data: formPDF()))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithData(samplePNG() as CFData, nil)!, 0, nil))
        let signed = try PDFStamper().annotate(
            document, page: document.page(at: 0)!, image: image, placement: SignaturePlacement(pageIndex: 0, rect: placed))
        let doc = cgDocument(signed)
        let annots = annotations(doc)
        XCTAssertEqual(Set(annots.map(\.0)), ["Widget", "Link", "Stamp"])
        let widget = try XCTUnwrap(annots.first { $0.0 == "Widget" }?.1)
        XCTAssertEqual(pdfString(widget, "T"), "tenant_name")
        let stamp = try XCTUnwrap(annots.first { $0.0 == "Stamp" }?.1)
        XCTAssertEqual(pdfString(stamp, "T"), "Mero Sign")
        var flags: CGPDFInteger = 0
        XCTAssertTrue(CGPDFDictionaryGetInteger(stamp, "F", &flags))
        XCTAssertEqual(flags & 4, 4, "printable")
        var ap: CGPDFDictionaryRef?
        var normal: CGPDFStreamRef?
        XCTAssertTrue(CGPDFDictionaryGetDictionary(stamp, "AP", &ap))
        XCTAssertTrue(CGPDFDictionaryGetStream(ap!, "N", &normal))
        var resources: CGPDFDictionaryRef?
        var xobjects: CGPDFDictionaryRef?
        XCTAssertTrue(CGPDFDictionaryGetDictionary(CGPDFStreamGetDictionary(normal!)!, "Resources", &resources))
        XCTAssertTrue(CGPDFDictionaryGetDictionary(resources!, "XObject", &xobjects))
        XCTAssertEqual(CGPDFDictionaryGetCount(xobjects!), 1)
    }
}

/// A file using a cross-reference STREAM (PNG-predicted) whose page and link
/// live in a compressed OBJECT STREAM, as Acrobat and most tools write today.
func objectStreamPDF() throws -> Data {
    let content = "BT /F1 18 Tf 72 720 Td (Lease agreement) Tj ET"
    // Objects 2 (pages), 3 (page) and 5 (link) inside object stream 6.
    let packed = [
        (2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        (3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> /Annots [5 0 R] >>"),
        (5, "<< /Type /Annot /Subtype /Link /Rect [72 560 300 580] /A << /S /URI /URI (https://calimero.network/terms) >> >>"),
    ]
    var body = ""
    var header = ""
    for (n, text) in packed {
        header += "\(n) \(body.utf8.count) "
        body += text + "\n"
    }
    let objstm = try Flate.deflate(Array((header + body).utf8))
    var out: [UInt8] = Array("%PDF-1.7\n".utf8)
    var offsets: [Int: Int] = [:]
    func obj(_ n: Int, _ dict: String, stream: [UInt8]? = nil) {
        offsets[n] = out.count
        out += Array("\(n) 0 obj\n\(dict)".utf8)
        if let stream { out += Array("\nstream\n".utf8) + stream + Array("\nendstream".utf8) }
        out += Array("\nendobj\n".utf8)
    }
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
    obj(4, "<< /Length \(content.utf8.count) >>", stream: Array(content.utf8))
    obj(6, "<< /Type /ObjStm /N 3 /First \(header.utf8.count) /Filter /FlateDecode /Length \(objstm.count) >>", stream: objstm)
    obj(7, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    // Rows for objects 0–8 (8 = this xref stream): type(1) field2(2) field3(1), PNG Up-predicted.
    let xrefOffset = out.count
    var rows: [[UInt8]] = []
    for n in 0...8 {
        switch n {
        case 2, 3, 5:
            let index = packed.firstIndex { $0.0 == n }!
            rows.append([2, 0, 6, UInt8(index)])
        case 0: rows.append([0, 0, 0, 255])
        case 8: rows.append([1, UInt8(xrefOffset >> 8), UInt8(xrefOffset & 0xFF), 0])
        default: rows.append([1, UInt8(offsets[n]! >> 8), UInt8(offsets[n]! & 0xFF), 0])
        }
    }
    var predicted: [UInt8] = []
    var previous = [UInt8](repeating: 0, count: 4)
    for row in rows {
        predicted.append(2)
        for k in 0..<4 { predicted.append(row[k] &- previous[k]) }
        previous = row
    }
    let xref = try Flate.deflate(predicted)
    out += Array(
        ("8 0 obj\n<< /Type /XRef /Size 9 /Root 1 0 R /W [1 2 1] /Filter /FlateDecode "
            + "/DecodeParms << /Predictor 12 /Columns 4 >> /Length \(xref.count) >>\nstream\n").utf8)
    out += xref
    out += Array("\nendstream\nendobj\nstartxref\n\(xrefOffset)\n%%EOF\n".utf8)
    return Data(out)
}
