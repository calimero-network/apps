import DesignCore
import SwiftUI
import UIKit

/// Decoded board images by blob id, so a redraw never decodes twice. Only
/// touched from drawing, which SwiftUI does on the main thread.
final class ImageCache: @unchecked Sendable {
    private var images: [String: UIImage] = [:]

    func image(_ blobId: String, data: [String: Data]) -> UIImage? {
        if let hit = images[blobId] { return hit }
        guard let bytes = data[blobId], let img = UIImage(data: bytes) else { return nil }
        images[blobId] = img
        return img
    }
}

/// Text metrics for the scene builder: UIKit's, for the fonts the renderer draws with.
enum Fonts {
    static func uiFont(_ style: TextStyle) -> UIFont {
        let base = UIFont.systemFont(ofSize: style.size, weight: style.bold ? .bold : .regular)
        var descriptor = base.fontDescriptor
        switch style.design {
        case .serif: descriptor = descriptor.withDesign(.serif) ?? descriptor
        case .mono: descriptor = descriptor.withDesign(.monospaced) ?? descriptor
        case .sans: break
        }
        if style.italic, let italic = descriptor.withSymbolicTraits(descriptor.symbolicTraits.union(.traitItalic)) {
            descriptor = italic
        }
        return UIFont(descriptor: descriptor, size: style.size)
    }

    static let measure: MeasureFactory = { style in
        let font = uiFont(style)
        return { text in Double((text as NSString).size(withAttributes: [.font: font]).width) }
    }
}

/// Draws scene nodes read-only into a SwiftUI `Canvas`, in canvas pixels.
/// The caller sets the context's transform (pan, zoom, or a slide's fit).
/// Android's `SceneRenderer.kt` draws the same nodes the same way.
enum SceneRenderer {
    static func draw(_ nodes: [SceneNode], in ctx: GraphicsContext, images: [String: Data], cache: ImageCache) {
        for node in nodes {
            var c = ctx
            c.translateBy(x: node.x, y: node.y)
            if node.rotation != 0 { c.rotate(by: .degrees(node.rotation)) }
            c.opacity = node.opacity
            if let s = node.shadow {
                c.addFilter(.shadow(color: Color(s.color), radius: s.blur / 2, x: s.dx, y: s.dy))
            }
            let box = CGRect(x: 0, y: 0, width: node.width, height: node.height)
            switch node.shape {
            case .rect(let fill, let stroke, let radius):
                let path = radius > 0 ? Path(roundedRect: box, cornerRadius: radius) : Path(box)
                paint(path, fill: fill, stroke: stroke, in: c)
            case .ellipse(let fill, let stroke):
                paint(Path(ellipseIn: CGRect(x: 0, y: 0, width: node.width, height: node.width)), fill: fill, stroke: stroke, in: c)
            case .path(let commands, let fill, let stroke):
                paint(path(commands), fill: fill, stroke: stroke, in: c)
            case .line(let from, let to, let stroke, let head):
                var p = Path()
                p.move(to: CGPoint(x: from.x, y: from.y))
                p.addLine(to: CGPoint(x: to.x, y: to.y))
                c.stroke(p, with: .color(Color(stroke.color)), style: style(stroke))
                if let head {
                    c.fill(path(PathData.polygon(head)), with: .color(Color(stroke.color)))
                }
            case .text(let lines, let style, let color, let clip):
                if clip { c.clip(to: Path(box)) }
                let font = Font(Fonts.uiFont(style))
                let anchor: UnitPoint = style.align == .center ? .top : style.align == .right ? .topTrailing : .topLeading
                for line in lines where !line.text.isEmpty {
                    let text = Text(verbatim: line.text).font(font).foregroundColor(Color(color))
                    c.draw(text, at: CGPoint(x: line.x, y: line.y), anchor: anchor)
                }
            case .image(let blobId, let svg):
                if !svg, let img = cache.image(blobId, data: images) {
                    c.draw(Image(uiImage: img), in: box)
                } else {
                    c.fill(Path(box), with: .color(Color(RGBA.placeholderFill)))
                    c.stroke(Path(box), with: .color(Color(RGBA.placeholderStroke)), lineWidth: 1)
                }
            }
        }
    }

    static func paint(_ p: Path, fill: RGBA?, stroke: Stroke?, in c: GraphicsContext) {
        if let fill { c.fill(p, with: .color(Color(fill))) }
        if let stroke { c.stroke(p, with: .color(Color(stroke.color)), style: style(stroke)) }
    }

    static func style(_ s: Stroke) -> StrokeStyle {
        StrokeStyle(
            lineWidth: s.width, lineCap: s.roundCap ? .round : .butt, lineJoin: s.roundJoin ? .round : .miter,
            dash: (s.dash ?? []).map { CGFloat($0) })
    }

    static func path(_ commands: [PathCommand]) -> Path {
        var p = Path()
        for cmd in commands {
            switch cmd {
            case .move(let pt): p.move(to: cg(pt))
            case .line(let pt): p.addLine(to: cg(pt))
            case .quad(let c, let to): p.addQuadCurve(to: cg(to), control: cg(c))
            case .cubic(let c1, let c2, let to): p.addCurve(to: cg(to), control1: cg(c1), control2: cg(c2))
            case .close: p.closeSubpath()
            }
        }
        return p
    }

    private static func cg(_ p: DesignCore.Point) -> CGPoint { CGPoint(x: p.x, y: p.y) }
}
