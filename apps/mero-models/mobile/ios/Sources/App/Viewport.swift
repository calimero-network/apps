import SwiftUI
import UIKit
import WebKit

/// The 3D viewport: `viewer.html`, bundled with the app, in a web view.
///
/// That page is the web studio's own three.js drawing code (lights, grid,
/// shading, materials, the mesh format), built into one local file by
/// `mobile/viewer/build.mjs`; Android ships the same file. Nothing is loaded
/// from the network: the scene and its blobs come from this side.
@MainActor
final class ViewportController: NSObject, ObservableObject, WKScriptMessageHandler {
    enum Shading: String { case solid, rendered }

    let webView: WKWebView
    @Published private(set) var ready = false
    /// Blobs the page is waiting for.
    @Published private(set) var pending = 0
    @Published private(set) var problem: String?
    @Published var shading: Shading = .solid { didSet { run("window.mmViewer.setShading('\(shading.rawValue)')") } }
    @Published var grid = true { didSet { run("window.mmViewer.setGrid(\(grid))") } }

    /// A tap in the viewport picked this object, or nothing.
    var onPick: ((String?) -> Void)?
    /// Reads a blob's bytes for the page.
    var blob: ((String) async -> Data?)?

    private var scene: String?
    private var selected: String?

    override init() {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        config.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        controller.add(WeakHandler(self), name: "mm")
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x24 / 255, green: 0x26 / 255, blue: 0x2B / 255, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if let url = Bundle.main.url(forResource: "viewer", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            problem = "The viewer is missing from this build."
        }
    }

    /// The scene, as `SceneModel.viewerJSON()` gives it.
    func setScene(_ json: String) {
        scene = json
        run("window.mmViewer.setScene(\(json))")
    }

    func select(_ id: String?) {
        selected = id
        run("window.mmViewer.select(\(Self.literal(id)))")
    }

    /// Frame one object, or the whole scene.
    func frame(_ id: String?) {
        run("window.mmViewer.frame(\(Self.literal(id)))")
    }

    private func run(_ js: String) {
        guard ready else { return }
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        receive(type: type, id: body["id"] as? String, pending: body["pending"] as? Int, message: body["message"] as? String)
    }

    private func receive(type: String, id: String?, pending: Int?, message: String?) {
        switch type {
        case "ready":
            ready = true
            if let scene { run("window.mmViewer.setScene(\(scene))") }
            run("window.mmViewer.setShading('\(shading.rawValue)')")
            run("window.mmViewer.setGrid(\(grid))")
            if selected != nil { select(selected) }
        case "blob":
            guard let id, id.allSatisfy(\.isHexDigit) else { return }
            Task {
                let data = await blob?(id)
                run("window.mmViewer.setBlob('\(id)', \(data.map { "'\($0.base64EncodedString())'" } ?? "null"))")
            }
        case "pick":
            selected = id
            onPick?(id)
        case "progress":
            self.pending = pending ?? 0
        case "error":
            problem = message
        default:
            break
        }
    }

    private static func literal(_ id: String?) -> String {
        guard let id, let data = try? JSONEncoder().encode(id), let s = String(data: data, encoding: .utf8) else { return "null" }
        return s
    }
}

/// `WKUserContentController` keeps its handlers strongly; this breaks the cycle.
@MainActor
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

struct ViewportView: UIViewRepresentable {
    let controller: ViewportController

    func makeUIView(context: Context) -> WKWebView { controller.webView }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
