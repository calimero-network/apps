import KombatCore
import SwiftUI
import UIKit

/// The fight pad's state: what each thumb holds, merged and sent to the page the moment it changes.
/// Touch handling is UIKit (`touchesBegan`/`Moved`/`Ended` on two multi-touch views), so a press
/// reaches the page on the same run-loop turn it happened: no gesture recogniser delay, no
/// round trip anywhere. The game then runs it locally; only the finished action goes out.
@MainActor
final class FightPad: ObservableObject {
    @Published private(set) var held: Set<PadButton> = []
    private var directions: Set<PadButton> = []
    private var actions: Set<PadButton> = []
    private var tracker = PadTracker()
    var send: ((BridgeOutbound) -> Void)?

    func setDirections(_ next: Set<PadButton>) {
        directions = next
        flush()
    }

    func setActions(_ next: Set<PadButton>) {
        let fresh = !next.subtracting(actions).isEmpty
        actions = next
        if fresh { Haptics.pad() }
        flush()
    }

    /// Let go of everything: the app went to the background, a sheet opened, the screen closed.
    func releaseAll() {
        directions = []
        actions = []
        flush()
    }

    private func flush() {
        let next = directions.union(actions)
        for message in tracker.update(next) { send?(message) }
        if held != next { held = next }
    }
}

/// Left thumb: the directional pad.
struct DPadView: View {
    @ObservedObject var pad: FightPad
    var size: CGFloat = 156

    var body: some View {
        ZStack {
            Circle().fill(Theme.padFill)
            Circle().strokeBorder(Theme.padLine, lineWidth: 1)
            arrow(.up, "chevron.up", x: 0, y: -1)
            arrow(.down, "chevron.down", x: 0, y: 1)
            arrow(.left, "chevron.left", x: -1, y: 0)
            arrow(.right, "chevron.right", x: 1, y: 0)
            Circle().fill(Theme.padLine).frame(width: size * 0.2, height: size * 0.2)
            TouchSurface(kind: .dpad, onChange: pad.setDirections)
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel("Directional pad")
    }

    private func arrow(_ button: PadButton, _ symbol: String, x: CGFloat, y: CGFloat) -> some View {
        let on = pad.held.contains(button)
        return ZStack {
            Circle().fill(on ? Theme.padPressed : Color.clear).frame(width: size * 0.34, height: size * 0.34)
            Image(systemName: symbol)
                .font(.system(size: size * 0.14, weight: .bold))
                .foregroundStyle(on ? Theme.ink : Theme.onStage)
        }
        .offset(x: x * size * 0.31, y: y * size * 0.31)
    }
}

/// Right thumb: the four actions, Block and Special over Punch and Kick.
struct ActionPadView: View {
    @ObservedObject var pad: FightPad
    var size: CGFloat = 156

    var body: some View {
        ZStack {
            VStack(spacing: size * 0.06) {
                ForEach(PadAction.rows, id: \.first!.id) { row in
                    HStack(spacing: size * 0.06) {
                        ForEach(row) { action in cap(action) }
                    }
                }
            }
            TouchSurface(kind: .actions, onChange: pad.setActions)
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel("Punch, kick, block and special")
    }

    private func cap(_ action: PadAction) -> some View {
        let on = pad.held.contains(action.button)
        let diameter = size * 0.47
        return ZStack {
            Circle().fill(on ? Theme.padPressed : Theme.padFill)
            Circle().strokeBorder(on ? Theme.lime : Theme.padLine, lineWidth: 1)
            VStack(spacing: 2) {
                Image(systemName: PadSymbols.symbol(action.button))
                    .font(.system(size: diameter * 0.3, weight: .semibold))
                Text(action.label.uppercased())
                    .font(.system(size: diameter * 0.15, weight: .bold))
                    .tracking(0.4)
            }
            .foregroundStyle(on ? Theme.ink : Theme.onStage)
        }
        .frame(width: diameter, height: diameter)
        .scaleEffect(on ? 0.94 : 1)
    }
}

/// SF Symbols for the actions. Android's `PadIcons` maps the same four to Material Symbols.
enum PadSymbols {
    static func symbol(_ button: PadButton) -> String {
        switch button {
        case .punch: return "figure.boxing"
        case .kick: return "figure.kickboxing"
        case .block: return "shield.fill"
        case .special: return "bolt.fill"
        case .up: return "chevron.up"
        case .down: return "chevron.down"
        case .left: return "chevron.left"
        case .right: return "chevron.right"
        }
    }
}

/// A transparent multi-touch surface over a pad half.
private struct TouchSurface: UIViewRepresentable {
    enum Kind { case dpad, actions }
    let kind: Kind
    let onChange: (Set<PadButton>) -> Void

    func makeUIView(context: Context) -> PadTouchView {
        let view = PadTouchView()
        view.kind = kind
        view.onChange = onChange
        return view
    }

    func updateUIView(_ view: PadTouchView, context: Context) {
        view.onChange = onChange
    }

    final class PadTouchView: UIView {
        var kind: Kind = .dpad
        var onChange: ((Set<PadButton>) -> Void)?
        private var touches: [ObjectIdentifier: CGPoint] = [:]

        override init(frame: CGRect) {
            super.init(frame: frame)
            isMultipleTouchEnabled = true
            backgroundColor = .clear
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func touchesBegan(_ set: Set<UITouch>, with event: UIEvent?) { track(set) }
        override func touchesMoved(_ set: Set<UITouch>, with event: UIEvent?) { track(set) }
        override func touchesEnded(_ set: Set<UITouch>, with event: UIEvent?) { lift(set) }
        override func touchesCancelled(_ set: Set<UITouch>, with event: UIEvent?) { lift(set) }

        private func track(_ set: Set<UITouch>) {
            for touch in set { touches[ObjectIdentifier(touch)] = touch.location(in: self) }
            report()
        }

        private func lift(_ set: Set<UITouch>) {
            for touch in set { touches[ObjectIdentifier(touch)] = nil }
            report()
        }

        private func report() {
            var held: Set<PadButton> = []
            let size = bounds.size
            for point in touches.values {
                switch kind {
                case .dpad:
                    held.formUnion(
                        DPad.directions(
                            dx: point.x - size.width / 2, dy: point.y - size.height / 2,
                            radius: min(size.width, size.height) / 2))
                case .actions:
                    // The 2×2 grid of PadAction.rows: a thumb sliding across caps changes action.
                    let row = point.y < size.height / 2 ? 0 : 1
                    let column = point.x < size.width / 2 ? 0 : 1
                    held.insert(PadAction.rows[row][column].button)
                }
            }
            onChange?(held)
        }
    }
}
