import CoreGraphics
import Foundation
import ImageIO

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

/// ``PDFStamping`` with Core Graphics: every page is drawn into a new PDF
/// (vector content kept as vector), and the signature is drawn over its page,
/// as the web's `pdf-lib` `drawImage` does. Runs on macOS too, so it is tested
/// with `swift test`.
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
        guard let document = Self.document(pdf) else { throw PDFStampError.unreadablePDF }
        guard
            let source = CGImageSourceCreateWithData(signaturePNG as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw PDFStampError.unreadableImage }
        guard placement.pageIndex >= 0, placement.pageIndex < document.numberOfPages else {
            throw PDFStampError.noSuchPage
        }

        let output = NSMutableData()
        guard let consumer = CGDataConsumer(data: output as CFMutableData),
            let context = CGContext(consumer: consumer, mediaBox: nil, nil)
        else { throw PDFStampError.unreadablePDF }

        for index in 0..<document.numberOfPages {
            guard let page = document.page(at: index + 1) else { continue }
            let size = Self.displaySize(page)
            var box = CGRect(origin: .zero, size: size)
            let boxData = Data(bytes: &box, count: MemoryLayout<CGRect>.size) as CFData
            context.beginPDFPage([kCGPDFContextMediaBox as String: boxData] as CFDictionary)
            context.saveGState()
            context.concatenate(page.getDrawingTransform(.cropBox, rect: box, rotate: 0, preserveAspectRatio: true))
            context.drawPDFPage(page)
            context.restoreGState()
            if index == placement.pageIndex {
                let r = placement.rect
                // Top-left (as shown) to PDF space, whose origin is bottom-left.
                context.interpolationQuality = .high
                context.draw(image, in: CGRect(x: r.minX, y: size.height - r.maxY, width: r.width, height: r.height))
            }
            context.endPDFPage()
        }
        context.closePDF()
        return output as Data
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
