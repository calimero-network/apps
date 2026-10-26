import XCTest

/// The web app's display rules: times, grouping, avatars, placeholders, channel names.
final class ChatFormatTests: XCTestCase {
    private var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    private let now = Date(timeIntervalSince1970: 1_761_480_000)  // 2025-10-26 12:00 UTC

    func testMessageTimesAreClockTodayYesterdayThenADate() {
        XCTAssertEqual(ChatFormat.messageTime(1_761_480_000 - 3600 * 3 - 60 * 5, now: now, calendar: calendar), "08:55")
        XCTAssertEqual(ChatFormat.messageTime(1_761_480_000 - 86400, now: now, calendar: calendar), "yesterday")
        XCTAssertEqual(ChatFormat.messageTime(1_761_480_000 - 86400 * 3, now: now, calendar: calendar), "23/10/2025")
    }

    func testElapsedTimeReadsLikeTheWebApp() {
        let t = UInt64(now.timeIntervalSince1970)
        XCTAssertEqual(ChatFormat.elapsed(t - 10, now: now), "now")
        XCTAssertEqual(ChatFormat.elapsed(t - 37 * 60, now: now), "37 minutes ago")
        XCTAssertEqual(ChatFormat.elapsed(t - 3600, now: now), "1 hour ago")
        XCTAssertEqual(ChatFormat.elapsed(t - 90_000, now: now), "yesterday")
        XCTAssertEqual(ChatFormat.elapsed(t - 3 * 86400, now: now), "3 days ago")
    }

    func testAvatarColorsMatchTheWebAppsHash() {
        // Values from the web app's own `initialsColor`, run in node.
        let expected = [
            "Theo Brandt": "#3e63f5", "Priya Nair": "#0f9b8e", "Sam Whitfield": "#db2777", "Ada Mensah": "#2563eb",
            "Lena Kovač": "#2563eb", "bob": "#db2777", "alice": "#e0637a", "😀 Zoë": "#3e63f5",
        ]
        for (name, color) in expected { XCTAssertEqual(ChatFormat.avatarColor(for: name), color, name) }
        XCTAssertEqual(ChatFormat.initials("Theo Brandt Jr"), "TB")
        XCTAssertEqual(ChatFormat.initials("alice"), "A")
    }

    func testIdsAreTreatedAsPlaceholderNames() {
        XCTAssertTrue(ChatFormat.isPlaceholderName("8k7Y3v…Zr3A"))
        XCTAssertTrue(ChatFormat.isPlaceholderName(String(repeating: "ab", count: 32)))
        XCTAssertTrue(ChatFormat.isPlaceholderName("8k7Y3vEeQ2qGv4T1YwW5cB2f9tRkJ1nVxS6dLmPqZr3A"))
        XCTAssertFalse(ChatFormat.isPlaceholderName("Ada Mensah"))
    }

    private func message(_ index: UInt64, sender: String, timestamp: UInt64, deleted: Bool = false) throws -> ChatMessage {
        let json = ChatFixtures.messageJSON(
            index: index, sender: sender, text: "t", timestamp: timestamp - index, deleted: deleted ? "true" : "null")
        return try JSONDecoder().decode(ChatMessage.self, from: Data(json.utf8))
    }

    func testAGroupStartsOnANewSenderAfterADeleteOrAfterAMinute() throws {
        let first = try message(0, sender: "a", timestamp: 1000)
        XCTAssertTrue(ChatFormat.startsGroup(first, after: nil))
        XCTAssertFalse(ChatFormat.startsGroup(try message(1, sender: "a", timestamp: 1059), after: first))
        XCTAssertTrue(ChatFormat.startsGroup(try message(1, sender: "a", timestamp: 1060), after: first))
        XCTAssertTrue(ChatFormat.startsGroup(try message(1, sender: "b", timestamp: 1001), after: first))
        let deleted = try message(0, sender: "a", timestamp: 1000, deleted: true)
        XCTAssertTrue(ChatFormat.startsGroup(try message(1, sender: "a", timestamp: 1001), after: deleted))
    }

    func testComposerPlaceholders() {
        let channel = ChannelEntry(id: "c", groupId: "g", name: "general", kind: .channel, isJoined: true, unread: 0)
        let dm = ChannelEntry(id: "d", groupId: "g", name: "Theo", kind: .dm, isJoined: true, unread: 0)
        XCTAssertEqual(ChatFormat.composerPlaceholder(channel: channel, inThread: false), "Message #general")
        XCTAssertEqual(ChatFormat.composerPlaceholder(channel: dm, inThread: false), "Message Theo")
        XCTAssertEqual(ChatFormat.composerPlaceholder(channel: channel, inThread: true), "Reply in thread")
        XCTAssertEqual(ChatFormat.replies(1), "1 reply")
        XCTAssertEqual(ChatFormat.replies(5), "5 replies")
    }

    func testChannelNamesFollowTheWebAppsRule() {
        XCTAssertNil(ChatFormat.channelNameProblem("launch-plan"))
        XCTAssertEqual(
            ChatFormat.channelNameProblem("ab"), "Channel name is too short. It should be at least 3 characters.")
        XCTAssertEqual(
            ChatFormat.channelNameProblem(String(repeating: "a", count: 20)),
            "Channel name is too long. It should be at most 19 characters.")
        XCTAssertNotNil(ChatFormat.channelNameProblem("has space"))
        XCTAssertEqual(ChatFormat.channelNameProblem("General", existing: ["general"]), "A group with this name already exists")
    }
}
