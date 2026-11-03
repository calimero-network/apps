import Foundation
import MeroKit

/// The player's settings: the name others see in the world and the game's zoom. Kept under the web
/// app's keys (`mt-name`, `mt-zoom`).
public protocol PlayerSettings: AnyObject {
    var name: String { get set }
    var zoom: Double { get set }
}

public final class DefaultsPlayerSettings: PlayerSettings {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var name: String {
        get {
            let stored = defaults.string(forKey: "mt-name")?.trimmingCharacters(in: .whitespaces) ?? ""
            return stored.isEmpty ? MerrariaConstants.defaultPlayerName : stored
        }
        set { defaults.set(String(newValue.trimmingCharacters(in: .whitespaces).prefix(MerrariaConstants.maxPlayerName)), forKey: "mt-name") }
    }

    public var zoom: Double {
        get {
            let stored = defaults.double(forKey: "mt-zoom")
            return MerrariaConstants.zoomRange.contains(stored) ? stored : MerrariaConstants.defaultZoom
        }
        set { defaults.set(min(max(newValue, MerrariaConstants.zoomRange.lowerBound), MerrariaConstants.zoomRange.upperBound), forKey: "mt-zoom") }
    }
}

public final class MemoryPlayerSettings: PlayerSettings {
    public var name: String
    public var zoom: Double
    public init(name: String = MerrariaConstants.defaultPlayerName, zoom: Double = MerrariaConstants.defaultZoom) {
        self.name = name
        self.zoom = zoom
    }
}

/// One world being played: the bridge to the bundled game, the touch controls, the native HUD
/// (hotbar, status) and the node's live events.
///
/// The page is told things through ``send`` (the web view sets it to evaluate the message's
/// script); what the page posts arrives at ``receive(_:)``.
@MainActor
public final class GameModel: ObservableObject {
    public enum Phase: Equatable, Sendable {
        /// The page is loading the world.
        case loading
        case playing
        case failed(String)
        /// Saved and left: the screen closes.
        case left
    }

    @Published public private(set) var phase: Phase = .loading
    /// The world is joined and read; until then edits queue in the game.
    @Published public private(set) var connected = false
    @Published public private(set) var slots: [HudSlot] = []
    @Published public private(set) var selected = 0
    @Published public private(set) var paused = false
    @Published public private(set) var zoom: Double

    public let ref: WorldRef
    public var send: ((AppMessage) -> Void)?

    private let backend: any MeroAppBackend
    private let dispatcher: BridgeDispatcher
    private let settings: PlayerSettings
    private var controls = TouchControls()
    private var eventsTask: Task<Void, Never>?
    private var leaving: CheckedContinuation<Void, Never>?

    public init(backend: any MeroAppBackend, ref: WorldRef, settings: PlayerSettings) {
        self.backend = backend
        self.ref = ref
        self.settings = settings
        self.zoom = settings.zoom
        self.dispatcher = BridgeDispatcher(client: MerrariaClient.bound(backend, contextId: ref.contextId))
    }

    public var config: GameConfig { GameConfig(contextId: ref.contextId, name: settings.name, zoom: zoom) }

    /// Before the page loads: join the world's context if this account is not in it yet
    /// (best-effort; the game says so if it cannot read the world), then listen for events.
    public func start() async {
        if (try? await backend.isMember(contextId: ref.contextId)) == false {
            try? await backend.joinContext(contextId: ref.contextId)
        }
        startEvents()
    }

    public func stop() {
        eventsTask?.cancel()
        eventsTask = nil
    }

    // MARK: Page -> app

    public func receive(_ text: String) {
        guard let message = PageMessage.decode(text) else { return }
        switch message {
        case .request(let id, .config, _, _):
            send?(.response(id: id, result: .success(config.json)))
        case .request(let id, let op, let method, let argsJSON):
            let dispatcher = dispatcher
            Task {
                let result: Result<String, BridgeFailure>
                do {
                    result = .success(try await dispatcher.run(op: op, method: method, argsJSON: argsJSON))
                } catch let failure as BridgeFailure {
                    result = .failure(failure)
                } catch {
                    result = .failure(BridgeFailure(MerrariaText.error(error)))
                }
                send?(.response(id: id, result: result))
            }
        case .hud(let selected, let slots):
            self.selected = selected
            self.slots = slots
            if phase == .loading { phase = .playing }
        case .connected:
            connected = true
            if phase == .loading { phase = .playing }
        case .fatal(let message):
            phase = .failed(message)
        case .left:
            leaving?.resume()
            leaving = nil
        }
    }

    // MARK: Controls -> page

    public func press(_ button: GameButton) {
        guard !paused, let input = controls.press(button) else { return }
        send?(.input(input))
    }

    public func release(_ button: GameButton) {
        guard let input = controls.release(button) else { return }
        send?(.input(input))
    }

    public func tap(x: Double, y: Double, unitsPerCSSPixel: Double = 1) {
        guard !paused else { return }
        send?(TouchControls.tapTarget(x: x, y: y, unitsPerCSSPixel: unitsPerCSSPixel))
    }

    public func select(_ slot: Int) {
        guard let message = TouchControls.select(slot, slotCount: slots.count) else { return }
        if case .select(let index) = message { selected = index }
        send?(message)
    }

    public func setZoom(_ value: Double) {
        let clamped = min(max(value, MerrariaConstants.zoomRange.lowerBound), MerrariaConstants.zoomRange.upperBound)
        zoom = clamped
        settings.zoom = clamped
        send?(.zoom(clamped))
    }

    /// The pause menu opened, or the app left the foreground: everything lifts and the game saves.
    public func pause() {
        if let input = controls.releaseAll() { send?(.input(input)) }
        if !paused { send?(.pause) }
        paused = true
    }

    public func resume() { paused = false }

    /// The page is being loaded again (after a failure): back to loading, nothing held.
    public func retry() {
        controls = TouchControls()
        connected = false
        paused = false
        phase = .loading
    }

    /// Save, leave the world (the contract's `leave`, so others see you go), and close. Waits for
    /// the page at most `timeout`: a page that cannot answer must not trap the player.
    public func leave(timeout: Duration = .seconds(3)) async {
        stop()
        if let input = controls.releaseAll() { send?(.input(input)) }
        if send != nil, phase != .left {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                leaving = continuation
                send?(.leave)
                Task { [weak self] in
                    try? await Task.sleep(for: timeout)
                    self?.leaving?.resume()
                    self?.leaving = nil
                }
            }
        }
        phase = .left
    }

    // MARK: Node events

    /// Each node event is a nudge for the game to re-read the tiles. A stream that drops is opened
    /// again after a pause, and the game re-reads everything ("reconnected"); polling covers the gap.
    private func startEvents() {
        guard eventsTask == nil, backend.canSubscribe else { return }
        let backend = backend
        let contextId = ref.contextId
        eventsTask = Task { [weak self] in
            var reconnect = false
            while !Task.isCancelled {
                if reconnect { self?.send?(.event(kind: "reconnected")) }
                do {
                    for try await event in backend.events(contextId: contextId) {
                        if Task.isCancelled { return }
                        self?.send?(.event(kind: event.kind))
                    }
                } catch {}
                reconnect = true
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }
}
