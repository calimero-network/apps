import CoreGraphics
import Foundation
import ImageIO
import PDFKit

/// Where a signature goes: a page (0-based) and a rectangle on it in PDF
/// points, measured from the page's TOP-LEFT as the page is shown (rotation
/// applied). The web app measures the same way and converts at save time
/// (`generateSignedPDF`).
public struct SignaturePlacement: Equatable, Sendable {
    public var pageIndex: Int
    public var rect: CGRect

    public init(pageIndex: Int, rect: CGRect) {
        self.pageIndex = pageIndex
        self.rect = rect
    }

    /// A first position for a signature on a page of `pageSize`: a third of the
    /// page wide (at the image's aspect), in the lower right, where a signature
    /// line usually is. The person drags it from there.
    public static func initial(pageIndex: Int, pageSize: CGSize, imageAspect: CGFloat) -> SignaturePlacement {
        let aspect = imageAspect > 0 ? imageAspect : 3
        let width = min(pageSize.width * 0.34, 220)
        let height = width / aspect
        let x = pageSize.width - width - pageSize.width * 0.08
        let y = pageSize.height - height - pageSize.height * 0.1
        return SignaturePlacement(pageIndex: pageIndex, rect: CGRect(x: x, y: y, width: width, height: height))
    }

    /// The same rectangle kept on a page of `pageSize`.
    public func clamped(to pageSize: CGSize, minWidth: CGFloat = 40) -> SignaturePlacement {
        var r = rect
        let aspect = r.height > 0 ? r.width / r.height : 3
        r.size.width = min(max(r.width, minWidth), pageSize.width)
        r.size.height = r.width / aspect
        if r.height > pageSize.height {
            r.size.height = pageSize.height
            r.size.width = r.height * aspect
        }
        r.origin.x = min(max(r.minX, 0), pageSize.width - r.width)
        r.origin.y = min(max(r.minY, 0), pageSize.height - r.height)
        return SignaturePlacement(pageIndex: pageIndex, rect: r)
    }
}

public enum PDFStampError: Error, LocalizedError, Equatable {
    case unreadablePDF
    case unreadableImage
    case noSuchPage

    public var errorDescription: String? {
        switch self {
        case .unreadablePDF: return "This document isn't a PDF this app can read."
        case .unreadableImage: return "Your signature image couldn't be read."
        case .noSuchPage: return "That page isn't in the document."
        }
    }
}

/// Puts a signature image onto one page of a PDF and returns the new PDF.
public protocol PDFStamping: Sendable {
    func stamp(pdf: Data, signaturePNG: Data, at placement: SignaturePlacement) throws -> Data
}

/// ``PDFStamping`` that keeps the original document.
///
/// 1. **Incremental update** (``PDFIncremental``), the normal path: the
///    signature is drawn exactly as the web's `pdf-lib` `page.drawImage` draws
///    it — an image XObject in the page's resources, painted by an appended
///    content stream, the existing content wrapped in `q … Q` — and the file is
///    written as the original bytes followed by an update section. Nothing in
///    the original is rewritten: form fields, links, annotations, fonts and
///    metadata are byte-for-byte what they were.
/// 2. **PDFKit fallback**, only for files the incremental writer refuses
///    (encrypted, or a filter other than Flate in a cross-reference or object
///    stream): a printable, locked `/Stamp` annotation whose appearance
///    stream draws the PNG (``SignatureStampAnnotation``), written with
///    `dataRepresentation()`.
///
/// Runs on macOS too, so it is tested with `swift test`.
public struct PDFStamper: PDFStamping {
    public init() {}

    /// Each page's size as shown (crop box, rotation applied), in points.
    public static func pageSizes(_ pdf: Data) -> [CGSize] {
        guard let document = document(pdf) else { return [] }
        return (0..<document.numberOfPages).compactMap { index in
            document.page(at: index + 1).map(displaySize)
        }
    }

    public func stamp(pdf: Data, signaturePNG: Data, at placement: SignaturePlacement) throws -> Data {
        guard let document = PDFDocument(data: pdf), document.pageCount > 0 else { throw PDFStampError.unreadablePDF }
        guard
            let source = CGImageSourceCreateWithData(signaturePNG as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw PDFStampError.unreadableImage }
        guard placement.pageIndex >= 0, placement.pageIndex < document.pageCount,
            let page = document.page(at: placement.pageIndex)
        else { throw PDFStampError.noSuchPage }

        do {
            return try PDFIncremental.stamp(pdf: pdf, image: image, placement: placement)
        } catch is PDFIncrementalError {
            return try annotate(document, page: page, image: image, placement: placement)
        }
    }

    /// The fallback: a stamp annotation on the page, saved through PDFKit.
    func annotate(_ document: PDFDocument, page: PDFPage, image: CGImage, placement: SignaturePlacement) throws -> Data {
        let crop = page.bounds(for: .cropBox).standardized
        let bounds = Self.pageRect(for: placement.rect, cropBox: crop, rotation: page.rotation)
        page.addAnnotation(SignatureStampAnnotation(bounds: bounds, image: image, rotation: page.rotation))
        guard let out = document.dataRepresentation() else { throw PDFStampError.unreadablePDF }
        return out
    }

    /// A rectangle placed on the page as shown (top-left origin, `/Rotate`
    /// applied) in the page's own space (crop box, bottom-left origin) —
    /// the same mapping Android's `SignaturePlacement.imageMatrix` uses.
    public static func pageRect(for shown: CGRect, cropBox crop: CGRect, rotation: Int) -> CGRect {
        let r = ((rotation % 360) + 360) % 360
        let (x, y, w, h) = (shown.minX, shown.minY, shown.width, shown.height)
        switch r {
        case 90:
            return CGRect(x: crop.minX + y, y: crop.minY + x, width: h, height: w)
        case 180:
            return CGRect(x: crop.maxX - x - w, y: crop.minY + y, width: w, height: h)
        case 270:
            return CGRect(x: crop.maxX - y - h, y: crop.maxY - x - w, width: h, height: w)
        default:
            return CGRect(x: crop.minX + x, y: crop.maxY - y - h, width: w, height: h)
        }
    }

    static func document(_ pdf: Data) -> CGPDFDocument? {
        guard let provider = CGDataProvider(data: pdf as CFData), let document = CGPDFDocument(provider),
            document.numberOfPages > 0
        else { return nil }
        return document
    }

    static func displaySize(_ page: CGPDFPage) -> CGSize {
        let crop = page.getBoxRect(.cropBox).standardized
        let quarterTurn = ((page.rotationAngle % 360) + 360) % 180 == 90
        return quarterTurn ? CGSize(width: crop.height, height: crop.width) : crop.size
    }
}

/// The signature on the page: a `/Stamp` annotation, printable and locked,
/// whose appearance stream PDFKit writes from ``draw(with:in:)`` — the PNG,
/// turned against the page's `/Rotate` so it reads upright as placed.
///
/// Used only when the incremental update can't be written. What differs from
/// the web's `pdf-lib` output then:
/// - the image lives in an annotation's appearance stream, not in the page's
///   content stream, so a viewer set to hide annotations hides it, and an
///   annotation editor could select it (it is flagged Locked + Print so that
///   conforming editors don't move or drop it, and it prints);
/// - PDFKit saves through Quartz: page content streams are re-encoded and
///   fonts re-embedded as subsets, and it writes the form's `/Fields` entries
///   as copies of the page's widget annotations rather than the same objects.
///   Form fields, their values, links and other annotations survive, but the
///   file is not structurally the original.
final class SignatureStampAnnotation: PDFAnnotation {
    private let image: CGImage
    private let pageRotation: Int

    init(bounds: CGRect, image: CGImage, rotation: Int) {
        self.image = image
        self.pageRotation = ((rotation % 360) + 360) % 360
        super.init(bounds: bounds, forType: .stamp, withProperties: nil)
        // /F: Print (4) + Locked (128).
        setValue(132, forAnnotationKey: .flags)
        setValue("Signature", forAnnotationKey: .name)
        contents = "Signature"
        // PDFKit otherwise writes the device owner's full name as the author (/T).
        userName = "Mero Sign"
    }

    required init?(coder: NSCoder) { nil }

    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        context.saveGState()
        context.interpolationQuality = .high
        let b = bounds
        context.translateBy(x: b.midX, y: b.midY)
        // The page is shown turned `pageRotation` degrees clockwise; turn the
        // image the other way so it reads upright.
        context.rotate(by: CGFloat(pageRotation) * .pi / 180)
        let quarter = pageRotation % 180 == 90
        let w = quarter ? b.height : b.width
        let h = quarter ? b.width : b.height
        context.draw(image, in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
        context.restoreGState()
    }
}
