import BlocksCore
import MeroKit
import SwiftUI
import UIKit
import WebKit

/// The game, full screen and landscape: the web app's three.js engine in a WKWebView, loaded from
/// the `game` folder bundled into the app, with its contract calls answered by ``GameModel``
/// through the signed-in session. The menu is native.
struct GameScreen: View {
    let settings: PlayerSettings
    let onExit: () -> Void
    @StateObject private var model: GameModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var menuOpen = false
    @State private var share: SharedLink?
    @State private var menuError: String?
    @State private var attempt = 0

    init(backend: any MeroAppBackend, world: WorldRef, myId: String, settings: PlayerSettings, onExit: @escaping () -> Void) {
        self.settings = settings
        self.onExit = onExit
        _model = StateObject(
            wrappedValue: GameModel(
                backend: backend, world: world, myId: myId, playerName: settings.playerName,
                sensitivity: settings.sensitivity))
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(hex: 0x87C4EB).ignoresSafeArea()
                switch model.phase {
                case .joining:
                    GameStatus(title: "Joining \(model.world.name)…")
                case .failed(let message):
                    GameFailure(
                        message: message, onRetry: {
                            attempt += 1
                            Task { await model.retry() }
                        }, onBack: onExit)
                case .loading, .playing:
                    GameWebView(model: model)
                        .id(attempt)
                        .ignoresSafeArea()
                        .onAppear { model.setInsets(GameInsets(proxy.safeAreaInsets)) }
                        .onChange(of: proxy.safeAreaInsets) { model.setInsets(GameInsets($0)) }
                }
                if menuOpen {
                    PauseMenu(
                        world: model.world, settings: settings, error: $menuError,
                        onResume: closeMenu,
                        onInvite: invite,
                        onLeave: leave)
                    .transition(.opacity)
                }
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .task { await model.prepare() }
        .onAppear {
            AppDelegate.lock(.landscape)
            UIApplication.shared.isIdleTimerDisabled = true
            model.onMenu = {
                Haptics.tap()
                model.pause()
                withAnimation(.easeOut(duration: 0.15)) { menuOpen = true }
            }
            model.onHaptic = { style in style == "selection" ? Haptics.selection() : Haptics.tap() }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            AppDelegate.lock(.portrait)
            model.stop()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                if !menuOpen { model.resume() }
            } else {
                model.pause()
            }
        }
        .onChange(of: settings.sensitivity) { model.setSensitivity($0) }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
    }

    private func closeMenu() {
        withAnimation(.easeOut(duration: 0.15)) { menuOpen = false }
        model.resume()
    }

    private func invite() {
        Haptics.tap()
        menuError = nil
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink())
            } catch {
                menuError = BlocksText.error(error)
            }
        }
    }

    private func leave() {
        Haptics.tap()
        Task { await model.leave() }
        onExit()
    }
}

extension GameInsets {
    init(_ insets: EdgeInsets) {
        self.init(top: insets.top, left: insets.leading, bottom: insets.bottom, right: insets.trailing)
    }
}

/// The native pause menu over the paused game.
private struct PauseMenu: View {
    let world: WorldRef
    @ObservedObject var settings: PlayerSettings
    @Binding var error: String?
    let onResume: () -> Void
    let onInvite: () -> Void
    let onLeave: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.45).ignoresSafeArea().onTapGesture(perform: onResume)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        AppMark(size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(world.name).font(Theme.heading(20)).foregroundStyle(Theme.ink).lineLimit(1)
                            Text("Paused").font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                    }
                    Button(action: onResume) { Label("Resume", systemImage: "play.fill") }
                        .buttonStyle(PrimaryButtonStyle())
                    Button(action: onInvite) { Label("Invite friends", systemImage: "person.badge.plus") }
                        .buttonStyle(SecondaryButtonStyle())
                    SensitivitySlider(value: $settings.sensitivity)
                        .font(Theme.body(14, .medium))
                        .padding(.vertical, 4)
                    if let error { ErrorBanner(message: error) { self.error = nil } }
                    Button(action: onLeave) {
                        Label("Save & leave world", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    DisclosureGroup("Details") {
                        VStack(spacing: 10) {
                            DetailRow(label: "World (context)", value: world.contextId)
                            DetailRow(label: "Namespace", value: world.namespaceId)
                        }
                        .padding(.top, 6)
                    }
                    .font(Theme.body(14, .semibold))
                    .tint(Theme.ink)
                }
                .padding(20)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.surface))
                .frame(maxWidth: 380)
                .padding(.vertical, 16)
                .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct GameStatus: View {
    let title: String

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 14) {
                AppMark(size: 52)
                ProgressView().tint(Theme.ink)
                Text(title).font(Theme.body(15)).foregroundStyle(Theme.ink2)
            }
        }
    }
}

private struct GameFailure: View {
    let message: String
    let onRetry: () -> Void
    let onBack: () -> Void

    var body: some View {
        ZStack {
            Theme.ground.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 30)).foregroundStyle(Theme.danger)
                Text("Couldn't open this world").font(Theme.heading(20)).foregroundStyle(Theme.ink)
                Text(message).font(Theme.body(14)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                    .frame(maxWidth: 460)
                HStack(spacing: 12) {
                    Button("Back to worlds", action: onBack).buttonStyle(SecondaryButtonStyle(fullWidth: false))
                    Button("Try again", action: onRetry).buttonStyle(PrimaryButtonStyle(fullWidth: false))
                }
            }
            .padding(24)
        }
    }
}

/// The WKWebView that runs the game page from the app bundle.
struct GameWebView: UIViewRepresentable {
    let model: GameModel

    /// The bundled page: `game/index.html` and `game/game.js`, copied from `../game/assets/game`.
    static var pageURL: URL? { Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "game") }

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Self.Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "meroBlocks")
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0x87 / 255, green: 0xC4 / 255, blue: 0xEB / 255, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        model.outbox = { [weak webView] message in
            webView?.evaluateJavaScript(BridgeCodec.script(message), completionHandler: nil)
        }
        if let url = Self.pageURL {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Self.Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "meroBlocks")
        coordinator.model.outbox = nil
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        let model: GameModel

        init(model: GameModel) {
            self.model = model
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let text = message.body as? String else { return }
            Task { @MainActor in await model.receive(text) }
        }

        /// Only the bundled page: nothing navigates the game elsewhere.
        func webView(
            _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(action.request.url?.isFileURL == true ? .allow : .cancel)
        }
    }
}
