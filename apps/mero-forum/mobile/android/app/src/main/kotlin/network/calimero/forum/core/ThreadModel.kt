package network.calimero.forum.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.forum.generated.CommentView
import network.calimero.forum.generated.ForumClient
import network.calimero.forum.generated.PostView

/** One post and its replies: read, reply, vote, edit, delete, moderate. (Swift `ThreadModel`.) */
@Suppress("TooManyFunctions")
class ThreadModel(
    val backend: MeroAppBackend,
    val forum: ForumRef,
    val postId: String,
    seed: PostView? = null,
) {
    val client: ForumClient = forumClient(backend.contract, forum.contextId)
    val account: String = backend.account

    private val _post = MutableStateFlow(seed)
    val post: StateFlow<PostView?> = _post.asStateFlow()
    private val _comments = MutableStateFlow<List<CommentView>>(emptyList())
    val comments: StateFlow<List<CommentView>> = _comments.asStateFlow()
    private val _phase = MutableStateFlow(if (seed != null) LoadPhase.Loaded else LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()
    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()
    private val _isSending = MutableStateFlow(false)
    val isSending: StateFlow<Boolean> = _isSending.asStateFlow()

    /** The post is gone (deleted or removed): the screen should close. */
    private val _isGone = MutableStateFlow(false)
    val isGone: StateFlow<Boolean> = _isGone.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private var cursor: String? = null

    fun isMine(author: String): Boolean = author.equals(account, ignoreCase = true)

    // ---- reading -------------------------------------------------------------------------

    /** The post and the first page of replies, again. */
    suspend fun load() {
        if (_post.value == null) _phase.value = LoadPhase.Loading
        attempt {
            coroutineScope {
                val post = async { client.getPost(postId) }
                val page = async { client.listComments(postId, null, ForumConstants.PAGE_SIZE) }
                post.await() to page.await()
            }
        }.onSuccess { (post, page) ->
            _post.value = post
            _comments.value = page.items
            cursor = page.nextCursor
            _hasMore.value = page.nextCursor != null
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            val text = ForumErrorText.describe(it)
            if (text.contains("no such post", ignoreCase = true) || text.contains("not found", ignoreCase = true)) _isGone.value = true
            if (_post.value == null) _phase.value = LoadPhase.Failed(text) else _notice.value = text
        }
    }

    /** The next page of replies, oldest first. */
    suspend fun loadMore() {
        val next = cursor
        if (!_hasMore.value || _isLoadingMore.value || next == null) return
        _isLoadingMore.value = true
        try {
            attempt { client.listComments(postId, next, ForumConstants.PAGE_SIZE) }
                .onSuccess { page ->
                    val seen = _comments.value.map { it.id }.toSet()
                    _comments.value = _comments.value + page.items.filter { it.id !in seen }
                    cursor = page.nextCursor
                    _hasMore.value = page.nextCursor != null
                }.onFailure { _notice.value = ForumErrorText.describe(it) }
        } finally {
            _isLoadingMore.value = false
        }
    }

    /** Re-read on every change in the forum (or every poll), until cancelled. */
    suspend fun watch() {
        if (backend.canSubscribe) {
            attempt { backend.events(forum.contextId).collect { load() } }
        }
        while (true) {
            delay(ForumConstants.POLL_INTERVAL_MS)
            load()
        }
    }

    // ---- the post ------------------------------------------------------------------------

    suspend fun votePost(value: Int) {
        val before = _post.value ?: return
        _post.value = before.copy(score = before.score - before.myVote + value, myVote = value)
        attempt { client.vote(postId, value) }.onFailure {
            _post.value = before
            _notice.value = ForumErrorText.describe(it)
        }
    }

    suspend fun editPost(
        title: String,
        body: String,
    ) {
        val t = title.trim()
        val b = body.trim()
        if (t.isEmpty() || b.isEmpty()) throw ForumModelException("Add a title and some text.")
        worded { client.editPost(postId, t, b) }
        _post.value = _post.value?.copy(title = t, body = b)
    }

    /** Delete your own post. True once it is gone. */
    suspend fun deletePost(): Boolean = removePost { client.deletePost(postId) }

    /** Remove the post as a moderator. True once it is gone. */
    suspend fun moderatePost(): Boolean = removePost { client.moderatePost(postId) }

    private suspend fun removePost(call: suspend () -> Unit): Boolean =
        attempt { call() }.fold(
            onSuccess = {
                _isGone.value = true
                true
            },
            onFailure = {
                _notice.value = ForumErrorText.describe(it)
                false
            },
        )

    // ---- replies -------------------------------------------------------------------------

    /** Reply to the post. */
    suspend fun reply(text: String) {
        val body = text.trim()
        if (body.isEmpty()) return
        _isSending.value = true
        try {
            worded { client.createComment(postId, body) }
        } finally {
            _isSending.value = false
        }
        _post.value = _post.value?.let { it.copy(commentCount = it.commentCount + 1u) }
        load()
        // A thread reads forwards: a long one keeps the new reply past page one.
        while (_hasMore.value) {
            val before = _comments.value.size
            loadMore()
            if (_comments.value.size == before) break
        }
    }

    suspend fun voteComment(
        comment: CommentView,
        value: Int,
    ) {
        val before = _comments.value
        replace(comment.id) { it.copy(score = it.score - it.myVote + value, myVote = value) }
        attempt { client.voteComment(comment.id, value) }.onFailure {
            _comments.value = before
            _notice.value = ForumErrorText.describe(it)
        }
    }

    suspend fun editComment(
        comment: CommentView,
        body: String,
    ) {
        val b = body.trim()
        if (b.isEmpty()) throw ForumModelException("A reply needs some text.")
        worded { client.editComment(comment.id, b) }
        replace(comment.id) { it.copy(body = b) }
    }

    suspend fun deleteComment(comment: CommentView) = removeComment(comment) { client.deleteComment(comment.id) }

    suspend fun moderateComment(comment: CommentView) = removeComment(comment) { client.moderateComment(comment.id) }

    private suspend fun removeComment(
        comment: CommentView,
        call: suspend () -> Unit,
    ) {
        val before = _comments.value to _post.value
        _comments.value = before.first.filter { it.id != comment.id }
        _post.value = before.second?.let { if (it.commentCount > 0u) it.copy(commentCount = it.commentCount - 1u) else it }
        attempt { call() }.onFailure {
            _comments.value = before.first
            _post.value = before.second
            _notice.value = ForumErrorText.describe(it)
        }
    }

    fun dismissNotice() {
        _notice.value = null
    }

    private fun replace(
        id: String,
        change: (CommentView) -> CommentView,
    ) {
        _comments.value = _comments.value.map { if (it.id == id) change(it) else it }
    }
}
