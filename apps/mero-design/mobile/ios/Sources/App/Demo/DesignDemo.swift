#if DEBUG
import DesignCore
import Foundation
import MeroKit
import UIKit

/// Mero Design's demo: three teams, their boards, and one fully drawn board
/// (a habit app's onboarding wireframes: phone frames, shapes, text, sticky
/// notes, arrows and images), with members, comments and two people looking
/// at it. The contract answers `get_elements`, `get_comments`, ... in the
/// generated client's wire shape; comments and replies written in the tour
/// are kept.
enum DesignDemo {
    static let meName = "Maya Chen"
    static let me = person(meName)
    static let applicationId = DemoIds.hex("app:mero-design")

    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }
    static func context(_ board: String) -> String { DemoIds.hex("board:\(board)") }

    /// Unix milliseconds `seconds` before now (the board contract's clock).
    static func ms(ago seconds: TimeInterval) -> UInt64 { UInt64((Date().timeIntervalSince1970 - seconds) * 1000) }

    struct BoardSeed {
        let name: String
        let description: String
        let notes: [String]
    }

    static let teams: [(name: String, members: Int, boards: [BoardSeed])] = [
        ("Atlas Product", 14, [
            BoardSeed(name: Onboarding.name, description: "Wireframes for the 14 Nov release", notes: []),
            BoardSeed(name: "Checkout flow v2", description: "Card, Apple Pay and receipts", notes: [
                "Drop the separate review step: summary sits above the pay button.",
                "Apple Pay first on iOS, card form collapsed by default.",
                "Receipt email needs the VAT line for EU orders.",
                "Error copy for declined cards: say what to try next.",
            ]),
            BoardSeed(name: "Q4 marketing site", description: "Homepage, pricing and launch blog", notes: [
                "Hero: one sentence, one screenshot, one button.",
                "Pricing: annual toggle on by default, show the saving.",
                "Launch post goes live 14 Nov, 9:00 CET.",
                "Customer quotes from the beta survey, with consent.",
            ]),
            BoardSeed(name: "Brand refresh moodboard", description: "Type, colour and photo direction", notes: [
                "Warmer neutrals, keep indigo as the only accent.",
                "Photos: real people, natural light, no stock smiles.",
                "Headline face: tighter tracking at large sizes.",
                "Icons: 2px stroke, rounded joins.",
            ]),
            BoardSeed(name: "Design crit · 23 Oct", description: "Notes and follow-ups", notes: [
                "Empty states feel cold. Add a first action to each.",
                "Settings is too deep: max two levels.",
                "Dark mode contrast fails on secondary text.",
                "Next crit: 6 Nov, bring the widget concepts.",
            ]),
        ]),
        ("Bloom Health", 9, [
            BoardSeed(name: "Patient intake form", description: "Six steps down to three", notes: [
                "Insurance photo capture instead of typing the number.",
                "Save progress: most people finish on a second visit.",
                "Plain-language labels, checked by the clinic team.",
                "Allergies list needs a 'none known' option.",
            ]),
            BoardSeed(name: "Appointment reminders", description: "SMS and push copy", notes: [
                "Send 24 h and 2 h before, never after 21:00.",
                "One-tap reschedule link in every reminder.",
                "Include the clinic address and the doctor's name.",
                "Cancellation reason: optional, three choices.",
            ]),
            BoardSeed(name: "Clinic dashboard", description: "Front desk view, tablet first", notes: [
                "Today's queue as cards, late arrivals flagged amber.",
                "Room status along the top, colour plus label.",
                "Search by name or date of birth.",
                "Print button stays: reception still needs paper.",
            ]),
        ]),
        ("Northside Studio", 4, [
            BoardSeed(name: "Café menu redesign", description: "Print and the ordering tablet", notes: [
                "Group by time of day, not by drink type.",
                "Oat milk at no extra charge: say it on the menu.",
                "Seasonal specials get their own panel.",
                "Prices without currency symbols, they read calmer.",
            ]),
            BoardSeed(name: "Poster series", description: "Autumn jazz nights", notes: [
                "Three posters, one grid, colour changes per night.",
                "Big numerals for the dates.",
                "Risograph look: two inks, slight misregistration.",
                "Venue logo bottom right, 18 mm wide.",
            ]),
        ]),
    ]

    static func makeBackend() -> DemoBackend {
        let store = Store()
        var namespaces: [AppNamespace] = []
        var subgroups: [String: [AppSubgroup]] = [:]
        var joined: Set<String> = []
        for team in teams {
            let id = DemoIds.hex("team:\(team.name)")
            namespaces.append(AppNamespace(id: id, name: team.name, applicationId: applicationId, memberCount: team.members))
            subgroups[id] = team.boards.map { b in
                AppSubgroup(groupId: DemoIds.hex("group:\(b.name)"), name: b.name, contextIds: [context(b.name)])
            }
            for b in team.boards { joined.insert(context(b.name)) }
        }
        return DemoBackend(
            account: me, applicationId: applicationId, namespaces: namespaces, subgroups: subgroups, members: joined,
            handler: { try store.handle($0) })
    }

    // MARK: People

    static let people = ["Maya Chen", "Priya Raman", "Jonas Weber", "Lea Novak", "Tomás Ortega"]

    static func members() -> [Member] {
        people.enumerated().map { i, name in
            let joined = ms(ago: Double(40 - i * 6) * 86_400)
            return Member(id: person(name), username: name, avatar: nil, joinedAt: joined, usernameUpdatedAt: joined)
        }
    }

    // MARK: Contract

    struct Board {
        var name: String
        var description: String
        var elements: [Element]
        var comments: [Comment]
        var members: [Member]
        /// People looking at the board: name and pointer position.
        var viewers: [(String, Int64, Int64)]
    }

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var boards: [String: Board] = [:]

        init() {
            for team in DesignDemo.teams {
                for seed in team.boards {
                    boards[DesignDemo.context(seed.name)] =
                        seed.name == Onboarding.name
                        ? Onboarding.board()
                        : Sketch.board(seed)
                }
            }
        }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            guard var board = boards[call.contextId] else { throw DemoContractError("context not found") }
            defer { boards[call.contextId] = board }
            let me = DesignDemo.me
            func u64(_ key: String) -> UInt64 { (call.args[key] as? NSNumber)?.uint64Value ?? DesignDemo.ms(ago: 0) }
            func i64(_ key: String) -> Int64 { (call.args[key] as? NSNumber)?.int64Value ?? 0 }

            switch call.method {
            case "get_board":
                return try DemoReply.json(
                    BoardInfo(
                        name: board.name, description: board.description, elementCount: UInt32(board.elements.count),
                        memberCount: UInt32(board.members.count), owner: board.members.first { $0.username == "Priya Raman" }?.id))
            case "get_elements":
                return try DemoReply.json(board.elements.sorted { $0.layerIndex < $1.layerIndex })
            case "get_comments":
                return try DemoReply.json(board.comments)
            case "get_members":
                return try DemoReply.json(board.members)
            case "my_role":
                return try DemoReply.json("editor")
            case "can_edit":
                return try DemoReply.json(true)
            case "get_cursors":
                let now = DesignDemo.ms(ago: 1.5)
                return try DemoReply.json(
                    board.viewers.map { name, x, y in
                        CursorState(
                            identity: DemoIds.hex("device:\(name)"), account: DesignDemo.person(name), x: x, y: y, updatedAt: now)
                    })
            case "add_comment":
                let id = call.string("id") ?? UUID().uuidString.lowercased()
                let comment = Comment(
                    id: id, x: i64("x"), y: i64("y"), content: call.string("content") ?? "", author: me,
                    createdAt: u64("created_at"), replies: board.comments.first { $0.id == id }?.replies ?? [])
                board.comments.removeAll { $0.id == id }
                board.comments.append(comment)
            case "add_reply":
                guard let i = board.comments.firstIndex(where: { $0.id == call.string("comment_id") }) else {
                    throw DemoContractError("comment not found")
                }
                board.comments[i].replies.append(
                    CommentReply(
                        id: call.string("reply_id") ?? UUID().uuidString.lowercased(), content: call.string("content") ?? "",
                        author: me, createdAt: u64("created_at")))
            case "join":
                if !board.members.contains(where: { $0.id == me }) {
                    let at = u64("timestamp")
                    board.members.append(
                        Member(id: me, username: call.string("username") ?? DesignDemo.meName, avatar: nil, joinedAt: at, usernameUpdatedAt: at))
                }
            default:
                break
            }
            return DemoReply.null
        }
    }

    // MARK: Images

    static let heroBlob = DemoIds.hex("blob:onboarding-hero")
    static let avatarBlob = DemoIds.hex("blob:avatar-maya")

    struct Blobs: BlobLoading {
        func blob(id: String, contextId: String) async throws -> Data {
            try await Task.sleep(for: .milliseconds(250))
            switch id {
            case DesignDemo.heroBlob: return Art.hero
            case DesignDemo.avatarBlob: return Art.avatar
            default: throw URLError(.fileDoesNotExist)
            }
        }
    }

    /// The board's two pictures, drawn once: a sunrise over hills, and a profile photo stand-in.
    enum Art {
        static let hero: Data = {
            let size = CGSize(width: 654, height: 640)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            return UIGraphicsImageRenderer(size: size, format: format).pngData { ctx in
                let cg = ctx.cgContext
                let space = CGColorSpaceCreateDeviceRGB()
                UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 36).addClip()
                let sky = CGGradient(
                    colorsSpace: space,
                    colors: [UIColor(hex: 0xFFF4DB).cgColor, UIColor(hex: 0xFFD3A8).cgColor, UIColor(hex: 0xFCA982).cgColor] as CFArray,
                    locations: [0, 0.55, 1])!
                cg.drawLinearGradient(sky, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
                // Sun, with a soft halo.
                UIColor(hex: 0xFFFFFF, alpha: 0.35).setFill()
                UIBezierPath(ovalIn: CGRect(x: 330, y: 150, width: 220, height: 220)).fill()
                UIColor(hex: 0xFB8B4B).setFill()
                UIBezierPath(ovalIn: CGRect(x: 365, y: 185, width: 150, height: 150)).fill()
                // Clouds.
                UIColor(hex: 0xFFFFFF, alpha: 0.85).setFill()
                for (x, y, s) in [(70.0, 120.0, 1.0), (250.0, 70.0, 0.7), (470.0, 110.0, 0.8)] {
                    UIBezierPath(roundedRect: CGRect(x: x, y: y, width: 130 * s, height: 34 * s), cornerRadius: 17 * s).fill()
                    UIBezierPath(ovalIn: CGRect(x: x + 30 * s, y: y - 24 * s, width: 60 * s, height: 56 * s)).fill()
                }
                // Hills, back to front.
                func hill(_ color: UInt32, _ y0: CGFloat, _ c1: CGPoint, _ c2: CGPoint, _ y1: CGFloat) {
                    let p = UIBezierPath()
                    p.move(to: CGPoint(x: 0, y: y0))
                    p.addCurve(to: CGPoint(x: size.width, y: y1), controlPoint1: c1, controlPoint2: c2)
                    p.addLine(to: CGPoint(x: size.width, y: size.height))
                    p.addLine(to: CGPoint(x: 0, y: size.height))
                    p.close()
                    UIColor(hex: color).setFill()
                    p.fill()
                }
                hill(0xC7CBF7, 380, CGPoint(x: 180, y: 290), CGPoint(x: 420, y: 420), 330)
                hill(0x8E93EE, 450, CGPoint(x: 220, y: 360), CGPoint(x: 430, y: 520), 420)
                hill(0x5B5BD6, 540, CGPoint(x: 160, y: 470), CGPoint(x: 470, y: 600), 500)
                // A path winding up the front hill.
                let trail = UIBezierPath()
                trail.move(to: CGPoint(x: 250, y: 640))
                trail.addCurve(to: CGPoint(x: 330, y: 520), controlPoint1: CGPoint(x: 360, y: 600), controlPoint2: CGPoint(x: 220, y: 560))
                trail.lineWidth = 14
                trail.lineCapStyle = .round
                UIColor(hex: 0xFFE7C2, alpha: 0.9).setStroke()
                trail.stroke()
                // A flag at the top.
                UIColor(hex: 0x2B2B6E).setFill()
                UIBezierPath(rect: CGRect(x: 328, y: 470, width: 4, height: 52)).fill()
                let flag = UIBezierPath()
                flag.move(to: CGPoint(x: 332, y: 470))
                flag.addLine(to: CGPoint(x: 368, y: 481))
                flag.addLine(to: CGPoint(x: 332, y: 492))
                flag.close()
                UIColor(hex: 0xFACC15).setFill()
                flag.fill()
            }
        }()

        static let avatar: Data = {
            let size = CGSize(width: 120, height: 120)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            return UIGraphicsImageRenderer(size: size, format: format).pngData { ctx in
                let rect = CGRect(origin: .zero, size: size)
                UIBezierPath(ovalIn: rect).addClip()
                let g = CGGradient(
                    colorsSpace: CGColorSpaceCreateDeviceRGB(),
                    colors: [UIColor(hex: 0xF9A8D4).cgColor, UIColor(hex: 0x818CF8).cgColor] as CFArray, locations: [0, 1])!
                ctx.cgContext.drawLinearGradient(g, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
                let text = NSAttributedString(
                    string: "MC",
                    attributes: [.font: UIFont.systemFont(ofSize: 44, weight: .semibold), .foregroundColor: UIColor.white])
                let t = text.size()
                text.draw(at: CGPoint(x: (size.width - t.width) / 2, y: (size.height - t.height) / 2))
            }
        }()
    }
}

private extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha)
    }
}

// MARK: - Drawing boards

/// Builds a board's elements in paint order, the way the web canvas stores them.
struct BoardBuilder {
    private(set) var elements: [Element] = []
    let seed: String
    let author: String
    let createdAt: UInt64

    static let ink = "#18181b"
    static let gray = "#71717a"
    static let accent = "#5b5bd6"
    static let accentSoft = "#eef0ff"
    static let hairline = "#e4e4e7"

    init(seed: String, author: String, createdAt: UInt64) {
        self.seed = seed
        self.author = author
        self.createdAt = createdAt
    }

    private func uuid(_ n: Int) -> String {
        let h = Array(DemoIds.hex("\(seed):\(n)"))
        func part(_ a: Int, _ b: Int) -> String { String(h[a..<b]) }
        return "\(part(0, 8))-\(part(8, 12))-4\(part(13, 16))-a\(part(17, 20))-\(part(20, 32))"
    }

    @discardableResult
    mutating func add(
        _ data: ElementData, _ x: Int, _ y: Int, _ w: Int, _ h: Int, fill: String = "transparent", stroke: String = "transparent",
        strokeWidth: UInt32 = 0, radius: UInt32? = nil, rotation: Int32 = 0, opacity: UInt32 = 100, label: String? = nil,
        shadow: Bool = false
    ) -> String {
        let id = uuid(elements.count)
        elements.append(
            Element(
                id: id, data: data, x: Int64(x), y: Int64(y), width: UInt32(max(1, w)), height: UInt32(max(1, h)),
                rotation: rotation, fill: fill, stroke: stroke, strokeWidth: strokeWidth, opacity: opacity,
                layerIndex: UInt32(elements.count), createdBy: author, createdAt: createdAt, updatedAt: createdAt,
                shadowColor: shadow ? "rgba(24,24,27,0.10)" : nil, shadowOffsetX: shadow ? 0 : nil,
                shadowOffsetY: shadow ? 12 : nil, shadowBlur: shadow ? 32 : nil, label: label, cornerRadius: radius))
        return id
    }

    mutating func rect(
        _ x: Int, _ y: Int, _ w: Int, _ h: Int, fill: String, stroke: String = "transparent", width: UInt32 = 0,
        radius: UInt32 = 0, label: String? = nil, shadow: Bool = false
    ) {
        add(.rect, x, y, w, h, fill: fill, stroke: stroke, strokeWidth: width, radius: radius, label: label, shadow: shadow)
    }

    mutating func circle(_ x: Int, _ y: Int, _ d: Int, fill: String, stroke: String = "transparent", width: UInt32 = 0) {
        add(.circle, x, y, d, d, fill: fill, stroke: stroke, strokeWidth: width)
    }

    mutating func text(
        _ s: String, _ x: Int, _ y: Int, _ w: Int, _ h: Int, size: UInt32, color: String = BoardBuilder.ink, bold: Bool = false,
        italic: Bool = false, align: String? = nil, valign: String? = nil, family: String = "Inter, sans-serif"
    ) {
        add(
            .text(ElementData_Text(content: s, fontSize: size, fontFamily: family, bold: bold, italic: italic, textAlign: align, verticalAlign: valign)),
            x, y, w, h, fill: color)
    }

    mutating func sticky(_ s: String, _ x: Int, _ y: Int, _ w: Int, _ h: Int, color: String, rotation: Int32) {
        add(
            .text(ElementData_Text(content: s, fontSize: 18, fontFamily: "Inter, sans-serif", bold: false, italic: false)),
            x, y, w, h, fill: color, rotation: rotation, label: "\u{1F}b=sticky", shadow: true)
    }

    mutating func box(_ s: String, _ x: Int, _ y: Int, _ w: Int, _ h: Int) {
        add(
            .text(ElementData_Text(content: s, fontSize: 17, fontFamily: "Inter, sans-serif", bold: false, italic: false)),
            x, y, w, h, fill: "#ffffff", stroke: "#a1a1aa", strokeWidth: 2, radius: 12, label: "\u{1F}b=box")
    }

    mutating func arrow(_ x: Int, _ y: Int, dx: Int, dy: Int, color: String = BoardBuilder.accent, dashed: Bool = false) {
        let ox = min(0, dx)
        let oy = min(0, dy)
        add(
            .arrow(ElementData_Arrow(points: "\(-ox),\(-oy) \(dx - ox),\(dy - oy)")), x + ox, y + oy, abs(dx), max(2, abs(dy)),
            stroke: color, strokeWidth: 3, label: dashed ? "\u{1F}s=dashed" : nil)
    }

    mutating func line(_ x: Int, _ y: Int, _ w: Int, color: String = BoardBuilder.hairline) {
        add(.line(ElementData_Line(points: "0,0 \(w),0")), x, y, w, 2, stroke: color, strokeWidth: 1)
    }

    mutating func path(_ d: String, _ x: Int, _ y: Int, _ w: Int, _ h: Int, color: String, width: UInt32) {
        add(.path(ElementData_Path(points: d)), x, y, w, h, stroke: color, strokeWidth: width)
    }

    mutating func shape(_ kind: String, _ x: Int, _ y: Int, _ w: Int, _ h: Int, fill: String, rotation: Int32 = 0) {
        add(.path(ElementData_Path(points: "")), x, y, w, h, fill: fill, rotation: rotation, label: "\u{1F}h=\(kind)")
    }

    mutating func image(_ blobId: String, _ x: Int, _ y: Int, _ w: Int, _ h: Int, natural: (UInt32, UInt32)) {
        add(.image(ElementData_Image(naturalWidth: natural.0, naturalHeight: natural.1, blobId: blobId)), x, y, w, h)
    }

    // Phone furniture.

    mutating func statusBar(_ ox: Int, _ oy: Int) {
        text("9:41", ox + 30, oy + 18, 50, 20, size: 15, bold: true)
        rect(ox + 318, oy + 22, 26, 12, fill: "transparent", stroke: BoardBuilder.ink, width: 2, radius: 4)
        rect(ox + 321, oy + 25, 17, 6, fill: BoardBuilder.ink, radius: 2)
        rect(ox + 140, oy + 12, 96, 28, fill: BoardBuilder.ink, radius: 14)
    }

    mutating func back(_ ox: Int, _ oy: Int) {
        path("M 10 0 L 0 9 L 10 18", ox + 28, oy + 60, 10, 18, color: BoardBuilder.ink, width: 3)
    }

    mutating func progress(_ ox: Int, _ oy: Int, step: Int) {
        rect(ox + 64, oy + 66, 263, 6, fill: BoardBuilder.hairline, radius: 3)
        rect(ox + 64, oy + 66, 263 * step / 3, 6, fill: BoardBuilder.accent, radius: 3)
    }

    mutating func button(_ label: String, _ ox: Int, _ y: Int) {
        rect(ox + 24, y, 327, 56, fill: BoardBuilder.accent, radius: 16)
        text(label, ox + 24, y, 327, 56, size: 18, color: "#ffffff", bold: true, align: "center", valign: "middle")
    }

    mutating func check(_ x: Int, _ y: Int) {
        path("M 0 6 L 5 11 L 14 1", x, y, 14, 12, color: "#ffffff", width: 3)
    }
}

/// The board the tour opens: Tally's onboarding, four phone screens in a 2×2
/// grid, the flow between them, research notes and decisions on the right.
enum Onboarding {
    static let name = "Tally · Onboarding v3"
    static let description = "Wireframes for the 14 Nov release"

    static func board() -> DesignDemo.Board {
        let p = DesignDemo.person
        var b = BoardBuilder(seed: "board:onboarding", author: p("Priya Raman"), createdAt: DesignDemo.ms(ago: 6 * 86_400))
        let ink = BoardBuilder.ink
        let gray = BoardBuilder.gray
        let accent = BoardBuilder.accent
        let soft = BoardBuilder.accentSoft
        let hair = BoardBuilder.hairline

        // Section and title.
        b.rect(-60, -50, 1360, 2070, fill: "#f5f5f2", radius: 40)
        b.text("Tally · Onboarding v3", 0, 10, 820, 50, size: 42, bold: true)
        b.text("Four screens from first launch to the first check-in. For the 14 Nov release.", 0, 72, 900, 24, size: 20, color: gray)
        b.shape("star", 1170, 0, 64, 64, fill: "#facc15", rotation: 12)

        let cols = [0, 485]
        let rows = [180, 1142]
        func frame(_ name: String, _ ox: Int, _ oy: Int) {
            b.rect(ox, oy, 375, 812, fill: "#ffffff", stroke: hair, width: 1, radius: 44, label: "screen/\(name)", shadow: true)
            b.statusBar(ox, oy)
            b.rect(ox + 120, oy + 796, 135, 5, fill: ink, radius: 3)
        }

        // 1. Welcome.
        var ox = cols[0], oy = rows[0]
        frame("Welcome @1", ox, oy)
        b.image(DesignDemo.heroBlob, ox + 24, oy + 64, 327, 320, natural: (654, 640))
        b.circle(ox + 24, oy + 410, 30, fill: accent)
        b.check(ox + 32, oy + 420)
        b.text("Tally", ox + 64, oy + 413, 120, 24, size: 20, bold: true)
        b.text("Build habits\nthat stick.", ox + 24, oy + 462, 327, 84, size: 34, bold: true)
        b.text("Small daily wins, tracked on your\nphone and shared only with the\npeople you choose.", ox + 24, oy + 562, 327, 66, size: 17, color: "#52525b")
        b.rect(ox + 24, oy + 666, 22, 8, fill: accent, radius: 4)
        b.circle(ox + 54, oy + 666, 8, fill: "#d4d4d8")
        b.circle(ox + 70, oy + 666, 8, fill: "#d4d4d8")
        b.button("Get started", ox, oy + 696)
        b.text("I already have an account", ox + 24, oy + 764, 327, 22, size: 16, color: accent, bold: true, align: "center")

        // 2. Pick habits.
        ox = cols[1]
        frame("Pick habits @2", ox, oy)
        b.back(ox, oy)
        b.progress(ox, oy, step: 1)
        b.text("Pick 3 habits to\nstart with", ox + 24, oy + 100, 327, 70, size: 28, bold: true)
        b.text("You can add more any time.", ox + 24, oy + 178, 327, 22, size: 16, color: gray)
        let habits: [(String, String, Bool)] = [
            ("Drink 2 L of water", "#38bdf8", true), ("Read 20 pages", "#f59e0b", true), ("Walk 8,000 steps", "#22c55e", false),
            ("Meditate 10 minutes", "#a78bfa", true), ("No phone after 10 pm", "#f43f5e", false), ("Stretch in the morning", "#14b8a6", false),
        ]
        for (i, h) in habits.enumerated() {
            let y = oy + 220 + i * 74
            b.rect(ox + 24, y, 327, 62, fill: h.2 ? soft : "#ffffff", stroke: h.2 ? accent : hair, width: h.2 ? 2 : 1, radius: 16)
            b.circle(ox + 40, y + 15, 32, fill: h.1)
            b.text(h.0, ox + 86, y, 220, 62, size: 17, bold: h.2, valign: "middle")
            if h.2 {
                b.circle(ox + 313, y + 19, 24, fill: accent)
                b.check(ox + 318, y + 25)
            } else {
                b.circle(ox + 313, y + 19, 24, fill: "#ffffff", stroke: "#d4d4d8", width: 2)
            }
        }
        b.button("Continue · 3 selected", ox, oy + 696)

        // 3. Reminder.
        ox = cols[0]
        oy = rows[1]
        frame("Reminder @3", ox, oy)
        b.back(ox, oy)
        b.progress(ox, oy, step: 2)
        b.text("When should we\nnudge you?", ox + 24, oy + 100, 327, 70, size: 28, bold: true)
        b.text("One gentle reminder a day. No streak\nshaming, promise.", ox + 24, oy + 178, 327, 44, size: 16, color: gray)
        b.rect(ox + 24, oy + 244, 327, 150, fill: "#f4f4f5", radius: 24)
        b.text("7:30 AM", ox + 24, oy + 262, 327, 76, size: 56, bold: true, align: "center")
        b.text("Weekdays · Morning", ox + 24, oy + 344, 327, 22, size: 16, color: gray, align: "center")
        for (i, day) in ["M", "T", "W", "T", "F", "S", "S"].enumerated() {
            let x = ox + 24 + i * 48
            let on = i < 5
            b.circle(x, oy + 420, 40, fill: on ? accent : "#f4f4f5")
            b.text(day, x, oy + 420, 40, 40, size: 16, color: on ? "#ffffff" : gray, bold: true, align: "center", valign: "middle")
        }
        for (i, row) in [("Smart timing", "Shift reminders when you're busy", true), ("Weekly summary", "A short recap every Sunday evening", false)].enumerated() {
            let y = oy + 490 + i * 80
            b.rect(ox + 24, y, 327, 68, fill: "#ffffff", stroke: hair, width: 1, radius: 16)
            b.text(row.0, ox + 42, y + 13, 230, 22, size: 17, bold: true)
            b.text(row.1, ox + 42, y + 38, 240, 18, size: 14, color: gray)
            b.rect(ox + 289, y + 20, 46, 28, fill: row.2 ? "#22c55e" : "#e4e4e7", radius: 14)
            b.circle(ox + (row.2 ? 309 : 291), y + 22, 24, fill: "#ffffff")
        }
        b.button("Turn on reminders", ox, oy + 696)
        b.text("Not now", ox + 24, oy + 764, 327, 22, size: 16, color: gray, bold: true, align: "center")

        // 4. Today.
        ox = cols[1]
        frame("Today @4", ox, oy)
        b.text("Wednesday, 28 October", ox + 24, oy + 62, 260, 20, size: 15, color: gray)
        b.text("Good morning, Maya", ox + 24, oy + 84, 280, 36, size: 28, bold: true)
        b.image(DesignDemo.avatarBlob, ox + 303, oy + 64, 48, 48, natural: (120, 120))
        b.rect(ox + 24, oy + 140, 327, 150, fill: accent, radius: 24)
        b.circle(ox + 46, oy + 165, 100, fill: "transparent", stroke: "rgba(255,255,255,0.28)", width: 10)
        b.path(arc(degrees: 240), ox + 46, oy + 165, 100, 100, color: "#ffffff", width: 10)
        b.text("2/3", ox + 46, oy + 165, 100, 100, size: 26, color: "#ffffff", bold: true, align: "center", valign: "middle")
        b.text("2 of 3 done", ox + 170, oy + 178, 170, 28, size: 22, color: "#ffffff", bold: true)
        b.text("Keep going, your\nstreak is 12 days.", ox + 170, oy + 212, 170, 44, size: 15, color: "#e0e3ff")
        b.text("Today", ox + 24, oy + 314, 200, 24, size: 19, bold: true)
        let today: [(String, String, Bool, String)] = [
            ("Drink 2 L of water", "12-day streak", true, "#38bdf8"), ("Read 20 pages", "5-day streak", true, "#f59e0b"),
            ("Meditate 10 minutes", "Tonight, 9:30 pm", false, "#a78bfa"),
        ]
        for (i, h) in today.enumerated() {
            let y = oy + 348 + i * 74
            b.rect(ox + 24, y, 327, 62, fill: "#ffffff", stroke: hair, width: 1, radius: 16)
            b.rect(ox + 24, y, 6, 62, fill: h.3, radius: 3)
            b.text(h.0, ox + 46, y + 11, 230, 22, size: 17, bold: true)
            b.text(h.1, ox + 46, y + 35, 230, 18, size: 14, color: gray)
            if h.2 {
                b.circle(ox + 309, y + 17, 28, fill: "#22c55e")
                b.check(ox + 316, y + 25)
            } else {
                b.circle(ox + 309, y + 17, 28, fill: "#ffffff", stroke: "#d4d4d8", width: 2)
            }
        }
        b.text("This week", ox + 24, oy + 580, 200, 24, size: 19, bold: true)
        let bars = [62, 80, 100, 44, 92, 0, 0]
        for (i, v) in bars.enumerated() {
            let x = ox + 32 + i * 46
            b.rect(x, oy + 616, 28, 96, fill: "#f4f4f5", radius: 8)
            if v > 0 { b.rect(x, oy + 712 - v * 96 / 100, 28, v * 96 / 100, fill: i == 2 ? accent : "#c7cbf7", radius: 8) }
            b.text(["M", "T", "W", "T", "F", "S", "S"][i], x, oy + 718, 28, 16, size: 12, color: gray, align: "center")
        }
        b.line(ox, oy + 744, 375)
        for (i, tab) in ["Today", "Habits", "Profile"].enumerated() {
            let x = ox + 24 + i * 113
            b.rect(x + 42, oy + 754, 22, 22, fill: i == 0 ? accent : "#d4d4d8", radius: 7)
            b.text(tab, x, oy + 778, 106, 16, size: 12, color: i == 0 ? accent : gray, bold: i == 0, align: "center")
        }

        // The flow.
        b.arrow(cols[0] + 392, rows[0] + 724, dx: 76, dy: 0)
        b.text("Get started", cols[0] + 380, rows[0] + 690, 100, 20, size: 14, color: accent, bold: true, align: "center")
        b.arrow(cols[1] + 187, rows[0] + 830, dx: -(cols[1] + 187 - 187), dy: rows[1] - rows[0] - 830 - 18, dashed: true)
        b.text("3 habits picked", 330, rows[0] + 850, 140, 20, size: 14, color: accent, bold: true, align: "center")
        b.arrow(cols[0] + 392, rows[1] + 724, dx: 76, dy: 0)
        b.text("Allow", cols[0] + 380, rows[1] + 690, 100, 20, size: 14, color: accent, bold: true, align: "center")

        // Notes on the right.
        let nx = 960
        b.text("Research and notes", nx, 180, 300, 28, size: 22, bold: true)
        b.sticky("62% of people who churned never finished a habit in week one. Show a win on day one.", nx, 230, 240, 200, color: "#fef08a", rotation: -2)
        b.sticky("Open question: ask for notifications before or after picking habits? A/B on Thursday.", nx + 10, 470, 240, 200, color: "#fbcfe8", rotation: 2)
        b.sticky("Keep body copy under 12 words per screen. Big type, one action.", nx, 710, 240, 180, color: "#bbf7d0", rotation: -1)
        b.sticky("Brand kit icons land Friday. Priya swaps the placeholders.", nx + 6, 930, 240, 170, color: "#bfdbfe", rotation: 1)
        b.box("Decisions\n\n• No account until day 3\n• Default reminder 7:30 AM, weekdays\n• No social feed in v1\n• Streaks forgive one missed day", nx, 1142, 260, 250)
        b.text("Owner: Priya Raman\nReview: Jonas Weber\nCopy: Lea Novak", nx, 1420, 260, 70, size: 16, color: gray)

        let comments: [Comment] = [
            comment("c1", 230, 380, "Priya Raman", 2 * 86_400 + 3_600,
                    "Can we swap this illustration for a photo from the brand shoot? Feels more personal.", replies: [
                ("Jonas Weber", 2 * 86_400 - 1_800, "Licensing for those clears Friday, I'll drop them in then."),
                ("Maya Chen", 86_400 + 7_200, "+1. The sunrise one from the hike set would fit here."),
            ]),
            comment("c2", 300, 880, "Jonas Weber", 86_400 + 4_000,
                    "\"Get started\" tested better than \"Continue\" in the last round: 54% vs 41% tap-through.", replies: [
                ("Lea Novak", 86_400 - 2_000, "Nice, keeping it."),
            ]),
            comment("c3", 260, 1440, "Lea Novak", 5 * 3_600,
                    "Default to 8:00 instead of 7:30? Most beta users moved it later.", replies: [
                ("Priya Raman", 4 * 3_600, "Let's check the beta data first. Tomás, can you pull it?"),
                ("Tomás Ortega", 3 * 3_600, "Median chosen time was 7:45. Splitting the difference works."),
            ]),
            comment("c4", 610, 1340, "Tomás Ortega", 2 * 3_600,
                    "Streak count should animate on the first check-in. I'll prototype it in Rive.", replies: []),
            comment("c5", 1080, 560, "Maya Chen", 40 * 60,
                    "Moved the notification ask after habit pick, per the research note.", replies: []),
        ]
        return DesignDemo.Board(
            name: name, description: description, elements: b.elements, comments: comments, members: DesignDemo.members(),
            viewers: [("Priya Raman", 300, 330), ("Jonas Weber", 760, 1560)])
    }

    /// An open ring's arc, clockwise from 12 o'clock, in a 100×100 box.
    static func arc(degrees: Double) -> String {
        let steps = Int(degrees / 6)
        return (0...steps).map { i -> String in
            let a = (Double(i) * 6 - 90) * .pi / 180
            let x = 50 + 50 * cos(a)
            let y = 50 + 50 * sin(a)
            return (i == 0 ? "M " : "L ") + String(format: "%.1f %.1f", x, y)
        }.joined(separator: " ")
    }

    static func comment(
        _ key: String, _ x: Int64, _ y: Int64, _ author: String, _ ago: TimeInterval, _ text: String,
        replies: [(String, TimeInterval, String)]
    ) -> Comment {
        Comment(
            id: uuidLike("comment:\(key)"), x: x, y: y, content: text, author: DesignDemo.person(author),
            createdAt: DesignDemo.ms(ago: ago),
            replies: replies.enumerated().map { i, r in
                CommentReply(
                    id: uuidLike("reply:\(key):\(i)"), content: r.2, author: DesignDemo.person(r.0), createdAt: DesignDemo.ms(ago: r.1))
            })
    }

    static func uuidLike(_ seed: String) -> String {
        let h = Array(DemoIds.hex(seed))
        return "\(String(h[0..<8]))-\(String(h[8..<12]))-4\(String(h[13..<16]))-9\(String(h[17..<20]))-\(String(h[20..<32]))"
    }
}

/// The other boards: a title, three rough frames and the team's notes.
enum Sketch {
    static func board(_ seed: DesignDemo.BoardSeed) -> DesignDemo.Board {
        let p = DesignDemo.person
        var b = BoardBuilder(seed: "board:\(seed.name)", author: p("Jonas Weber"), createdAt: DesignDemo.ms(ago: 9 * 86_400))
        b.rect(-40, -40, 1300, 880, fill: "#f5f5f2", radius: 32)
        b.text(seed.name, 0, 0, 800, 44, size: 36, bold: true)
        b.text(seed.description, 0, 54, 800, 22, size: 18, color: BoardBuilder.gray)
        for i in 0..<3 {
            let x = i * 300
            b.rect(x, 120, 260, 420, fill: "#ffffff", stroke: BoardBuilder.hairline, width: 1, radius: 20, label: "screen/Step \(i + 1)", shadow: true)
            b.rect(x + 20, 144, 220, 120, fill: "#eef0ff", radius: 12)
            b.rect(x + 20, 286, 180, 16, fill: "#d4d4d8", radius: 8)
            b.rect(x + 20, 314, 140, 12, fill: "#e4e4e7", radius: 6)
            b.rect(x + 20, 336, 200, 12, fill: "#e4e4e7", radius: 6)
            b.rect(x + 20, 476, 220, 44, fill: BoardBuilder.accent, radius: 12)
            if i < 2 { b.arrow(x + 266, 330, dx: 28, dy: 0) }
        }
        let colors = ["#fef08a", "#fbcfe8", "#bbf7d0", "#bfdbfe"]
        for (i, note) in seed.notes.enumerated() {
            b.sticky(note, 920 + (i % 2) * 160, 120 + (i / 2) * 230, 150, 200, color: colors[i % 4], rotation: Int32(i % 2 == 0 ? -2 : 2))
        }
        let comment = Onboarding.comment(
            seed.name, 130, 200, "Lea Novak", 26 * 3_600, "Looks good. Can we review this on Thursday?", replies: [])
        return DesignDemo.Board(
            name: seed.name, description: seed.description, elements: b.elements, comments: [comment],
            members: DesignDemo.members(), viewers: [])
    }
}
#endif
