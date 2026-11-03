package network.calimero.forum.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject

/** Rethrow cancellation; anything else is a failure to show. */
internal inline fun <T> attempt(block: () -> T): Result<T> =
    try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (
        @Suppress("TooGenericExceptionCaught") e: Exception,
    ) {
        Result.failure(e)
    }

/** Run [block], turning any failure into a [ForumModelException] with words to show. */
internal inline fun <T> worded(block: () -> T): T = attempt(block).getOrElse { throw ForumModelException(ForumErrorText.describe(it)) }

/** The spaces (namespaces) this account is in, and founding a new one. (Swift `SpacesModel`.) */
class SpacesModel(
    val backend: MeroAppBackend,
) {
    private val _spaces = MutableStateFlow<List<AppNamespace>>(emptyList())
    val spaces: StateFlow<List<AppNamespace>> = _spaces.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isCreating = MutableStateFlow(false)
    val isCreating: StateFlow<Boolean> = _isCreating.asStateFlow()

    /** Whether the account is connected (always, once signed in on 1.0). Without it only joining works. */
    val hasRelay: Boolean get() = backend.hasRelay

    suspend fun load() {
        if (_spaces.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt { backend.listNamespaces() }
            .onSuccess { listed ->
                _spaces.value = listed.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { nameOf(it) })
                _phase.value = LoadPhase.Loaded
            }.onFailure {
                _phase.value = if (_spaces.value.isEmpty()) LoadPhase.Failed(ForumErrorText.describe(it)) else LoadPhase.Loaded
            }
    }

    /** Found a space named [name]. Throws [ForumModelException] with words to show. */
    suspend fun create(name: String): AppNamespace {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw ForumModelException("Give the space a name.")
        _isCreating.value = true
        try {
            val founded = worded { backend.foundNamespace(trimmed) }
            val space = AppNamespace(founded.namespaceId, trimmed, "", memberCount = 1)
            if (_spaces.value.none { it.id == space.id }) _spaces.value = _spaces.value + space
            load()
            return _spaces.value.firstOrNull { it.id == space.id } ?: space
        } finally {
            _isCreating.value = false
        }
    }

    companion object {
        /** A space's name, or a stand-in made from its id. */
        fun nameOf(space: AppNamespace): String = space.name?.nullIfBlank() ?: "Space ${space.id.take(ID_PREFIX)}"

        internal const val ID_PREFIX = 6
    }
}

/**
 * One forum in a space: an app instance of Mero Forum in the space's org (the web app's
 * `createApp(name, source, { org })`). Its id is the app instance id.
 */
data class ForumRow(
    val id: String,
    val name: String,
    /** The app instance (the same as [id] on 1.0; kept nullable for the screens). */
    val contextId: String?,
    val joined: Boolean,
)

/**
 * The forums in one space: list, create, open, and invite people. (Swift `ForumsModel`.) On
 * Calimero 1.0 every member of the org reaches its app instances: nothing to join, nothing to sync.
 */
class ForumsModel(
    val backend: MeroAppBackend,
    val namespaceId: String,
    val spaceName: String,
    val applicationId: String,
) {
    private val _forums = MutableStateFlow<List<ForumRow>>(emptyList())
    val forums: StateFlow<List<ForumRow>> = _forums.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isCreating = MutableStateFlow(false)
    val isCreating: StateFlow<Boolean> = _isCreating.asStateFlow()

    /** The forum being opened (joined first when needed). */
    private val _entering = MutableStateFlow<String?>(null)
    val entering: StateFlow<String?> = _entering.asStateFlow()

    suspend fun load() {
        if (_forums.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt {
            backend.listContextEntries(namespaceId).map { entry ->
                ForumRow(entry.id, entry.name?.nullIfBlank() ?: "Forum ${entry.id.take(SpacesModel.ID_PREFIX)}", entry.id, joined = true)
            }
        }.onSuccess { rows ->
            _forums.value = rows.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_forums.value.isEmpty()) LoadPhase.Failed(ForumErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    /** Create a forum: an app instance of Mero Forum directly in the space's org, whose `init` takes no arguments. */
    suspend fun create(name: String): ForumRef {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw ForumModelException("Give the forum a name.")
        if (applicationId.isEmpty()) throw ForumModelException("Still connecting to Calimero. Try again in a moment.")
        _isCreating.value = true
        try {
            val contextId = worded { backend.createContext(namespaceId, applicationId, trimmed, JsonObject(emptyMap())) }
            _forums.value =
                (_forums.value + ForumRow(contextId, trimmed, contextId, joined = true))
                    .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            return ref(contextId, trimmed, contextId)
        } finally {
            _isCreating.value = false
        }
    }

    /** Open a forum. Every member of the space reaches it on 1.0. */
    fun enter(forum: ForumRow): ForumRef = ref(forum.id, forum.name, forum.contextId ?: forum.id)

    /** An invitation link to the whole space. */
    suspend fun spaceInvite(): String =
        worded {
            ForumInvitation(backend.createInvitation(namespaceId), ForumInvitation.Kind.SPACE, spaceName).link()
        }

    /** An invitation link that lands the person in one forum. It still grants the space. */
    suspend fun forumInvite(forum: ForumRow): String = forumInvite(backend, ForumRef(namespaceId, spaceName, forum.id, forum.name, forum.contextId.orEmpty()))

    private fun ref(
        groupId: String,
        name: String,
        contextId: String,
    ) = ForumRef(namespaceId, spaceName, groupId, name, contextId)

    companion object {
        suspend fun forumInvite(
            backend: MeroAppBackend,
            ref: ForumRef,
        ): String =
            worded {
                ForumInvitation(
                    invitation = backend.createInvitation(ref.namespaceId),
                    kind = ForumInvitation.Kind.FORUM,
                    spaceName = ref.spaceName,
                    forumId = ref.forumId,
                    forumName = ref.forumName,
                    contextId = ref.contextId.nullIfBlank(),
                ).link()
            }
    }
}
