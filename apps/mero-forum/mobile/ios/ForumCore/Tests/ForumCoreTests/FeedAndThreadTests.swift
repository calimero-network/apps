import ForumGenerated
import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import ForumCore

@MainActor
final class FeedModelTests: XCTestCase {
    private func feed(_ backend: InMemoryAppBackend, name: String = "") -> FeedModel {
        FeedModel(backend: backend, forum: forumRef(), names: MemoryNameStore(name))
    }

    func testPagesTheFeedByCursor() async {
        let (backend, script) = makeBackend()
        script.on("list_posts") { call in
            call.string("cursor") == nil
                ? PostPage(items: [post("p1"), post("p2")], nextCursor: "p2")
                : PostPage(items: [post("p2"), post("p3")], nextCursor: nil)
        }
        let model = feed(backend)
        await model.refresh()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.posts.map(\.id), ["p1", "p2"])
        XCTAssertTrue(model.hasMore)
        await model.loadMore()
        XCTAssertEqual(model.posts.map(\.id), ["p1", "p2", "p3"])
        XCTAssertFalse(model.hasMore)
        let calls = backend.recording.calls("list_posts")
        XCTAssertEqual(calls.map { $0.path }, [.query, .query])
        XCTAssertEqual(calls.first?.string("sort"), "new")
        XCTAssertEqual(calls.first?.contextId, ctx)
        XCTAssertEqual(calls.last?.string("cursor"), "p2")
    }

    func testSortRestartsTheFeed() async {
        let (backend, script) = makeBackend()
        script.on("list_posts") { call in PostPage(items: [post(call.string("sort") ?? "?")], nextCursor: nil) }
        let model = feed(backend)
        await model.refresh()
        await model.setSort(.top)
        XCTAssertEqual(model.posts.map(\.id), ["top"])
    }

    func testVoteShowsAtOnceAndUndoesOnFailure() async {
        let (backend, script) = makeBackend()
        script.on("list_posts") { _ in PostPage(items: [post("p1", score: 3, myVote: 0)], nextCursor: nil) }
        let model = feed(backend)
        await model.refresh()
        await model.vote(model.posts[0], value: 1)
        XCTAssertEqual(model.posts[0].score, 4)
        XCTAssertEqual(model.posts[0].myVote, 1)
        XCTAssertEqual(backend.recording.calls("vote").first?.path, .execute)
        XCTAssertEqual(backend.recording.calls("vote").first?.args["value"]?.intValue, 1)

        script.fail("vote")
        await model.vote(model.posts[0], value: -1)
        XCTAssertEqual(model.posts[0].score, 4)
        XCTAssertEqual(model.posts[0].myVote, 1)
        XCTAssertNotNil(model.notice)
    }

    func testCreatePostNeedsTitleAndTextThenRefreshes() async throws {
        let (backend, script) = makeBackend()
        script.on("create_post") { _ in "p9" }
        script.on("list_posts") { _ in PostPage(items: [post("p9", author: me)], nextCursor: nil) }
        let model = feed(backend)
        do {
            try await model.createPost(title: "Hi", body: " ")
            XCTFail("expected a refusal")
        } catch {}
        try await model.createPost(title: " Hello ", body: "World")
        let call = try XCTUnwrap(backend.recording.calls("create_post").first)
        XCTAssertEqual(call.string("title"), "Hello")
        XCTAssertEqual(call.string("body"), "World")
        XCTAssertEqual(model.posts.map(\.id), ["p9"])
        XCTAssertTrue(model.isMine(model.posts[0]))
    }

    func testDeleteAndModerate() async {
        let (backend, script) = makeBackend()
        script.on("list_posts") { _ in PostPage(items: [post("p1", author: me), post("p2")], nextCursor: nil) }
        script.on("moderators") { _ in [me] }
        let model = feed(backend)
        await model.refresh()
        await model.loadModerators()
        XCTAssertTrue(model.isModerator)
        await model.delete(model.posts[0])
        XCTAssertEqual(backend.recording.calls("delete_post").first?.string("post_id"), "p1")
        await model.moderate(model.posts[0])
        XCTAssertEqual(backend.recording.calls("moderate_post").first?.string("post_id"), "p2")
        XCTAssertTrue(model.posts.isEmpty)
    }

    func testAFailedDeletePutsThePostBack() async {
        let (backend, script) = makeBackend()
        script.on("list_posts") { _ in PostPage(items: [post("p1", author: me)], nextCursor: nil) }
        script.fail("delete_post")
        let model = feed(backend)
        await model.refresh()
        await model.delete(model.posts[0])
        XCTAssertEqual(model.posts.map(\.id), ["p1"])
        XCTAssertNotNil(model.notice)
    }

    func testModeratorListChanges() async throws {
        let (backend, script) = makeBackend()
        script.on("moderators") { _ in [me] }
        let model = feed(backend)
        await model.loadModerators()
        try await model.addModerator(bob.uppercased())
        XCTAssertEqual(model.moderators, [me, bob])
        XCTAssertEqual(backend.recording.calls("set_moderators").last?.args["accounts"], [.string(me), .string(bob)])
        do {
            try await model.addModerator("nope")
            XCTFail("expected a refusal")
        } catch {}
        try await model.removeModerator(me)
        XCTAssertEqual(model.moderators, [bob])
        do {
            try await model.removeModerator(bob)
            XCTFail("a forum keeps one moderator")
        } catch {
            XCTAssertEqual(error as? ForumModelError, .message("A forum needs at least one moderator."))
        }
    }

    func testNamePushedToTheForumOrAdopted() async throws {
        let (backend, script) = makeBackend()
        script.on("get_nickname") { _ in "" }
        let named = feed(backend, name: "Ana")
        await named.syncName()
        XCTAssertEqual(backend.recording.calls("set_nickname").first?.string("name"), "Ana")

        let (other, otherScript) = makeBackend()
        otherScript.on("get_nickname") { _ in "Remote" }
        let store = MemoryNameStore()
        let adopting = FeedModel(backend: other, forum: forumRef(), names: store)
        await adopting.syncName()
        XCTAssertEqual(store.name, "Remote")
        XCTAssertEqual(adopting.displayName, "Remote")
        XCTAssertTrue(other.recording.calls("set_nickname").isEmpty)
    }

    func testRenameUpdatesYourPosts() async throws {
        let (backend, script) = makeBackend()
        script.on("list_posts") { _ in PostPage(items: [post("p1", author: me, name: "Old")], nextCursor: nil) }
        let store = MemoryNameStore("Old")
        let model = FeedModel(backend: backend, forum: forumRef(), names: store)
        await model.refresh()
        try await model.rename(" New ")
        XCTAssertEqual(store.name, "New")
        XCTAssertEqual(model.posts[0].authorName, "New")
    }

    func testLiveEventsRefreshTheFeed() async throws {
        let (backend, script) = makeBackend()
        script.on("list_posts") { _ in PostPage(items: [post("p1")], nextCursor: nil) }
        let model = feed(backend)
        let watching = Task { await model.watch() }
        defer { watching.cancel() }
        // Emit until the stream is up and the refresh it triggers has landed.
        for _ in 0..<100 where model.posts.isEmpty {
            backend.emit(AppContextEvent(contextId: ctx, kind: "StateMutation"))
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(model.posts.map(\.id), ["p1"])
    }
}

@MainActor
final class ThreadModelTests: XCTestCase {
    private func thread(_ backend: InMemoryAppBackend) -> ThreadModel {
        ThreadModel(backend: backend, forum: forumRef(), postId: "p1")
    }

    func testLoadsThePostAndItsReplies() async {
        let (backend, script) = makeBackend()
        script.on("get_post") { _ in post("p1", comments: 2) }
        script.on("list_comments") { call in
            call.string("cursor") == nil
                ? CommentPage(items: [comment("c1")], nextCursor: "c1")
                : CommentPage(items: [comment("c2")], nextCursor: nil)
        }
        let model = thread(backend)
        await model.load()
        XCTAssertEqual(model.post?.id, "p1")
        XCTAssertEqual(model.comments.map(\.id), ["c1"])
        await model.loadMore()
        XCTAssertEqual(model.comments.map(\.id), ["c1", "c2"])
        XCTAssertEqual(backend.recording.calls("list_comments").first?.string("post_id"), "p1")
    }

    func testReplyPostsAndReloads() async throws {
        let (backend, script) = makeBackend()
        script.on("get_post") { _ in post("p1", comments: 1) }
        script.on("create_comment") { _ in "c9" }
        script.on("list_comments") { _ in CommentPage(items: [comment("c9", author: me)], nextCursor: nil) }
        let model = thread(backend)
        try await model.reply("  thanks  ")
        XCTAssertEqual(backend.recording.calls("create_comment").first?.string("body"), "thanks")
        XCTAssertEqual(model.comments.map(\.id), ["c9"])
        XCTAssertTrue(model.isMine(author: model.comments[0].author))
    }

    func testCommentVotesEditsAndRemovals() async throws {
        let (backend, script) = makeBackend()
        script.on("get_post") { _ in post("p1", comments: 2) }
        script.on("list_comments") { _ in CommentPage(items: [comment("c1", author: me), comment("c2")], nextCursor: nil) }
        let model = thread(backend)
        await model.load()
        await model.voteComment(model.comments[1], value: -1)
        XCTAssertEqual(model.comments[1].score, -1)
        try await model.editComment(model.comments[0], body: "edited")
        XCTAssertEqual(model.comments[0].body, "edited")
        XCTAssertEqual(backend.recording.calls("edit_comment").first?.string("comment_id"), "c1")
        await model.deleteComment(model.comments[0])
        await model.moderateComment(model.comments[0])
        XCTAssertTrue(model.comments.isEmpty)
        XCTAssertEqual(model.post?.commentCount, 0)
        XCTAssertEqual(backend.recording.calls("moderate_comment").first?.string("comment_id"), "c2")
    }

    func testRemovingThePostClosesTheThread() async {
        let (backend, script) = makeBackend()
        script.on("get_post") { _ in post("p1") }
        script.on("list_comments") { _ in CommentPage(items: [], nextCursor: nil) }
        let model = thread(backend)
        await model.load()
        let removed = await model.moderatePost()
        XCTAssertTrue(removed)
        XCTAssertTrue(model.isGone)
    }

    func testPostVoteRollsBack() async {
        let (backend, script) = makeBackend()
        script.on("get_post") { _ in post("p1", score: 1) }
        script.on("list_comments") { _ in CommentPage(items: [], nextCursor: nil) }
        script.fail("vote")
        let model = thread(backend)
        await model.load()
        await model.votePost(1)
        XCTAssertEqual(model.post?.score, 1)
        XCTAssertEqual(model.post?.myVote, 0)
    }
}
