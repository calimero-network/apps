import KombatCore
import SwiftUI
import WebKit

/// The game page (Resources/Game, built from the web app's engine by scripts/build-web.sh) in a
/// WKWebView, loaded from the app bundle: nothing is fetched at runtime.
///
/// The bridge is two calls: the page posts JSON strings to the `meroBridge` message handler
/// (``BridgeInbound``), and the host's messages run as `window.meroGame.receive(…)`
/// (``BridgeOutbound/script``). Contract calls never leave the app through the page: they come
/// here and go out through the generated client.
struct GameWebView: UIViewRepresentable {
    let host: GameHost

    func makeCoordinator() -> Coordinator { Coordinator(host: host) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakHandler(context.coordinator), name: "meroBridge")
        // The engine's sound is synthesised WebAudio; the pad is native, so there is no web gesture
        // to unlock it with.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsInlineMediaPlayback = true
        configuration.suppressesIncrementalRendering = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x0B / 255, green: 0x0B / 255, blue: 0x0C / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = context.coordinator
        webView.allowsLinkPreview = false
        // Touches belong to the native pad above the page.
        webView.isUserInteractionEnabled = false
        #if DEBUG
            if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        context.coordinator.attach(webView)
        if let page = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Game") {
            webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "meroBridge")
        coordinator.detach()
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let host: GameHost

        init(host: GameHost) { self.host = host }

        func attach(_ webView: WKWebView) {
            host.deliver = { [weak webView] message in
                webView?.evaluateJavaScript(message.script, completionHandler: nil)
            }
        }

        func detach() { host.deliver = nil }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? String, let inbound = BridgeInbound.decode(body) else { return }
            let host = host
            Task { @MainActor in await host.receive(inbound) }
        }

        /// The page is a local file and stays one: no navigation anywhere else.
        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(action.request.url?.isFileURL == true ? .allow : .cancel)
        }
    }
}

/// WKUserContentController holds its handlers strongly; this keeps it from holding the coordinator.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
