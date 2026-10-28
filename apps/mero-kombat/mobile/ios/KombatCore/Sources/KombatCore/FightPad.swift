import Foundation

/// One input of the web engine (`app/src/game/input.ts`, `Button`). The raw value is what the
/// page's `Controls.press` takes. (Kotlin `PadButton`.)
public enum PadButton: String, CaseIterable, Sendable, Hashable {
    case left, right, up, down, punch, kick, block, special

    /// The order presses are sent in when several change at once: directions first, so a crouch
    /// that arrives with a punch makes an uppercut.
    var order: Int { Self.allCases.firstIndex(of: self) ?? 0 }
}

/// The right-hand cluster: the four actions the game defines, laid out the same on both
/// platforms (top row Block, Special; bottom row Punch, Kick, under the thumb). (Kotlin `FightPad.ACTIONS`.)
public struct PadAction: Identifiable, Sendable, Hashable {
    public let button: PadButton
    public let label: String
    /// The web app's key for it (`LEGEND`), shown small on the cap.
    public let key: String
    public var id: String { button.rawValue }

    public static let rows: [[PadAction]] = [
        [PadAction(button: .block, label: "Block", key: "L"), PadAction(button: .special, label: "Special", key: "I")],
        [PadAction(button: .punch, label: "Punch", key: "J"), PadAction(button: .kick, label: "Kick", key: "K")],
    ]
}

/// The left-hand directional pad: a thumb's position becomes the held directions. 8-way, with a
/// dead zone in the middle, so resting a thumb on the pad does nothing and a diagonal is a
/// crouch (or jump) plus a step. (Kotlin `DPad`.)
public enum DPad {
    /// Inside this fraction of the radius, nothing is held.
    public static let deadZone = 0.22
    /// A direction is held when the thumb is within 67.5° of it: sin(22.5°).
    static let axis = 0.3827

    /// The directions held by a thumb `dx`, `dy` points from the pad's centre (y grows down).
    public static func directions(dx: Double, dy: Double, radius: Double) -> Set<PadButton> {
        let distance = (dx * dx + dy * dy).squareRoot()
        guard radius > 0, distance > radius * deadZone else { return [] }
        var held: Set<PadButton> = []
        if abs(dx) > distance * axis { held.insert(dx < 0 ? .left : .right) }
        if abs(dy) > distance * axis { held.insert(dy < 0 ? .up : .down) }
        return held
    }
}

/// What is held across the whole pad, turned into the press messages the page needs: one
/// `down` per newly held button and one `up` per released one, never a repeat. Every change is
/// sent the moment it happens; nothing is batched or delayed. (Kotlin `PadTracker`.)
public struct PadTracker: Sendable {
    public private(set) var held: Set<PadButton> = []

    public init() {}

    /// Move to `next`; releases first, then presses, each in ``PadButton`` order.
    public mutating func update(_ next: Set<PadButton>) -> [BridgeOutbound] {
        let released = held.subtracting(next).sorted { $0.order < $1.order }
        let pressed = next.subtracting(held).sorted { $0.order < $1.order }
        held = next
        return released.map { .press($0, down: false) } + pressed.map { .press($0, down: true) }
    }

    /// Let go of everything (the app went to the background, the screen closed).
    public mutating func releaseAll() -> [BridgeOutbound] { update([]) }
}
