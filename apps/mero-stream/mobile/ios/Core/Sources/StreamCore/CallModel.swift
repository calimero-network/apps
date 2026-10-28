import Foundation
import MeroKit

/// A remote sender of video, as the call sees it.
public struct RemotePeer: Identifiable, Equatable, Sendable {
    public let id: String
    public var startedAtMs: UInt64
    public var width: Int
    public var height: Int
    /// A keyframe has arrived, so its frames reach the decoder.
    public var decoding: Bool
    public var framesDecoded: Int
}

/// Numbers for the call's Details sheet (the web's "Call details").
public struct CallStats: Equatable, Sendable {
    public var framesSent = 0
    public var framesDropped = 0
    public var publishErrors = 0
    public var framesReceived = 0
    public var audioPacketsSent = 0
    public var audioPacketsReceived = 0
    /// Smoothed publish round trip, one slice.
    public var publishMs: Double?
    /// Smoothed sender-to-here latency (sender's clock, so skew included).
    public var latencyMs: Double?
    public var lastCodec: String?
}

/// One call: joining the room's contract, the roster, and the media loop on
/// the context's ephemeral presence, exactly as the web's `useLiveStream`:
///
/// - **Send.** The platform encoder hands over H.264 Annex-B access units;
///   each is framed (``LiveFrames``) into ≤16 KiB slices and published one at a
///   time. Audio (µ-law, track 1) rides the same channel.
/// - **Receive.** Every slice in the context is parsed and reassembled per
///   sender and track; video passes a per-sender keyframe gate before it
///   reaches that sender's decoder.
/// - **Slots.** At most ``Slots/maxBroadcasters`` send video; everyone ranks the
///   same headers and a sender outside the cap yields.
@MainActor
public final class CallModel: ObservableObject {
    public nonisolated static let peerTimeoutMs: UInt64 = 6_000
    public nonisolated static let keyframeIntervalMs: UInt64 = 2_000
    /// A phone publishes each slice as a signed relay POST, so it starts lower
    /// than the web's 25 fps / 1.5 Mbps; the shared split applies on top.
    public nonisolated static let baseEncoding = Encoding(fps: 15, bitrate: 1_000_000)
    public nonisolated static let joinRetryDelaysMs: [UInt64] = [500, 1_000, 2_000, 3_000, 5_000]
    public nonisolated static let joinDeadlineMs: UInt64 = 120_000
    public nonisolated static let membersRefreshMs: UInt64 = 10_000
    /// Someone is "speaking" while their audio arrived this recently.
    public nonisolated static let audioActiveMs: UInt64 = 1_200
    /// Frames waiting to be published before a new delta frame is dropped.
    public nonisolated static let maxQueuedFrames = 3
    /// Consecutive publish failures before the call says so.
    nonisolated static let failuresBeforeError = 3

    @Published public private(set) var joined = false
    @Published public private(set) var joinFailed: String?
    @Published public private(set) var members: [Member] = []
    @Published public private(set) var peers: [RemotePeer] = []
    @Published public private(set) var speaking: Set<String> = []
    @Published public private(set) var slots: SlotView = .empty
    @Published public private(set) var isLive = false
    @Published public private(set) var micOn = false
    @Published public private(set) var yielded = false
    @Published public private(set) var name: String
    @Published public private(set) var stats = CallStats()
    @Published public var error: String?

    public let room: RoomSummary
    public let contextId: String
    public let backend: any MeroAppBackend
    public let channel: (any MediaChannel)?
    /// This device's id in the room: the author its slices carry.
    public let me: String
    public let startedAt: Date

    /// A decodable video frame for a sender's decoder.
    public var onVideo: ((String, LiveFrame) -> Void)?
    /// Decoded audio (8 kHz mono) from a sender.
    public var onAudio: ((String, [Int16]) -> Void)?
    /// A sender went quiet or away: drop its decoder and player (they are
    /// made again on its next frame).
    public var onPeerGone: ((String) -> Void)?

    private let client: StreamClient
    private let now: @Sendable () -> UInt64
    private let sleep: @Sendable (UInt64) async -> Void

    private struct PeerState {
        var startedAtMs: UInt64
        let firstSeenAt: UInt64
        var lastSeenAt: UInt64
        var width: Int
        var height: Int
        var started: Bool
        var framesDecoded: Int
    }

    private var peerStates: [String: PeerState] = [:]
    private var audioSeen: [String: UInt64] = [:]
    private let reassembler = FrameReassembler()
    private var startedAtMs: UInt64?
    private var videoSeq: UInt32 = 0
    private var audioSeq: UInt32 = 0
    private var lastKeyframeAt: UInt64 = 0
    private var keyframeWanted = false
    private var outbox: [(fragments: [[UInt8]], isVideo: Bool)] = []
    private var pumping = false
    private var consecutiveFailures = 0
    private var tasks: [Task<Void, Never>] = []
    private var joinGeneration = 0

    public init(
        room: RoomSummary, contextId: String, backend: any MeroAppBackend, channel: (any MediaChannel)?, name: String,
        now: @escaping @Sendable () -> UInt64 = { nowMillis() },
        sleep: @escaping @Sendable (UInt64) async -> Void = { try? await Task.sleep(nanoseconds: $0 * 1_000_000) }
    ) {
        self.room = room
        self.contextId = contextId
        self.backend = backend
        self.channel = channel
        self.me = channel?.selfAuthor ?? backend.account
        self.name = name
        self.client = StreamClient(backend: backend, contextId: contextId)
        self.now = now
        self.sleep = sleep
        self.startedAt = Date()
    }

    // MARK: - Derived

    /// What the encoder should run at: the base split among the live broadcasters.
    public var encoding: Encoding { Encoding.adaptive(Self.baseEncoding, broadcasters: max(1, slots.occupied)) }

    /// Whether "Turn on camera" may claim a slot now.
    public var canGoLive: Bool { joined && channel != nil && (isLive || slots.mayClaim) }

    /// The display name, or the placeholder the web uses.
    public var displayName: String { name.trimmingCharacters(in: .whitespaces).isEmpty ? "guest" : name }

    /// Everyone in the room: the contract's members plus anyone sending.
    public var people: [Person] {
        People.roster(
            members: members.map { ($0.memberId, $0.username) }, liveIds: Set(peers.map(\.id)), me: me,
            selfName: displayName, selfLive: isLive)
    }

    public var degraded: Bool { slots.occupied >= Slots.degradedFromBroadcasters }

    // MARK: - Lifecycle

    /// Join the room and start the media loop.
    public func start() {
        guard tasks.isEmpty else { return }
        tasks.append(Task { [weak self] in await self?.joinLoop() })
        tasks.append(Task { [weak self] in await self?.tickLoop() })
        tasks.append(Task { [weak self] in await self?.membersLoop() })
        tasks.append(Task { [weak self] in await self?.eventsLoop() })
        if let channel {
            let stream = channel.slices(contextId: contextId)
            tasks.append(
                Task { [weak self] in
                    do {
                        for try await slice in stream {
                            guard let self else { return }
                            self.ingest(slice)
                        }
                    } catch {
                        self?.error = ErrorText.describe(error)
                    }
                })
        } else {
            error = StreamError.noPresence.errorDescription
        }
    }

    /// Leave: stop sending, retract our slice, stop listening.
    public func stop() {
        for task in tasks { task.cancel() }
        tasks = []
        isLive = false
        micOn = false
        startedAtMs = nil
        outbox.removeAll()
        if let channel {
            let contextId = contextId
            Task { await channel.retract(contextId: contextId) }
        }
    }

    // MARK: - Joining and the roster

    private func joinLoop() async {
        joinGeneration += 1
        let generation = joinGeneration
        let name = displayName
        let start = now()
        var attempt = 0
        while !Task.isCancelled, generation == joinGeneration {
            do {
                _ = try await client.join(username: name, now: now() / 1000)
                joined = true
                joinFailed = nil
                await refreshMembers()
                return
            } catch {
                let delay = Self.joinRetryDelaysMs[min(attempt, Self.joinRetryDelaysMs.count - 1)]
                attempt += 1
                if now() - start + delay > Self.joinDeadlineMs {
                    joinFailed = ErrorText.describe(error)
                    return
                }
                await sleep(delay)
            }
        }
    }

    /// Change your name in this room: re-join with it (the contract's join is idempotent).
    public func rename(_ next: String) async {
        let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        name = trimmed
        do {
            _ = try await client.join(username: trimmed, now: now() / 1000)
            joined = true
            await refreshMembers()
        } catch {
            self.error = ErrorText.describe(error)
        }
    }

    /// Try joining again after it gave up.
    public func retryJoin() {
        joinFailed = nil
        tasks.append(Task { [weak self] in await self?.joinLoop() })
    }

    public func refreshMembers() async {
        if let list = try? await client.getMembers() { members = list }
    }

    private func membersLoop() async {
        while !Task.isCancelled {
            await sleep(Self.membersRefreshMs)
            if Task.isCancelled { return }
            if joined { await refreshMembers() }
        }
    }

    /// A state change in the room (someone joined or renamed): re-read the roster.
    private func eventsLoop() async {
        guard backend.canSubscribe else { return }
        do {
            for try await event in backend.events(contextId: contextId) where event.kind != "Ephemeral" {
                if Task.isCancelled { return }
                if joined { await refreshMembers() }
            }
        } catch {}
    }

    // MARK: - Camera and mic

    /// Claim a broadcast slot. False when all slots are taken.
    @discardableResult
    public func goLive() -> Bool {
        guard canGoLive else { return false }
        if isLive { return true }
        startedAtMs = now()
        isLive = true
        yielded = false
        keyframeWanted = true
        recomputeSlots()
        return true
    }

    public func stopLive() {
        isLive = false
        startedAtMs = nil
        outbox.removeAll { $0.isVideo }
        recomputeSlots()
    }

    public func setMic(_ on: Bool) { micOn = on && joined && channel != nil }

    public func clearYielded() { yielded = false }

    /// Whether the encoder should make the next frame a keyframe: every
    /// ``keyframeIntervalMs`` (a joiner's way in), or after a dropped frame.
    public func takeKeyframeRequest() -> Bool {
        let t = now()
        if keyframeWanted || t - lastKeyframeAt >= Self.keyframeIntervalMs {
            keyframeWanted = false
            lastKeyframeAt = t
            return true
        }
        return false
    }

    // MARK: - Send

    /// Publish one encoded video access unit (Annex-B).
    public func sendVideo(_ accessUnit: [UInt8], isKeyframe: Bool, timestampUs: UInt64, width: Int, height: Int, codec: String) {
        guard isLive, let startedAtMs else { return }
        let queued = outbox.filter(\.isVideo).count
        if !isKeyframe, queued >= Self.maxQueuedFrames {
            // Behind: dropping a delta breaks the picture until the next
            // keyframe, so ask for one now rather than in two seconds.
            stats.framesDropped += 1
            keyframeWanted = true
            return
        }
        videoSeq = LiveFrames.nextMsgSeq(videoSeq)
        let frame = LiveFrame(
            msgSeq: videoSeq, track: 0, isKeyframe: isKeyframe, width: width, height: height, timestampUs: timestampUs,
            createdAtMs: now(), startedAtMs: startedAtMs, codec: codec, bytes: accessUnit)
        guard let fragments = try? LiveFrames.encodeFragments(frame) else {
            stats.framesDropped += 1
            return
        }
        stats.lastCodec = codec
        enqueue(fragments, isVideo: true)
    }

    /// Publish 16-bit mono samples at 8 kHz as one µ-law packet on track 1.
    public func sendAudio(_ samples: [Int16], timestampUs: UInt64) {
        guard micOn, joined, !samples.isEmpty else { return }
        audioSeq = LiveFrames.nextMsgSeq(audioSeq)
        let frame = LiveFrame(
            msgSeq: audioSeq, track: 1, isKeyframe: true, width: 0, height: 0, timestampUs: timestampUs,
            createdAtMs: now(), startedAtMs: startedAtMs ?? 0, codec: Mulaw.codec, bytes: Mulaw.encode(samples))
        guard let fragments = try? LiveFrames.encodeFragments(frame) else { return }
        // Audio is late or it is useless: never more than one packet waiting.
        outbox.removeAll { !$0.isVideo }
        enqueue(fragments, isVideo: false)
        stats.audioPacketsSent += 1
    }

    private func enqueue(_ fragments: [[UInt8]], isVideo: Bool) {
        outbox.append((fragments, isVideo))
        guard !pumping, let channel else { return }
        pumping = true
        Task { [weak self] in await self?.pump(channel) }
    }

    /// One slice at a time, in order: the relay drops a slice whose seq is
    /// below one it has already applied, so concurrent publishes would race.
    private func pump(_ channel: any MediaChannel) async {
        defer { pumping = false }
        while !outbox.isEmpty {
            let next = outbox.removeFirst()
            var ok = true
            for fragment in next.fragments {
                let began = now()
                do {
                    try await channel.publish(contextId: contextId, slice: fragment)
                    let took = Double(now() - began)
                    stats.publishMs = stats.publishMs.map { $0 * 0.8 + took * 0.2 } ?? took
                } catch {
                    ok = false
                    stats.publishErrors += 1
                    consecutiveFailures += 1
                    if consecutiveFailures >= Self.failuresBeforeError {
                        self.error = ErrorText.describe(error)
                    }
                    break
                }
            }
            if ok {
                consecutiveFailures = 0
                if next.isVideo { stats.framesSent += 1 }
            } else if next.isVideo {
                keyframeWanted = true
            }
        }
    }

    // MARK: - Receive

    /// One presence slice from the room.
    public func ingest(_ slice: MediaSlice) {
        if slice.removed {
            forget(slice.author)
            return
        }
        // A replayed entry is a stale frame by definition: never decode it.
        guard slice.ageMs == nil, let bytes = slice.bytes, let fragment = LiveFrames.decodeFragment(bytes) else {
            return
        }
        guard slice.author != me else { return }
        let t = now()
        switch fragment.track {
        case 0:
            guard let frame = reassembler.push("\(slice.author)#0", fragment) else { return }
            receiveVideo(from: slice.author, frame, at: t)
        case 1:
            guard let frame = reassembler.push("\(slice.author)#1", fragment), frame.codec == Mulaw.codec else { return }
            stats.audioPacketsReceived += 1
            if audioSeen[slice.author] == nil || !speaking.contains(slice.author) {
                speaking.insert(slice.author)
            }
            audioSeen[slice.author] = t
            onAudio?(slice.author, Mulaw.decode(frame.bytes))
        default:
            return
        }
    }

    private func receiveVideo(from author: String, _ frame: LiveFrame, at t: UInt64) {
        var peer =
            peerStates[author]
            ?? PeerState(
                startedAtMs: frame.startedAtMs, firstSeenAt: t, lastSeenAt: t, width: frame.width, height: frame.height,
                started: false, framesDecoded: 0)
        let isNew = peerStates[author] == nil
        peer.lastSeenAt = t
        peer.startedAtMs = frame.startedAtMs
        peer.width = frame.width
        peer.height = frame.height
        stats.framesReceived += 1
        if frame.createdAtMs > 0, t >= frame.createdAtMs {
            let latency = Double(t - frame.createdAtMs)
            stats.latencyMs = stats.latencyMs.map { $0 * 0.9 + latency * 0.1 } ?? latency
        }
        // Each sender is its own H.264 stream: a delta decodes only against a
        // keyframe from the same sender, and a joiner starts mid-GOP.
        let wasStarted = peer.started
        if !peer.started, frame.isKeyframe { peer.started = true }
        if peer.started { peer.framesDecoded += 1 }
        peerStates[author] = peer
        if isNew {
            publishPeers()
            recomputeSlots()
        } else if !wasStarted, peer.started {
            publishPeers()
        }
        if peer.started { onVideo?(author, frame) }
    }

    /// The platform decoder failed on a sender's stream: wait for its next keyframe.
    public func decoderFailed(_ author: String) {
        guard var peer = peerStates[author] else { return }
        peer.started = false
        peerStates[author] = peer
        publishPeers()
    }

    private func forget(_ author: String) {
        reassembler.forget("\(author)#0")
        reassembler.forget("\(author)#1")
        audioSeen.removeValue(forKey: author)
        speaking.remove(author)
        if peerStates.removeValue(forKey: author) != nil {
            publishPeers()
            recomputeSlots()
        }
        onPeerGone?(author)
    }

    // MARK: - The 1 s tick

    private func tickLoop() async {
        while !Task.isCancelled {
            await sleep(1_000)
            if Task.isCancelled { return }
            tick()
        }
    }

    /// Reap silent senders, refresh the slots, and yield when outranked.
    public func tick() {
        let t = now()
        let cutoff = t > Self.peerTimeoutMs ? t - Self.peerTimeoutMs : 0
        for (author, peer) in peerStates where peer.lastSeenAt < cutoff {
            peerStates.removeValue(forKey: author)
            reassembler.forget("\(author)#0")
            onPeerGone?(author)
        }
        for (author, at) in audioSeen where t - at > Self.audioActiveMs {
            speaking.remove(author)
            if t - at > Self.peerTimeoutMs {
                audioSeen.removeValue(forKey: author)
                reassembler.forget("\(author)#1")
                onPeerGone?(author)
            }
        }
        publishPeers()
        if recomputeSlots().mustYield {
            stopLive()
            yielded = true
        }
    }

    private func publishPeers() {
        let next = peerStates.map { id, p in
            RemotePeer(
                id: id, startedAtMs: p.startedAtMs, width: p.width, height: p.height, decoding: p.started,
                framesDecoded: p.framesDecoded)
        }
        .sorted { $0.id < $1.id }
        if next != peers { peers = next }
    }

    @discardableResult
    private func recomputeSlots() -> SlotView {
        let claims = peerStates.map { id, p in
            Claim(id: id, startedAtMs: p.startedAtMs, firstSeenAt: p.firstSeenAt, lastSeenAt: p.lastSeenAt)
        }
        let view = Slots.evaluate(
            others: claims, me: me, myStartedAtMs: startedAtMs, nowMs: now(), timeoutMs: Self.peerTimeoutMs)
        if view != slots { slots = view }
        return view
    }
}
