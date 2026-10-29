import Foundation

/// The on-screen buttons. Same set and names as the Android app's `GameButton`.
public enum GameButton: String, CaseIterable, Sendable {
    case left
    case right
    case jump
    case mine
    case place
}

/// The touch layer: which buttons are held, turned into what the game reads. The web game is
/// keyboard and mouse; this is its D-pad (left/right; the game has no use for down), jump, mine
/// (the left mouse button, held) and place (the right one, held).
///
/// Every change produces one ``GameInput`` to send; nothing is sent while nothing changes.
public struct TouchControls: Equatable, Sendable {
    public private(set) var held: Set<GameButton> = []

    public init() {}

    /// What the game reads now (no jump edge: that only rides on the press that made it).
    public var input: GameInput { input(jumpPressed: false) }

    /// A finger went down on `button`. Nil when it was already held (a second finger).
    public mutating func press(_ button: GameButton) -> GameInput? {
        guard held.insert(button).inserted else { return nil }
        return input(jumpPressed: button == .jump)
    }

    /// The finger on `button` lifted. Nil when it was not held.
    public mutating func release(_ button: GameButton) -> GameInput? {
        guard held.remove(button) != nil else { return nil }
        return input(jumpPressed: false)
    }

    /// Everything lifts (the app went to the background, the pause menu opened). Nil when nothing
    /// was held.
    public mutating func releaseAll() -> GameInput? {
        guard !held.isEmpty else { return nil }
        held.removeAll()
        return GameInput.idle
    }

    private func input(jumpPressed: Bool) -> GameInput {
        let move = (held.contains(.right) ? 1 : 0) - (held.contains(.left) ? 1 : 0)
        let mine = held.contains(.mine)
        return GameInput(
            move: move, jump: held.contains(.jump), jumpPressed: jumpPressed, mine: mine,
            // Both held: mining wins, as the web game checks the left button first.
            place: held.contains(.place) && !mine)
    }

    /// A tap on the game view, at `(x, y)` in the view's own units, as the page's CSS pixels:
    /// `unitsPerCSSPixel` is 1 on iOS (points) and the display density on Android (pixels).
    public static func tapTarget(x: Double, y: Double, unitsPerCSSPixel: Double = 1) -> AppMessage {
        let scale = unitsPerCSSPixel > 0 ? unitsPerCSSPixel : 1
        return .target(x: (x / scale).rounded(), y: (y / scale).rounded())
    }

    /// The hotbar slot to select, kept inside the hotbar. Nil for an empty hotbar.
    public static func select(_ slot: Int, slotCount: Int) -> AppMessage? {
        guard slotCount > 0 else { return nil }
        return .select(slot: min(max(slot, 0), slotCount - 1))
    }
}
