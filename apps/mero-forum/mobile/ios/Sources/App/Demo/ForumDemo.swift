#if DEBUG
import ForumCore
import ForumGenerated
import Foundation
import MeroKit

/// Mero Forum's demo: a few spaces and forums, people, posts, replies and
/// votes, and a contract that answers `list_posts`, `get_post`,
/// `list_comments`, ... from them in the generated client's wire shape.
/// Writes change the fixtures, so the tour can post, reply and vote.
enum ForumDemo {
    static let meName = "Maya Chen"
    static let me = DemoIds.hex("person:\(meName)")
    static let applicationId = DemoIds.hex("app:mero-forum")

    static func makeBackend() -> DemoBackend {
        // The name this device posts under (FeedModel reads it at init).
        DefaultsNameStore().name = meName

        let store = Store(now: Date())
        let builders = DemoIds.hex("space:builders")
        let climbing = DemoIds.hex("space:climbing")
        let books = DemoIds.hex("space:books")
        func forum(_ name: String) -> AppSubgroup {
            AppSubgroup(groupId: DemoIds.hex("forum:\(name)"), name: name, contextIds: [context(name)])
        }
        return DemoBackend(
            account: me, applicationId: applicationId,
            namespaces: [
                AppNamespace(id: builders, name: "Calimero Builders", applicationId: applicationId, memberCount: 128),
                AppNamespace(id: climbing, name: "Lisbon Climbing Club", applicationId: applicationId, memberCount: 34),
                AppNamespace(id: books, name: "Riverside Book Circle", applicationId: applicationId, memberCount: 12),
            ],
            subgroups: [
                builders: ["General", "Announcements", "Help desk", "Show and tell"].map(forum),
                climbing: ["Trip planning", "Gear swap"].map(forum),
                books: ["This month's book"].map(forum),
            ],
            members: Set(["General", "Announcements", "Help desk", "Trip planning", "Gear swap", "This month's book"].map(context)),
            handler: { try store.handle($0) })
    }

    static func context(_ forum: String) -> String { DemoIds.hex("context:\(forum)") }
    static func person(_ name: String) -> String { DemoIds.hex("person:\(name)") }

    // MARK: State

    struct Post {
        var id: String
        var author: String
        var title: String
        var body: String
        var createdAt: UInt64
        var editedAt: UInt64
        var others: Int64
        var myVote: Int32
    }

    struct Reply {
        var id: String
        var postId: String
        var author: String
        var body: String
        var createdAt: UInt64
        var editedAt: UInt64
        var others: Int64
        var myVote: Int32
    }

    struct Forum {
        var posts: [Post] = []
        var replies: [Reply] = []
        var moderators: [String] = []
    }

    final class Store: @unchecked Sendable {
        private let lock = NSLock()
        private var forums: [String: Forum] = [:]
        private var names: [String: String] = [:]
        private var next = 0

        init(now: Date) {
            for name in People.all { names[ForumDemo.person(name)] = name }
            for (forum, seed) in Seed.forums(now: now) { forums[ForumDemo.context(forum)] = seed }
        }

        func handle(_ call: DemoCall) throws -> Data {
            lock.lock()
            defer { lock.unlock() }
            var forum = forums[call.contextId] ?? Forum(moderators: [ForumDemo.me])
            defer { forums[call.contextId] = forum }
            let me = ForumDemo.me
            let now = DemoIds.stamp(ago: 0)

            switch call.method {
            case "list_posts":
                var live = forum.posts
                if call.string("sort") == "top" {
                    live.sort { ($0.others + Int64($0.myVote), $0.createdAt) > ($1.others + Int64($1.myVote), $1.createdAt) }
                } else {
                    live.sort { $0.createdAt > $1.createdAt }
                }
                return try DemoReply.json(PostPage(items: live.map { view($0, in: forum) }, nextCursor: nil))
            case "get_post":
                guard let post = forum.posts.first(where: { $0.id == call.string("post_id") }) else {
                    throw DemoContractError("no such post")
                }
                return try DemoReply.json(view(post, in: forum))
            case "list_comments":
                let items = forum.replies.filter { $0.postId == call.string("post_id") }.sorted { $0.createdAt < $1.createdAt }
                return try DemoReply.json(CommentPage(items: items.map(view), nextCursor: nil))
            case "create_post":
                let id = mint("post")
                forum.posts.append(
                    Post(id: id, author: me, title: call.string("title") ?? "", body: call.string("body") ?? "",
                         createdAt: now, editedAt: now, others: 0, myVote: 0))
                return try DemoReply.json(id)
            case "create_comment":
                let id = mint("reply")
                forum.replies.append(
                    Reply(id: id, postId: call.string("post_id") ?? "", author: me, body: call.string("body") ?? "",
                          createdAt: now, editedAt: now, others: 0, myVote: 0))
                return try DemoReply.json(id)
            case "edit_post":
                if let i = forum.posts.firstIndex(where: { $0.id == call.string("post_id") }) {
                    forum.posts[i].title = call.string("title") ?? forum.posts[i].title
                    forum.posts[i].body = call.string("body") ?? forum.posts[i].body
                    forum.posts[i].editedAt = now
                }
            case "edit_comment":
                if let i = forum.replies.firstIndex(where: { $0.id == call.string("comment_id") }) {
                    forum.replies[i].body = call.string("body") ?? forum.replies[i].body
                    forum.replies[i].editedAt = now
                }
            case "delete_post", "moderate_post":
                let id = call.string("post_id")
                forum.posts.removeAll { $0.id == id }
                forum.replies.removeAll { $0.postId == id }
            case "delete_comment", "moderate_comment":
                forum.replies.removeAll { $0.id == call.string("comment_id") }
            case "vote":
                if let i = forum.posts.firstIndex(where: { $0.id == call.string("post_id") }) {
                    forum.posts[i].myVote = Int32(call.int("value") ?? 0)
                }
            case "vote_comment":
                if let i = forum.replies.firstIndex(where: { $0.id == call.string("comment_id") }) {
                    forum.replies[i].myVote = Int32(call.int("value") ?? 0)
                }
            case "get_nickname":
                return try DemoReply.json(names[call.string("account") ?? ""] ?? "")
            case "set_nickname":
                names[me] = call.string("name") ?? ""
            case "moderators":
                return try DemoReply.json(forum.moderators)
            case "set_moderators":
                forum.moderators = call.strings("accounts") ?? forum.moderators
            default:
                break
            }
            return DemoReply.null
        }

        private func view(_ post: Post, in forum: Forum) -> PostView {
            PostView(
                id: post.id, author: post.author, authorName: names[post.author] ?? "", title: post.title, body: post.body,
                createdAt: post.createdAt, editedAt: post.editedAt, score: post.others + Int64(post.myVote),
                commentCount: UInt64(forum.replies.filter { $0.postId == post.id }.count), myVote: post.myVote)
        }

        private func view(_ reply: Reply) -> CommentView {
            CommentView(
                id: reply.id, postId: reply.postId, author: reply.author, authorName: names[reply.author] ?? "",
                body: reply.body, createdAt: reply.createdAt, editedAt: reply.editedAt,
                score: reply.others + Int64(reply.myVote), myVote: reply.myVote)
        }

        private func mint(_ kind: String) -> String {
            next += 1
            return DemoIds.hex("\(kind):new:\(next)")
        }
    }
}

// MARK: Fixtures

private enum People {
    static let all = [
        ForumDemo.meName, "Jonas Weber", "Priya Raman", "Tomás Alvarez", "Aiko Tanaka", "Sam Okafor", "Lena Fischer",
        "Diego Morales", "Hannah Brooks", "Ravi Patel", "Noor Haddad", "Elif Kaya", "Marco Bianchi",
    ]
}

private enum Seed {
    private static let minute: TimeInterval = 60
    private static let hour: TimeInterval = 3600
    private static let day: TimeInterval = 86400

    /// (author, ago, title, body, others' score, my vote, [(author, ago, body, score)])
    typealias Thread = (String, TimeInterval, String, String, Int64, Int32, [(String, TimeInterval, String, Int64)])

    static func forums(now: Date) -> [String: ForumDemo.Forum] {
        [
            "General": forum(now: now, mods: ["Jonas Weber", ForumDemo.meName], general),
            "Announcements": forum(now: now, mods: ["Jonas Weber"], announcements),
            "Help desk": forum(now: now, mods: ["Jonas Weber", ForumDemo.meName], helpDesk),
            "Show and tell": forum(now: now, mods: ["Aiko Tanaka"], showAndTell),
            "Trip planning": forum(now: now, mods: ["Diego Morales"], trips),
            "Gear swap": forum(now: now, mods: ["Diego Morales"], gear),
            "This month's book": forum(now: now, mods: ["Hannah Brooks"], book),
        ]
    }

    private static func forum(now: Date, mods: [String], _ threads: [Thread]) -> ForumDemo.Forum {
        var out = ForumDemo.Forum(moderators: mods.map(ForumDemo.person))
        for (index, thread) in threads.enumerated() {
            let (author, ago, title, body, score, myVote, replies) = thread
            let postId = DemoIds.hex("post:\(title)")
            let stamp = DemoIds.stamp(ago: ago, from: now)
            out.posts.append(
                ForumDemo.Post(
                    id: postId, author: ForumDemo.person(author), title: title, body: body, createdAt: stamp,
                    editedAt: stamp, others: score, myVote: myVote))
            for (offset, reply) in replies.enumerated() {
                let (who, replyAgo, text, replyScore) = reply
                let replyStamp = DemoIds.stamp(ago: replyAgo, from: now)
                out.replies.append(
                    ForumDemo.Reply(
                        id: DemoIds.hex("reply:\(index):\(offset):\(title)"), postId: postId, author: ForumDemo.person(who),
                        body: text, createdAt: replyStamp, editedAt: replyStamp, others: replyScore, myVote: 0))
            }
        }
        return out
    }

    static let general: [Thread] = [
        ("Priya Raman", 14 * minute, "What's your setup for testing sync conflicts?",
         "I keep two simulators side by side and toggle airplane mode on one. It works, but it's slow. Has anyone scripted this? Curious how others reproduce the ugly edge cases.",
         41, 0, [
            ("Ravi Patel", 12 * minute, "I script it with simctl: take one device offline, write on both, bring it back and diff the state. Happy to share the script.", 9),
            ("Hannah Brooks", 10 * minute, "Two simulators plus an old phone that never leaves my desk. Low-tech, but it catches the weird ones.", 4),
            ("Jonas Weber", 8 * minute, "Replaying the same sequence of writes on each side helps a lot. Most bugs show up the second time, not the first.", 7),
            ("Aiko Tanaka", 5 * minute, "+1 to replaying. Nearly all of my bugs were about ordering, not real conflicts.", 3),
            ("Sam Okafor", 3 * minute, "Would love a shared repo of nasty sequences. I'll add the one that broke my notes app twice.", 2),
         ]),
        ("Sam Okafor", 1 * hour + 20 * minute, "Offline-first notes app is on TestFlight",
         "Six weeks of evenings and it finally syncs between my phone and laptop with nothing in the middle. Looking for ten people to break it this weekend. Reply and I'll send an invite.",
         23, 1, [
            ("Lena Fischer", 1 * hour, "I'm in. Mostly offline on the train every morning, so a good stress test.", 3),
            ("Marco Bianchi", 50 * minute, "Count me in too. iPad and an Android phone, if that helps.", 2),
            ("Elif Kaya", 35 * minute, "Congrats on shipping! Happy to test.", 1),
         ]),
        ("Jonas Weber", 3 * hour, "Community call moves to Thursday",
         "Same time, 17:00 CET. We'll demo the new invitation links and go through questions from this forum. The agenda is open, so add topics below.",
         18, 0, [
            ("Noor Haddad", 2 * hour + 40 * minute, "Could we cover moderation? Curious how others run theirs.", 5),
            ("Priya Raman", 2 * hour, "Topic idea: how people back up their spaces.", 3),
         ]),
        ("Aiko Tanaka", 5 * hour, "Small win: a shared grocery list for our flat",
         "Four people, four phones, zero accounts to create. My flatmates don't know what a node is and they don't need to. That's the bar I want everything to clear.",
         57, 1, [
            ("Diego Morales", 4 * hour, "This is the best kind of demo. Nobody cares how it works, it just does.", 8),
            ("Lena Fischer", 3 * hour + 30 * minute, "Stealing this idea for our climbing club's kit list.", 4),
         ]),
        ("Tomás Alvarez", 9 * hour, "Reading list: CRDTs without the maths",
         "Collected the posts and talks that finally made it click for me. Start with the local-first essay, then the Automerge docs, then the Yjs internals talk. Additions welcome.",
         33, 0, [
            ("Ravi Patel", 8 * hour, "Adding the 'Designing Data-Intensive Applications' chapter on replication. Dense, but worth it.", 6),
         ]),
        ("Lena Fischer", 1 * day + 2 * hour, "How do you explain 'no server' to non-technical people?",
         "My usual line is \"your posts live on your phone and your friends' phones, like a group chat\". It mostly lands. What do you say?",
         26, 0, [
            ("Hannah Brooks", 1 * day, "I say it works like passing notes in class: everyone keeps a copy.", 5),
            ("Jonas Weber", 22 * hour, "\"Like AirDrop, but it keeps up by itself.\" Not perfect, but people get it.", 4),
            ("Noor Haddad", 20 * hour, "I don't explain it at all until someone asks. Then the group chat line.", 6),
         ]),
        ("Diego Morales", 1 * day + 7 * hour, "Photo backup between two old phones",
         "Turned my partner's retired phone into a backup for the family photos. It sits in a drawer on Wi-Fi and catches up whenever we're home.",
         12, 0, []),
        ("Hannah Brooks", 2 * day, "Accessibility pass on the forum app",
         "Went through every screen with VoiceOver. Mostly great: the vote buttons read clearly and the reply box announces who you're replying as. Notes in the thread.",
         19, 0, [
            ("Maya Chen", 1 * day + 20 * hour, "Thank you, this is really useful. I'll pick up the notes this week.", 3),
         ]),
        ("Noor Haddad", 4 * day, "Introduce yourself",
         "New here? Say hi and tell us what you're building or what brought you in. I'll start: I run a small bakery and I'm moving our order book off a shared spreadsheet.",
         64, 1, [
            ("Elif Kaya", 3 * day, "Hi all! Product designer in Istanbul, here to learn how local-first apps feel to build.", 9),
            ("Marco Bianchi", 3 * day, "Ciao! Building a tiny app for our football team's schedules.", 7),
            ("Ravi Patel", 2 * day, "Backend engineer, mostly here for the sync talk.", 4),
         ]),
        (ForumDemo.meName, 5 * day, "Notes from the Lisbon meetup",
         "Thirty people, two demos and a lot of pastéis de nata. Main takeaway: people want invitation links that just work from a chat message. Slides are in Announcements.",
         22, 0, [
            ("Tomás Alvarez", 5 * day - 2 * hour, "Great evening. Thanks for organising!", 4),
         ]),
    ]

    static let announcements: [Thread] = [
        ("Jonas Weber", 2 * day, "Invitation links are live",
         "You can now invite people to a space or straight into one forum with a single link. Share it in any chat app.", 48, 1, []),
        (ForumDemo.meName, 5 * day, "Slides from the Lisbon meetup",
         "Both talks are up, with speaker notes. Thanks again to everyone who came.", 21, 0, []),
    ]

    static let helpDesk: [Thread] = [
        ("Marco Bianchi", 2 * hour, "Forum shows 'Syncing…' for a while after joining",
         "Is that expected? It sorted itself out after a minute.", 4, 0, [
            ("Jonas Weber", 1 * hour, "Yes, the forum appears once its first update reaches your device. A minute is normal on mobile data.", 3),
         ]),
    ]

    static let showAndTell: [Thread] = [
        ("Aiko Tanaka", 6 * hour, "Kitchen timer that syncs across the flat",
         "Silly, but I love it. Start a timer on one phone and it rings on all of them.", 15, 0, []),
    ]

    static let trips: [Thread] = [
        ("Diego Morales", 3 * hour, "Sintra on Saturday?",
         "Leaving 8:00 from Sete Rios. Two cars, room for six. Reply if you're coming.", 9, 0, []),
    ]

    static let gear: [Thread] = [
        ("Lena Fischer", 1 * day, "Selling: 60m rope, used twice", "Size 9.5, dry treated. Selling because I bought the wrong length.", 3, 0, []),
    ]

    static let book: [Thread] = [
        ("Hannah Brooks", 2 * day, "October: Piranesi",
         "We meet on the 30th at the café by the bridge. No spoilers past chapter ten in this thread, please.", 11, 0, []),
    ]
}
#endif
