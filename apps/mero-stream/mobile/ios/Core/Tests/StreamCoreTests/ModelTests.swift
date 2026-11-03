import MeroKit
import MeroKitTestSupport
import XCTest

@testable import StreamCore

/// A presence channel in memory: records what is published, and lets a test push slices in.
final class FakeChannel: MediaChannel, @unchecked Sendable {
    let selfAuthor: String?
    private let lock = NSLock()
    private var published: [[UInt8]] = []
    private var retracted = 0
    private var continuation: AsyncThrowingStream<MediaSlice, Error>.Continuation?
    var failing = false

    init(selfAuthor: String = "me-device") { self.selfAuthor = selfAuthor }

    var slicesPublished: [[UInt8]] { lock.withLock { published } }
    var retractions: Int { lock.withLock { retracted } }

    func publish(contextId: String, slice: [UInt8]) async throws {
        if failing { throw URLError(.notConnectedToInternet) }
        lock.withLock { published.append(slice) }
    }

    func retract(contextId: String) async { lock.withLock { retracted += 1 } }

    func slices(contextId: String) -> AsyncThrowingStream<MediaSlice, Error> {
        AsyncThrowingStream { continuation in lock.withLock { self.continuation = continuation } }
    }
}

/// A clock a test moves by hand.
final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    init(_ start: UInt64 = 1_000_000) { value = start }
    var now: UInt64 { lock.withLock { value } }
    func advance(_ ms: UInt64) { lock.withLock { value += ms } }
}

@MainActor
final class StreamsModelTests: XCTestCase {
    func testLoadsStreamsWithRoomCounts() async {
        let backend = InMemoryAppBackend()
        backend.namespaces = [AppNamespace(id: "ns1", name: "Studio", applicationId: backend.applicationId, memberCount: 3)]
        _ = try? await backend.createContext(groupId: "ns1", applicationId: "app1", name: "Daily", initArgs: .null)
        let model = StreamsModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.streams, [StreamSummary(id: "ns1", name: "Studio", memberCount: 3, roomCount: 1)])
        XCTAssertNil(model.error)
    }

    func testCreateFoundsANamespace() async {
        let backend = InMemoryAppBackend()
        let model = StreamsModel(backend: backend)
        let stream = await model.create(name: "  Launch  ")
        XCTAssertEqual(stream?.name, "Launch")
        XCTAssertEqual(backend.log.first, "foundNamespace Launch")
        XCTAssertEqual(model.streams.count, 1)
    }

    func testStreamInviteRoundTripsAndJoinLands() async throws {
        let backend = InMemoryAppBackend()
        let model = StreamsModel(backend: backend)
        let minted = await model.inviteLink(for: StreamSummary(id: String(repeating: "0a", count: 32), name: "Studio"))
        let link = try XCTUnwrap(minted)
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-stream/join?invitation="))
        let invitation = try XCTUnwrap(StreamInvitation.parse(link))
        XCTAssertEqual(invitation.kind, .namespace)
        XCTAssertEqual(invitation.namespaceName, "Studio")

        let landing = await model.join(invitation)
        XCTAssertEqual(landing, .stream(StreamSummary(id: invitation.namespaceId, name: "Studio")))
        XCTAssertTrue(backend.log.contains("joinNamespace \(invitation.namespaceId)"))
    }
}

@MainActor
final class RoomsModelTests: XCTestCase {
    let stream = StreamSummary(id: "ns1", name: "Studio")

    func testCreateRoomMakesAnAppInstanceInTheStreamsOrg() async throws {
        let backend = InMemoryAppBackend()
        let model = RoomsModel(stream: stream, backend: backend, applicationId: "com.calimero.mero-stream")
        let created = await model.create(name: "Standup")
        let room = try XCTUnwrap(created)
        XCTAssertEqual(room.contextId, room.id)
        XCTAssertTrue(backend.log.contains("createContext ns1 com.calimero.mero-stream Standup"))
        XCTAssertTrue(backend.publicSubgroups.isEmpty, "a room is no longer a team")
        XCTAssertEqual(backend.initArgs[room.id], .object(["name": .string("Standup")]))
        XCTAssertEqual(model.rooms, [room])
    }

    func testLoadListsTheOrgsRoomsWithTheirRostersAndEnterNeedsNoJoin() async throws {
        let backend = InMemoryAppBackend()
        let appId = try await backend.createContext(groupId: "ns1", applicationId: "app1", name: "Daily", initArgs: .null)
        backend.recording.setHandler { call in
            call.method == "getMembers"
                ? .array([.object(["memberId": "x", "username": "Xia", "joinedAt": "1", "updatedAt": "1"])]) : .null
        }
        let model = RoomsModel(stream: stream, backend: backend, applicationId: "app1")
        await model.load()
        XCTAssertEqual(model.rooms.map(\.title), ["Daily"])
        XCTAssertEqual(model.rosters[appId]?.map(\.username), ["Xia"])

        let entered = await model.enter(model.rooms[0])
        XCTAssertEqual(entered?.contextId, appId)
        XCTAssertFalse(backend.log.contains { $0.hasPrefix("joinContext") })
    }

    func testRoomInviteCarriesTheRoom() async throws {
        let backend = InMemoryAppBackend()
        let model = RoomsModel(stream: stream, backend: backend, applicationId: "app1")
        let room = RoomSummary(id: "app9", namespaceId: "ns1", name: "Daily")
        let minted = await model.inviteLink(for: room)
        let link = try XCTUnwrap(minted)
        let invitation = try XCTUnwrap(StreamInvitation.parse(link))
        XCTAssertTrue(invitation.opensRoom)
        XCTAssertEqual(invitation.roomId, "app9")
        XCTAssertEqual(invitation.contextId, "app9")
        XCTAssertEqual(invitation.roomName, "Daily")
        XCTAssertNil(StreamInvitation.parse(link.replacingOccurrences(of: "mero-stream", with: "mero-chat")))
    }
}

@MainActor
final class CallModelTests: XCTestCase {
    let room = RoomSummary(id: "c1", namespaceId: "ns1", name: "Daily")

    private func make(_ clock: TestClock, channel: FakeChannel = FakeChannel()) -> (CallModel, InMemoryAppBackend, FakeChannel) {
        let backend = InMemoryAppBackend()
        backend.recording.setHandler { call in
            switch call.method {
            case "join":
                return .object(["memberId": "me-device", "username": "Ana", "joinedAt": "1", "updatedAt": "1"])
            case "getMembers":
                return .array([
                    .object(["memberId": "me-device", "username": "Ana", "joinedAt": "1", "updatedAt": "1"]),
                    .object(["memberId": "bo", "username": "", "joinedAt": "1", "updatedAt": "1"]),
                ])
            default:
                return .null
            }
        }
        let model = CallModel(
            room: room, contextId: "c1", backend: backend, channel: channel, name: "Ana", now: { clock.now },
            sleep: { _ in await Task.yield() })
        return (model, backend, channel)
    }

    private func slices(_ frame: LiveFrame) -> [[UInt8]] { (try? LiveFrames.encodeFragments(frame)) ?? [] }

    private func video(_ seq: UInt32, key: Bool, started: UInt64 = 900_000, bytes: [UInt8] = [0, 0, 0, 1, 0x65]) -> LiveFrame {
        LiveFrame(
            msgSeq: seq, track: 0, isKeyframe: key, width: 640, height: 480, timestampUs: UInt64(seq), createdAtMs: 999_000,
            startedAtMs: started, codec: "avc1.42001f", bytes: bytes)
    }

    private func waitUntil(_ condition: @autoclosure () -> Bool) async {
        for _ in 0..<200 where !condition() { await Task.yield() }
    }

    func testJoinsTheRoomWithTheNameAndReadsTheRoster() async {
        let clock = TestClock()
        let (model, backend, _) = make(clock)
        model.start()
        await waitUntil(model.joined && !model.members.isEmpty)
        XCTAssertTrue(model.joined)
        let join = backend.recording.calls("join").first
        XCTAssertEqual(join?.args["username"], .string("Ana"))
        // u64 travels as a decimal string: unix seconds.
        XCTAssertEqual(join?.args["now"], .string(String(clock.now / 1000)))
        // Bo set no room name: the stream-wide one (org member metadata) shows.
        backend.groupMembers = ["ns1": [AppMember(identity: "bo", role: "Member", name: "Bo")]]
        await model.refreshStreamNames()
        XCTAssertEqual(model.people.map(\.name), ["Ana", "Bo"])
        model.stop()
    }

    func testAPeerIsDecodedFromItsFirstKeyframeOnly() {
        let clock = TestClock()
        let (model, _, _) = make(clock)
        var decoded: [UInt32] = []
        model.onVideo = { author, frame in
            XCTAssertEqual(author, "bo")
            decoded.append(frame.msgSeq)
        }
        for frame in [video(1, key: false), video(2, key: true), video(3, key: false)] {
            for s in slices(frame) { model.ingest(MediaSlice(author: "bo", bytes: s)) }
        }
        XCTAssertEqual(decoded, [2, 3])
        XCTAssertEqual(model.peers.map(\.id), ["bo"])
        XCTAssertTrue(model.peers[0].decoding)

        // A decoder failure waits for the next keyframe again.
        model.decoderFailed("bo")
        for s in slices(video(4, key: false)) { model.ingest(MediaSlice(author: "bo", bytes: s)) }
        XCTAssertEqual(decoded, [2, 3])
    }

    func testOwnEchoReplaysAndForeignSlicesAreIgnored() {
        let clock = TestClock()
        let (model, _, _) = make(clock)
        var count = 0
        model.onVideo = { _, _ in count += 1 }
        for s in slices(video(1, key: true)) {
            model.ingest(MediaSlice(author: "me-device", bytes: s))
            model.ingest(MediaSlice(author: "bo", bytes: s, ageMs: 300))
        }
        model.ingest(MediaSlice(author: "bo", bytes: Array("{}".utf8)))
        XCTAssertEqual(count, 0)
        XCTAssertTrue(model.peers.isEmpty)
    }

    func testSilentPeersAreReapedAndRemovalDropsThem() {
        let clock = TestClock()
        let (model, _, _) = make(clock)
        var gone: [String] = []
        model.onPeerGone = { gone.append($0) }
        for s in slices(video(1, key: true)) { model.ingest(MediaSlice(author: "bo", bytes: s)) }
        for s in slices(video(1, key: true)) { model.ingest(MediaSlice(author: "cy", bytes: s)) }
        model.ingest(MediaSlice(author: "cy", bytes: nil, removed: true))
        XCTAssertEqual(model.peers.map(\.id), ["bo"])
        clock.advance(CallModel.peerTimeoutMs + 1)
        model.tick()
        XCTAssertTrue(model.peers.isEmpty)
        XCTAssertEqual(gone, ["cy", "bo"])
    }

    func testGoingLivePublishesWebCompatibleFramesAndYieldsWhenOutranked() async throws {
        let clock = TestClock()
        let (model, _, channel) = make(clock)
        model.start()
        await waitUntil(model.joined)
        XCTAssertTrue(model.goLive())
        XCTAssertTrue(model.takeKeyframeRequest())
        let unit = [UInt8](repeating: 7, count: 20_000)
        model.sendVideo(unit, isKeyframe: true, timestampUs: 33, width: 480, height: 640, codec: "avc1.42c01f")
        // 20 kB in 1.0 presence's 4 KiB slices: five fragments.
        await waitUntil(channel.slicesPublished.count == 5)
        XCTAssertTrue(channel.slicesPublished.allSatisfy { $0.count <= 4_096 })
        let published = channel.slicesPublished.compactMap(LiveFrames.decodeFragment)
        XCTAssertEqual(published.count, 5)
        let reassembler = FrameReassembler()
        for fragment in published.dropLast() { XCTAssertNil(reassembler.push("x", fragment)) }
        let frame = try XCTUnwrap(reassembler.push("x", published[4]))
        XCTAssertEqual(frame.bytes, unit)
        XCTAssertEqual(frame.track, 0)
        XCTAssertEqual(frame.width, 480)
        XCTAssertEqual(frame.startedAtMs, clock.now)

        // Two earlier broadcasters appear: this phone is third and yields.
        for author in ["bo", "cy"] {
            for s in slices(video(1, key: true, started: 1)) { model.ingest(MediaSlice(author: author, bytes: s)) }
        }
        model.tick()
        XCTAssertFalse(model.isLive)
        XCTAssertTrue(model.yielded)
        XCTAssertFalse(model.canGoLive)
        model.stop()
        await waitUntil(channel.retractions == 1)
        XCTAssertEqual(channel.retractions, 1)
    }

    func testAudioTravelsAsMulawOnTrackOne() async throws {
        let clock = TestClock()
        let (model, _, channel) = make(clock)
        model.start()
        await waitUntil(model.joined)
        model.setMic(true)
        let samples: [Int16] = [0, 1000, -1000, 8159]
        model.sendAudio(samples, timestampUs: 200_000)
        await waitUntil(channel.slicesPublished.count == 1)
        let fragment = try XCTUnwrap(channel.slicesPublished.first.flatMap(LiveFrames.decodeFragment))
        XCTAssertEqual(fragment.track, 1)
        XCTAssertEqual(fragment.codec, "ulaw")
        XCTAssertEqual(fragment.payload, Mulaw.encode(samples))

        var heard: [Int16] = []
        model.onAudio = { author, pcm in
            XCTAssertEqual(author, "bo")
            heard = pcm
        }
        model.ingest(MediaSlice(author: "bo", bytes: channel.slicesPublished[0]))
        XCTAssertEqual(heard, Mulaw.decode(Mulaw.encode(samples)))
        XCTAssertEqual(model.speaking, ["bo"])
        XCTAssertTrue(model.peers.isEmpty, "audio alone is not a broadcast slot")
        model.stop()
    }

    func testFallingBehindDropsDeltasAndAsksForAKeyframe() async {
        let clock = TestClock()
        let channel = FakeChannel()
        let (model, _, _) = make(clock, channel: channel)
        model.start()
        await waitUntil(model.joined)
        model.goLive()
        _ = model.takeKeyframeRequest()
        for i in 0..<10 {
            model.sendVideo([UInt8(i)], isKeyframe: false, timestampUs: UInt64(i), width: 480, height: 640, codec: "avc1.42001f")
        }
        XCTAssertGreaterThan(model.stats.framesDropped, 0)
        XCTAssertTrue(model.takeKeyframeRequest())
        model.stop()
    }
}
