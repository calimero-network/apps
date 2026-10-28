import Foundation
import MeroKit
import MeroKitTestSupport

@testable import KombatCore

enum Fixtures {
    static let me = String(repeating: "ab", count: 32)
    static let them = String(repeating: "cd", count: 32)

    static func corner(_ seat: String, _ member: String, _ name: String, _ fighter: String, hp: UInt32 = 100) -> FighterView {
        FighterView(seat: seat, member: member, name: name, fighter: fighter, hp: hp, roundsWon: 0, matchesWon: 0, online: true)
    }

    /// An arena where I hold the left corner and the fight is on.
    static func arena(
        status: String = "fighting", mySeat: String = "p1", p1: FighterView? = nil, p2: FighterView? = nil,
        winner: String = "", matchActions: UInt32 = 3, matchIndex: UInt32 = 0
    ) -> ArenaView {
        ArenaView(
            title: "Friday night", createdAt: 1, matchIndex: matchIndex, round: 1, status: status, roundResults: ["p1"],
            winner: winner, flawless: false, p1: p1 ?? corner("p1", me, "Ana", "cryo"),
            p2: p2 ?? corner("p2", them, "Ben", "jinzo"), me: me, mySeat: mySeat,
            hits: [HitView(by: "p1", id: 7, kind: "punch", damage: 5, blocked: false, at: 1)], matchActions: matchActions,
            totalActions: 128, maxHp: 100, roundsToWin: 2)
    }

    static func json<T: Encodable>(_ value: T) -> JSONValue {
        let data = try! JSONEncoder().encode(value)
        return try! JSONDecoder().decode(JSONValue.self, from: data)
    }
}

/// A scriptable contract: answers `arena` with whatever `view` holds, `history` with `past`, and
/// records every call (via the SDK's `RecordingContextContract`).
final class ArenaScript: @unchecked Sendable {
    private let lock = NSLock()
    private var _view: ArenaView
    private var _refuse: [String: String] = [:]
    var past: [MatchSummary] = []

    init(_ view: ArenaView) { _view = view }

    var view: ArenaView {
        get { lock.lock(); defer { lock.unlock() }; return _view }
        set { lock.lock(); _view = newValue; lock.unlock() }
    }

    func refuse(_ method: String, _ message: String) {
        lock.lock(); _refuse[method] = message; lock.unlock()
    }

    func install(on recording: RecordingContextContract) {
        recording.setHandler { [self] call in
            lock.lock()
            let refusal = _refuse[call.method]
            let view = _view
            let past = past
            lock.unlock()
            if let refusal { throw Refusal(message: refusal) }
            switch call.method {
            case "arena": return Fixtures.json(view)
            case "history": return Fixtures.json(past)
            case "rematch": return .number(1)
            default: return .null
            }
        }
    }
}

struct Refusal: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Presence that records what is published and plays back what the test feeds it.
final class FakePresence: PresenceChannel, @unchecked Sendable {
    private let lock = NSLock()
    private var _published: [String] = []
    private var _retracted = 0
    private var continuation: AsyncThrowingStream<String, Error>.Continuation?
    /// Each publish waits this long, to hold one "in flight".
    var delayNanos: UInt64 = 0

    var published: [String] { lock.lock(); defer { lock.unlock() }; return _published }
    var retracted: Int { lock.lock(); defer { lock.unlock() }; return _retracted }

    func publish(_ sliceJSON: String) async throws {
        if delayNanos > 0 { try? await Task.sleep(nanoseconds: delayNanos) }
        record(sliceJSON)
    }

    func retract() async { countRetract() }

    private func record(_ slice: String) { lock.lock(); _published.append(slice); lock.unlock() }
    private func countRetract() { lock.lock(); _retracted += 1; lock.unlock() }

    func slices() -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            self.lock.lock(); self.continuation = continuation; self.lock.unlock()
        }
    }

    func feed(_ slice: String) {
        lock.lock(); let c = continuation; lock.unlock()
        c?.yield(slice)
    }
}

/// Collects what a model delivers to the page.
@MainActor
final class PageSpy {
    var messages: [BridgeOutbound] = []
    func attach(_ host: GameHost) { host.deliver = { [weak self] in self?.messages.append($0) } }
    var boots: [BridgeOutbound] { messages.filter { if case .boot = $0 { return true } else { return false } } }
    var states: [String] { messages.compactMap { if case .state(let v) = $0 { return v } else { return nil } } }
}
