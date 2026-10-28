import Foundation
import MeroKit

/// What a screen hosting the game page does with it: answer what the page posts, and push what the
/// page needs through ``deliver``. (Kotlin `GameHost`.)
@MainActor
public protocol GameHost: AnyObject {
    /// Set by the web view: runs a message's script on the page. Messages sent before it is set
    /// are not queued; the page asks for what it needs with `ready`.
    var deliver: ((BridgeOutbound) -> Void)? { get set }
    func receive(_ message: BridgeInbound) async
}

/// The transactions this screen sent, for the top bar's meter (the web app's chain panel, small).
public struct TxMeter: Equatable, Sendable {
    public var sent = 0
    public var ok = 0
    public var failed = 0
    /// Round trip of the last confirmed action, ms.
    public var lastMs = 0

    public init() {}
}

/// One arena, kept current, and the game page fighting in it: the port of the web app's
/// `useArena` + `ArenaPage`. (Kotlin `ArenaModel`.)
///
/// Movement is presence and actions are transactions, exactly as on the web: the page simulates
/// this fighter, streams it at 15 slices a second through ``SlicePublisher`` and sends each finished
/// action as one `act` through ``GameCalls``. Every contract read lands here first and is pushed
/// to the page, so the corners sheet and the fight always read the same arena.
@MainActor
public final class ArenaModel: ObservableObject, GameHost {
    public let ref: ArenaRef
    public var contextId: String { ref.contextId }

    @Published public private(set) var view: ArenaView?
    @Published public private(set) var past: [MatchSummary] = []
    @Published public private(set) var error: String?
    @Published public private(set) var busy = false
    @Published public private(set) var meter = TxMeter()
    /// Corners streaming presence right now: the honest "online" for a fight.
    @Published public private(set) var live: Set<String> = []
    @Published public var name: String {
        didSet { store.name = name }
    }
    @Published public private(set) var fighter: String

    public var deliver: ((BridgeOutbound) -> Void)?

    private let backend: any MeroAppBackend
    private let client: KombatClient
    private let calls: GameCalls
    private let store: PlayerStore
    private let presence: (any PresenceChannel)?
    private let publisher: SlicePublisher?
    private var lastSeen: [String: Date] = [:]
    private var reading = false
    private var readAgain = false
    private var pastSignature: String?
    private var announced = false
    private var booted: BridgeOutbound?

    public init(
        backend: any MeroAppBackend, ref: ArenaRef, store: PlayerStore, presence: (any PresenceChannel)?
    ) {
        self.backend = backend
        self.ref = ref
        self.store = store
        self.presence = presence
        self.publisher = presence.map { SlicePublisher(channel: $0) }
        self.client = KombatClient.bound(backend, contextId: ref.contextId)
        self.calls = GameCalls(client: client)
        self.name = store.name
        self.fighter = store.fighter
    }

    // MARK: Derived

    public var mySeat: String { view?.mySeat ?? "" }
    public var isSeated: Bool { !mySeat.isEmpty }
    /// The engine's slot: 0 for p1, 1 for p2, nil to watch.
    public var local: Int? { mySeat == "p1" ? 0 : mySeat == "p2" ? 1 : nil }
    public var mode: GameMode { local == nil ? .spectate : .net }
    public var isFighting: Bool { view?.status == "fighting" && isSeated }
    public var isFinished: Bool { view?.status == "finished" }
    public var hasPresence: Bool { presence != nil }

    public var statusText: String {
        guard let view else { return "Reading the arena…" }
        return KombatText.status(view, bothLive: live.contains("p1") && live.contains("p2"))
    }

    /// The engine's two looks, p1 then p2 (the web page's defaults for empty corners).
    public var fighters: [String] {
        [view.map { $0.p1.fighter.isEmpty ? "kinetic" : $0.p1.fighter } ?? "kinetic",
         view.map { $0.p2.fighter.isEmpty ? "cryo" : $0.p2.fighter } ?? "cryo"]
    }

    /// Leaving is offered only while the contract allows it: before the arena's first blow.
    public func canLeave(_ corner: FighterView) -> Bool {
        guard let view else { return false }
        return !corner.member.isEmpty && corner.member == view.me && view.matchActions == 0 && view.matchIndex == 0
    }

    // MARK: Running

    /// Announce, read, then keep current: every relay event is a nudge to re-read, the poll
    /// covers events missed while the stream reconnects, and the opponent's presence streams in.
    public func run() async {
        await announce()
        await refresh()
        await withTaskGroup(of: Void.self) { group in
            group.addTask { [weak self] in await self?.listen() }
            group.addTask { [weak self] in await self?.poll() }
            group.addTask { [weak self] in await self?.watchPresence() }
            group.addTask { [weak self] in await self?.ageLiveness() }
        }
    }

    private func listen() async {
        do {
            for try await _ in backend.events(contextId: contextId) { await refresh() }
        } catch {
            // The stream ended; the poll keeps the arena current.
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(KombatConstants.pollSeconds * 1_000_000_000))
            if Task.isCancelled { return }
            await refresh()
        }
    }

    private func watchPresence() async {
        guard let stream = presence?.slices() else { return }
        do {
            for try await slice in stream { onSlice(slice) }
        } catch {
            // No event connection on this session: the fight still runs on contract reads.
        }
    }

    private func ageLiveness() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            updateLiveness()
        }
    }

    /// The opponent's slice: straight to the page, and it says their corner is here.
    func onSlice(_ json: String) {
        if let data = json.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let seat = object["seat"] as? String, seat == "p1" || seat == "p2"
        {
            lastSeen[seat] = Date()
            updateLiveness()
        }
        deliver?(.slice(json: json))
    }

    private func updateLiveness() {
        let now = Date()
        let next = Set(lastSeen.filter { now.timeIntervalSince($0.value) < KombatConstants.presenceStaleSeconds }.keys)
        if next != live { live = next }
    }

    /// Announce this account in the arena with a name and a fighter, once (`join`).
    public func announce() async {
        guard !announced else { return }
        announced = true
        _ = try? await client.join(name: displayName, fighter: fighter, now: nowMillis())
    }

    private var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? KombatConstants.defaultName : String(trimmed.prefix(24))
    }

    // MARK: Reading

    /// Re-read the arena. Coalesced: at most one read in flight and one more queued behind it, at
    /// least 160 ms apart (the web app's rule: a fight emits an event per transaction).
    public func refresh() async {
        if reading {
            readAgain = true
            return
        }
        reading = true
        defer { reading = false }
        repeat {
            readAgain = false
            let started = Date()
            do {
                apply(try await client.arena(now: nowMillis()))
                error = nil
            } catch is CancellationError {
                return
            } catch {
                self.error = KombatText.error(error)
                return
            }
            let rest = KombatConstants.minReadGapSeconds - Date().timeIntervalSince(started)
            if readAgain, rest > 0 { try? await Task.sleep(nanoseconds: UInt64(rest * 1_000_000_000)) }
        } while readAgain
        await refreshPastIfNeeded()
    }

    func apply(_ next: ArenaView) {
        view = next
        pushBoot()
        if let json = try? GameCalls.encode(next) { deliver?(.state(viewJSON: json)) }
    }

    /// Boot (or re-boot) the page when what the game fundamentally IS changes: the mode, the seat,
    /// the looks. A read that changes nothing else is fed into the running game.
    private func pushBoot() {
        let boot = BridgeOutbound.boot(mode: mode, local: local, fighters: fighters, muted: store.muted)
        guard boot != booted else { return }
        booted = boot
        deliver?(boot)
    }

    private func refreshPastIfNeeded() async {
        guard let view else { return }
        let signature = "\(view.matchIndex):\(view.winner)"
        guard signature != pastSignature else { return }
        if let rows = try? await client.history() {
            past = rows
            pastSignature = signature
        }
    }

    /// Finished matches, newest first, at most six (the web app's record card).
    public var record: [MatchSummary] { Array(past.filter { !$0.winner.isEmpty }.reversed().prefix(6)) }

    // MARK: The page

    public func receive(_ message: BridgeInbound) async {
        switch message {
        case .ready:
            booted = nil
            pushBoot()
            if let view, let json = try? GameCalls.encode(view) { deliver?(.state(viewJSON: json)) }
        case .call(let id, let kind, let method, let args):
            let isAct = kind == .execute && method == "act"
            if isAct { meter.sent += 1 }
            let started = Date()
            let answer = await calls.handle(id: id, kind: kind, method: method, argsJSON: args)
            if isAct {
                if case .result = answer {
                    meter.ok += 1
                    meter.lastMs = Int(Date().timeIntervalSince(started) * 1000)
                } else {
                    meter.failed += 1
                }
                Task { await self.refresh() }
            }
            deliver?(answer)
        case .presence(let slice):
            await publisher?.offer(slice)
        case .over:
            break
        }
    }

    /// The screen left the foreground or closed: stop the page and take this fighter's slice down.
    public func pause() {
        deliver?(.pause)
    }

    public func resume() {
        deliver?(.resume)
    }

    public func leaveScreen() async {
        await presence?.retract()
    }

    // MARK: Corners

    public func sit(_ seat: String) async {
        let name = displayName
        if let namespaceId = ref.namespaceId {
            // The web app's `names.publish(name)`: the namespace-wide name, best-effort.
            let backend = backend
            Task { try? await backend.setMemberName(groupId: namespaceId, name: name) }
        }
        await call { [fighter] in try await $0.sit(seat: seat, name: name, fighter: fighter, now: nowMillis()) }
    }

    public func stand() async { await call { try await $0.stand(now: nowMillis()) } }
    public func rematch() async { await call { _ = try await $0.rematch(now: nowMillis()) } }

    public func choose(_ id: String) async {
        fighter = id
        store.fighter = id
        if isSeated { await call { try await $0.pick(fighter: id, now: nowMillis()) } }
    }

    public var muted: Bool {
        get { store.muted }
        set {
            store.muted = newValue
            objectWillChange.send()
            deliver?(.mute(newValue))
        }
    }

    public func dismissError() { error = nil }

    @discardableResult
    private func call(_ body: @escaping (KombatClient) async throws -> Void) async -> Bool {
        busy = true
        error = nil
        var ok = true
        do {
            try await body(client)
        } catch {
            self.error = KombatText.error(error)
            ok = false
        }
        busy = false
        let kept = error
        await refresh()
        if !ok { error = kept }
        return ok
    }

    // MARK: Inviting

    public func inviteLink() async throws -> String {
        guard let namespaceId = ref.namespaceId else { throw KombatError.noNamespace }
        let signed = try await backend.createInvitation(namespaceId: namespaceId)
        return try KombatInvitation(invitation: signed, namespaceId: namespaceId, contextId: contextId).link()
    }
}

/// Practice against the CPU: the same page in `cpu` mode, no contract and no presence. (Kotlin `PracticeModel`.)
@MainActor
public final class PracticeModel: ObservableObject, GameHost {
    @Published public private(set) var fighter: String
    @Published public private(set) var over = false
    public var deliver: ((BridgeOutbound) -> Void)?
    private let store: PlayerStore

    public init(store: PlayerStore) {
        self.store = store
        self.fighter = store.fighter
    }

    public var cpu: String { FighterInfo.cpu(against: fighter).id }

    public var muted: Bool {
        get { store.muted }
        set {
            store.muted = newValue
            objectWillChange.send()
            deliver?(.mute(newValue))
        }
    }

    public func receive(_ message: BridgeInbound) async {
        switch message {
        case .ready: boot()
        case .over(let isOver): over = isOver
        case .call(let id, _, _, _): deliver?(.failure(id: id, message: "Practice is off the chain"))
        case .presence: break
        }
    }

    public func choose(_ id: String) {
        fighter = id
        store.fighter = id
        boot()
    }

    public func rematch() {
        over = false
        deliver?(.restart)
    }

    private func boot() {
        over = false
        deliver?(.boot(mode: .cpu, local: 0, fighters: [fighter, cpu], muted: store.muted))
    }
}
