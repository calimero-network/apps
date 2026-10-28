package network.calimero.forum.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import network.calimero.forum.generated.ForumClient
import network.calimero.forum.generated.PostView

/**
 * One forum's timeline, and everything done to it: post, vote, edit, delete, moderate, the
 * moderator list and the name you post under. (Swift `FeedModel`.)
 */
@Suppress("TooManyFunctions")
class FeedModel(
    val backend: MeroAppBackend,
    val forum: ForumRef,
    private val names: NameStore,
) {
    val client: ForumClient = forumClient(backend.contract, forum.contextId)
    val account: String = backend.account

    private val _posts = MutableStateFlow<List<PostView>>(emptyList())
    val posts: StateFlow<List<PostView>> = _posts.asStateFlow()
    private val _sort = MutableStateFlow(FeedSort.NEW)
    val sort: StateFlow<FeedSort> = _sort.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _hasMore = MutableStateFlow(true)
    val hasMore: StateFlow<Boolean> = _hasMore.asStateFlow()
    private val _isLoadingMore = MutableStateFlow(false)
    val isLoadingMore: StateFlow<Boolean> = _isLoadingMore.asStateFlow()
    private val _moderators = MutableStateFlow<List<String>>(emptyList())
    val moderators: StateFlow<List<String>> = _moderators.asStateFlow()
    private val _displayName = MutableStateFlow(names.name)
    val displayName: StateFlow<String> = _displayName.asStateFlow()

    /** A failed action, for a banner. */
    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private var cursor: String? = null
    private var generation = 0

    /** The caller is one of this forum's moderators. */
    val isModerator: Boolean get() = _moderators.value.any { it.equals(account, ignoreCase = true) }

    fun isMine(post: PostView): Boolean = post.author.equals(account, ignoreCase = true)

    // ---- reading -------------------------------------------------------------------------

    /** The first page again, replacing what is shown. */
    suspend fun refresh() {
        val mine = ++generation
        if (_posts.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt { client.listPosts(_sort.value.wire, null, ForumConstants.PAGE_SIZE) }
            .onSuccess { page ->
                if (mine != generation) return
                _posts.value = page.items
                cursor = page.nextCursor
                _hasMore.value = page.nextCursor != null
                _phase.value = LoadPhase.Loaded
            }.onFailure {
                if (mine != generation) return
                if (_posts.value.isEmpty()) _phase.value = LoadPhase.Failed(ForumErrorText.describe(it)) else _notice.value = ForumErrorText.describe(it)
            }
    }

    /** The next page, appended (keyset paging: a new post above cannot shift it). */
    suspend fun loadMore() {
        val next = cursor
        if (!_hasMore.value || _isLoadingMore.value || _phase.value != LoadPhase.Loaded || next == null) return
        _isLoadingMore.value = true
        val mine = generation
        try {
            attempt { client.listPosts(_sort.value.wire, next, ForumConstants.PAGE_SIZE) }
                .onSuccess { page ->
                    if (mine != generation) return
                    val seen = _posts.value.map { it.id }.toSet()
                    _posts.value = _posts.value + page.items.filter { it.id !in seen }
                    cursor = page.nextCursor
                    _hasMore.value = page.nextCursor != null
                }.onFailure { _notice.value = ForumErrorText.describe(it) }
        } finally {
            _isLoadingMore.value = false
        }
    }

    /** Switch between Latest and Top: a cursor from one order means nothing in the other. */
    suspend fun setSort(next: FeedSort) {
        if (next == _sort.value) return
        _sort.value = next
        _posts.value = emptyList()
        cursor = null
        _hasMore.value = true
        refresh()
    }

    /** Everything a forum screen needs on open: the feed, the moderators, and your name pushed here. */
    suspend fun start() =
        coroutineScope {
            launch { refresh() }
            launch { loadModerators() }
            launch { syncName() }
        }

    suspend fun loadModerators() {
        attempt { client.moderators() }.onSuccess { _moderators.value = it }
    }

    /** Re-read whenever the forum changes: live events, or a poll when the relay cannot stream. */
    suspend fun watch() {
        if (backend.canSubscribe) {
            attempt { backend.events(forum.contextId).collect { refresh() } }
        }
        while (true) {
            delay(ForumConstants.POLL_INTERVAL_MS)
            refresh()
        }
    }

    // ---- writing -------------------------------------------------------------------------

    /** Start a discussion. Both a title and some text, as on the web. */
    suspend fun createPost(
        title: String,
        body: String,
    ) {
        val t = title.trim()
        val b = body.trim()
        if (t.isEmpty() || b.isEmpty()) throw ForumModelException("Add a title and some text.")
        worded { client.createPost(t, b) }
        _sort.value = FeedSort.NEW
        refresh()
    }

    suspend fun editPost(
        post: PostView,
        title: String,
        body: String,
    ) {
        val t = title.trim()
        val b = body.trim()
        if (t.isEmpty() || b.isEmpty()) throw ForumModelException("Add a title and some text.")
        worded { client.editPost(post.id, t, b) }
        replace(post.id) { it.copy(title = t, body = b) }
    }

    /** Up, down, or take it back (`value` 1, -1, 0). Shown at once, undone if it fails. */
    suspend fun vote(
        post: PostView,
        value: Int,
    ) {
        val before = _posts.value
        replace(post.id) { it.copy(score = it.score - it.myVote + value, myVote = value) }
        attempt { client.vote(post.id, value) }.onFailure {
            _posts.value = before
            _notice.value = ForumErrorText.describe(it)
        }
    }

    /** Delete your own post (its comments go with it). */
    suspend fun delete(post: PostView) = remove(post) { client.deletePost(post.id) }

    /** Remove someone's post as a moderator. */
    suspend fun moderate(post: PostView) = remove(post) { client.moderatePost(post.id) }

    private suspend fun remove(
        post: PostView,
        call: suspend () -> Unit,
    ) {
        val before = _posts.value
        _posts.value = before.filter { it.id != post.id }
        attempt { call() }.onFailure {
            _posts.value = before
            _notice.value = ForumErrorText.describe(it)
        }
    }

    /** A post changed elsewhere (its page): mirror it here. */
    fun update(post: PostView) = replace(post.id) { post }

    /** A post went away elsewhere (its page). */
    fun forget(postId: String) {
        _posts.value = _posts.value.filter { it.id != postId }
    }

    // ---- moderators ----------------------------------------------------------------------

    suspend fun addModerator(account: String) {
        val id = account.trim().lowercase()
        if (!ForumFormat.isAccountId(id)) throw ForumModelException("That isn't an account id (64 hex characters).")
        if (_moderators.value.any { it.equals(id, ignoreCase = true) }) return
        setModerators(_moderators.value + id)
    }

    suspend fun removeModerator(account: String) = setModerators(_moderators.value.filterNot { it.equals(account, ignoreCase = true) })

    private suspend fun setModerators(list: List<String>) {
        if (list.isEmpty()) throw ForumModelException("A forum needs at least one moderator.")
        worded { client.setModerators(list) }
        _moderators.value = list
    }

    // ---- your name -----------------------------------------------------------------------

    /** Push the name kept on this device to this forum, or adopt the forum's when the device has none. */
    suspend fun syncName() {
        val local = names.name
        if (local.isEmpty()) {
            attempt { client.getNickname(account) }.getOrNull()?.nullIfBlank()?.let {
                names.name = it
                _displayName.value = it
            }
            return
        }
        val remote = attempt { client.getNickname(account) }.getOrNull()
        if (remote != local) attempt { client.setNickname(local) }
    }

    /** Change the name you post under, here and on this device. */
    suspend fun rename(next: String) {
        val trimmed = next.trim()
        if (trimmed.length > ForumConstants.MAX_NAME) throw ForumModelException("Keep your name under 64 characters.")
        worded { client.setNickname(trimmed) }
        names.name = trimmed
        _displayName.value = trimmed
        _posts.value = _posts.value.map { if (isMine(it)) it.copy(authorName = trimmed) else it }
    }

    fun dismissNotice() {
        _notice.value = null
    }

    private fun replace(
        id: String,
        change: (PostView) -> PostView,
    ) {
        _posts.value = _posts.value.map { if (it.id == id) change(it) else it }
    }
}
