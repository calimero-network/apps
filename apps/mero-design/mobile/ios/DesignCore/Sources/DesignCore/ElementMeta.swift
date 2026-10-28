import Foundation

/// The extras the web app carries inside an element's `label`
/// (`app/src/utils/elementMeta.ts`): `<visible label>\u{1F}<key>=<value>&…`,
/// values URL-encoded. Only the ones that change how a board is drawn are read.
public struct ElementMeta: Equatable, Sendable {
    /// `dashed`, `dotted`, `dashdot`, `dotted3`, `long`; `nil` is solid.
    public var strokeStyle: String?
    /// `box` or `sticky`: a text element drawn as a container with words in it.
    public var box: String?
    /// The words' colour in a box or sticky.
    public var textColor: String?
    /// `triangle`, `diamond`, `star` or `cloud`: a path regenerated at its size.
    public var shape: String?
    public var hidden = false

    public init(strokeStyle: String? = nil, box: String? = nil, textColor: String? = nil, shape: String? = nil, hidden: Bool = false) {
        self.strokeStyle = strokeStyle
        self.box = box
        self.textColor = textColor
        self.shape = shape
        self.hidden = hidden
    }

    static let separator: Character = "\u{1F}"
    static let strokeStyles: Set<String> = ["dashed", "dotted", "dashdot", "dotted3", "long"]
    static let boxes: Set<String> = ["box", "sticky"]
    static let shapes: Set<String> = ["triangle", "diamond", "star", "cloud"]

    /// A stored label split into the label people see and its extras (`unpackLabel`).
    public static func unpack(_ raw: String?) -> (label: String?, meta: ElementMeta) {
        guard let raw else { return (nil, ElementMeta()) }
        guard let at = raw.firstIndex(of: separator) else { return (raw, ElementMeta()) }
        let visible = String(raw[..<at])
        var params: [String: String] = [:]
        for pair in raw[raw.index(after: at)...].split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let key = kv.first else { continue }
            let value = kv.count > 1 ? String(kv[1]) : ""
            let decoded = value.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? value
            if params[String(key)] == nil { params[String(key)] = decoded }
        }
        var meta = ElementMeta()
        if let s = params["s"], strokeStyles.contains(s) { meta.strokeStyle = s }
        if let b = params["b"], boxes.contains(b) { meta.box = b }
        if let c = params["c"], !c.isEmpty { meta.textColor = c }
        if let h = params["h"], shapes.contains(h) { meta.shape = h }
        meta.hidden = params["i"] == "1"
        return (visible.isEmpty ? nil : visible, meta)
    }
}

extension Element {
    /// The label people see, without the extras.
    public var visibleLabel: String? { ElementMeta.unpack(label).label }
    public var meta: ElementMeta { ElementMeta.unpack(label).meta }
}

/// `splitPath` in groups.ts: a label's `/`-separated segments, trimmed, empties dropped.
public func splitLabelPath(_ label: String?) -> [String] {
    (label ?? "").split(separator: "/", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
}
