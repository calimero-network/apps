package network.calimero.updates.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.Metrics
import network.calimero.updates.generated.CommentView
import network.calimero.updates.generated.Metric
import network.calimero.updates.generated.MetricPoint
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.PostView
import network.calimero.updates.generated.ReactionCount

/** One update or question: the post, the KPI series its deltas come from, the replies, and opening it records a read once. */
class PostModel(
    val postId: String,
    val audience: AudienceModel,
) {
    private val _post = MutableStateFlow<PostView?>(null)
    val post: StateFlow<PostView?> = _post.asStateFlow()
    private val _series = MutableStateFlow<List<MetricSeries>>(emptyList())
    val series: StateFlow<List<MetricSeries>> = _series.asStateFlow()
    private val _comments = MutableStateFlow<List<CommentView>>(emptyList())
    val comments: StateFlow<List<CommentView>> = _comments.asStateFlow()
    private val _deleted = MutableStateFlow(false)
    val deleted: StateFlow<Boolean> = _deleted.asStateFlow()
    val error = MutableStateFlow<String?>(null)
    private var marked = false

    val isQuestion: Boolean get() = _post.value?.card?.kind == "question"
    val isMine: Boolean get() = _post.value != null && _post.value?.card?.author == audience.me.value?.account

    /** The team edits and deletes any post; a question's author may delete it. */
    val canDelete: Boolean get() = audience.isTeam || (isQuestion && isMine)
    val canEdit: Boolean get() = audience.isTeam && !isQuestion

    val topLevel: List<CommentView> get() = _comments.value.filter { it.parentId.isEmpty() }

    fun replies(id: String): List<CommentView> = _comments.value.filter { it.parentId == id }

    fun canDelete(comment: CommentView): Boolean = audience.isTeam || comment.author == audience.me.value?.account

    fun canEdit(comment: CommentView): Boolean = comment.author == audience.me.value?.account

    suspend fun load() {
        val client = audience.client
        try {
            val (p, c) =
                coroutineScope {
                    val post = async { client.getPost(postId) }
                    val comments = async { client.listComments(postId) }
                    post.await() to comments.await()
                }
            _post.value = p
            _comments.value = c
            error.value = null
            if (p.metrics.isNotEmpty()) runCatching { client.listMetrics() }.onSuccess { _series.value = it }
            markReadOnce(p)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_post.value == null) error.value = ErrorText.describe(e)
        }
    }

    /** The read receipt: recorded the first time an unread post is shown. */
    private suspend fun markReadOnce(post: PostView) {
        if (marked) return
        marked = true
        if (post.card.readByMe) return
        runCatching { audience.client.markRead(postId) }
        audience.load()
    }

    /** Toggle a reaction, shown at once and put right if the write fails. */
    suspend fun toggle(emoji: String) {
        val current = _post.value ?: return
        val on = !mine(emoji)
        val reactions = current.card.reactions
        val next =
            if (reactions.any { it.emoji == emoji }) {
                reactions.map {
                    if (it.emoji != emoji) {
                        it
                    } else {
                        it.copy(
                            mine = on,
                            count =
                                if (on) {
                                    it.count + 1uL
                                } else if (it.count > 0uL) {
                                    it.count - 1uL
                                } else {
                                    0uL
                                },
                        )
                    }
                }
            } else if (on) {
                reactions + ReactionCount(emoji, 1uL, true)
            } else {
                reactions
            }
        _post.value = current.copy(card = current.card.copy(reactions = next))
        try {
            audience.react(postId, emoji, on)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            load()
        }
    }

    /** The reactions with at least one. */
    val usedReactions: List<ReactionCount> get() =
        _post.value
            ?.card
            ?.reactions
            .orEmpty()
            .filter { it.count > 0uL }

    fun mine(emoji: String): Boolean =
        _post.value
            ?.card
            ?.reactions
            ?.firstOrNull { it.emoji == emoji }
            ?.mine ?: false

    suspend fun delete(): Boolean =
        try {
            audience.deletePost(postId)
            _deleted.value = true
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
            false
        }

    suspend fun toggleAnswered() {
        val card = _post.value?.card ?: return
        try {
            audience.setQuestionStatus(postId, card.status != "answered")
            load()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        }
    }

    /** Reply at the top level, or under [parentId]. Throws, so the reply bar can say why. */
    suspend fun reply(
        body: String,
        parentId: String? = null,
    ) {
        audience.addComment(postId, parentId, body)
        load()
    }

    suspend fun edit(
        comment: CommentView,
        body: String,
    ) {
        audience.editComment(comment.id, body)
        load()
    }

    suspend fun delete(comment: CommentView) {
        _comments.value = _comments.value.filter { it.id != comment.id }
        try {
            audience.deleteComment(comment.id)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        }
        load()
    }

    /** The KPI's previous report, for "vs $40k" and its delta. */
    fun previous(metric: Metric): MetricPoint? = Metrics.previous(metric.name, postId, _series.value)

    /** The reply box's prompt. */
    val replyPlaceholder: String
        get() =
            when {
                audience.isTeam && isQuestion -> "Answer the question…"
                audience.isTeam -> "Add a note for your investors…"
                isQuestion -> "Add to the question…"
                else -> "Reply to the team — questions, congratulations, pushback…"
            }
}
