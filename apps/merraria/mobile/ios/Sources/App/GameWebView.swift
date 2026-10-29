import MerrariaCore
import SwiftUI
import WebKit

/// The bundled web game in a WKWebView, served from the app bundle under its own scheme and wired
/// to ``GameModel``: what the page posts to `webkit.messageHandlers.meroBridge` goes to
/// `model.receive`, and `model.send` evaluates each message's script in the page.
///
/// The view takes no touches itself: the controls and the tap layer above it are native, and the
/// page is driven only through the bridge.
struct GameWebView: UIViewRepresentable {
    let model: GameModel

    static let scheme = "merraria-game"

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(context.coordinator.assets, forURLScheme: Self.scheme)
        configuration.userContentController.add(context.coordinator.messages, name: "meroBridge")
        configuration.allowsInlineMediaPlayback = true
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x0B / 255, green: 0x14 / 255, blue: 0x0E / 255, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isUserInteractionEnabled = false
        #if DEBUG
            if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        model.send = { [weak webView] message in
            webView?.evaluateJavaScript(message.script, completionHandler: nil)
        }
        if let url = URL(string: "\(Self.scheme)://app/\(GameAssets.entry)") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.model.send = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "meroBridge")
        webView.stopLoading()
    }

    @MainActor
    final class Coordinator {
        let model: GameModel
        let assets = GameAssetHandler()
        let messages: BridgeMessageHandler

        init(model: GameModel) {
            self.model = model
            self.messages = BridgeMessageHandler(model: model)
        }
    }
}

/// The page's messages to the model. Holds the model weakly: WKUserContentController keeps its
/// handlers alive.
@MainActor
final class BridgeMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var model: GameModel?

    init(model: GameModel) { self.model = model }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let text = message.body as? String else { return }
        model?.receive(text)
    }
}

/// Serves `merraria-game://app/<path>` from the bundled `www/` folder.
final class GameAssetHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL?.appendingPathComponent(GameAssets.folder)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        guard let root, let file = GameAssets.resolve(path: url.path, in: root), let data = try? Data(contentsOf: file)
        else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])
            if let response { task.didReceive(response) }
            task.didReceive(Data())
            task.didFinish()
            return
        }
        let headers = [
            "Content-Type": GameAssets.mimeType(for: file),
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        if let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) {
            task.didReceive(response)
        }
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
