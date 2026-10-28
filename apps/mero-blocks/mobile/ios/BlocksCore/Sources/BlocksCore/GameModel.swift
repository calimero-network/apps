import Foundation
import MeroKit

/// One open world: gets the account into its context, then serves the game page — answers its
/// contract calls through ``BridgeRouter``, forwards the relay's events for the world, and tells it
/// to pause and resume. The view owns the WebView and hands this model the page's messages
/// (``receive(_:)``) and a way to deliver messages back (``outbox``).
@MainActor
public final class GameModel: ObservableObject {
    public enum Phase: Equatable, Sendable {
        /// Making sure the account is a member of the world's context.
        case joining
        /// The page is reading the world.
        case loading
        case playing
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .joining

    public let world: WorldRef
    public let start: GameStart

    /// Delivers one message (JSON text) to the page; the view wraps it with ``BridgeCodec/script(_:)``.
    public var outbox: ((String) -> Void)?
    public var onMenu: (() -> Void)?
    public var onHaptic: ((String) -> Void)?

    public private(set) var pageReady = false
    public private(set) var paused = false

    private let backend: any MeroAppBackend
    private let router: BridgeRouter
    private var insets = GameInsets.zero
    private var events: Task<Void, Never>?

    public init(backend: any MeroAppBackend, world: WorldRef, myId: String, playerName: String, sensitivity: Double) {
        self.backend = backend
        self.world = world
        router = BridgeRouter(client: BlocksClient(transport: backend.contract.bound(to: world.contextId)))
        start = GameStart(
            contextId: world.contextId, myId: myId, name: BlocksText.playerName(playerName), worldName: world.name,
            sensitivity: min(max(sensitivity, BlocksConstants.sensitivityRange.lowerBound), BlocksConstants.sensitivityRange.upperBound))
    }

    /// Join the world's context when the account is not in it yet (a world it was just invited to:
    /// the namespace admits, the context is joined through the open subgroup).
    public func prepare() async {
        phase = .joining
        do {
            if !(try await backend.isMember(contextId: world.contextId)) {
                try await backend.joinContext(contextId: world.contextId)
            }
            phase = .loading
        } catch {
            phase = .failed(BlocksText.error(error))
        }
    }

    /// One message from the page.
    public func receive(_ text: String) async {
        guard let request = try? BridgeCodec.decode(text) else { return }
        switch request {
        case .ready:
            pageReady = true
            deliver(BridgeCodec.start(start, insets: insets))
            startEvents()
        case .loaded:
            phase = .playing
        case .menu:
            onMenu?()
        case .haptic(let style):
            onHaptic?(style)
        case .fatal(let message):
            phase = .failed(message)
        case .call(let id, let op, let method, let argsJSON):
            do {
                let json = try await router.handle(op: op, method: method, argsJSON: argsJSON)
                deliver(BridgeCodec.result(id: id, json: json))
            } catch {
                deliver(BridgeCodec.failure(id: id, message: BlocksText.error(error)))
            }
        }
    }

    public func setInsets(_ insets: GameInsets) {
        guard insets != self.insets else { return }
        self.insets = insets
        if pageReady { deliver(BridgeCodec.insets(insets)) }
    }

    public func setSensitivity(_ value: Double) {
        if pageReady { deliver(BridgeCodec.settings(sensitivity: value)) }
    }

    /// The app went to the background, or a menu covers the game.
    public func pause() {
        guard !paused else { return }
        paused = true
        if pageReady { deliver(BridgeCodec.pause) }
    }

    public func resume() {
        guard paused else { return }
        paused = false
        if pageReady { deliver(BridgeCodec.resume) }
    }

    /// Leaving the world: stop listening and mark the player as gone (best effort: the contract
    /// ages out a silent player after 10 s anyway).
    public func leave() async {
        stop()
        _ = try? await router.handle(op: .execute, method: "leave", argsJSON: Data("{\"now\":\(nowSeconds())}".utf8))
    }

    /// A link that admits someone to this world.
    public func inviteLink() async throws -> String {
        let signed = try await backend.createInvitation(namespaceId: world.namespaceId)
        return try BlocksInvitation(
            invitation: signed, name: world.name, contextId: world.contextId, groupId: world.groupId
        ).link()
    }

    /// Back to ``Phase/joining`` for another try after a failure.
    public func retry() async {
        stop()
        pageReady = false
        paused = false
        await prepare()
    }

    public func stop() {
        events?.cancel()
        events = nil
    }

    /// Every relay event for the world is a nudge to re-read it; the page also polls, which covers
    /// a relay that cannot stream.
    private func startEvents() {
        guard events == nil, backend.canSubscribe else { return }
        let stream = backend.events(contextId: world.contextId)
        events = Task { [weak self] in
            do {
                for try await event in stream {
                    guard let self, !Task.isCancelled else { return }
                    if !self.paused { self.deliver(BridgeCodec.event(kind: event.kind)) }
                }
            } catch {}
        }
    }

    private func deliver(_ message: String) {
        outbox?(message)
    }
}
