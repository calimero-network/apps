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

    /** Whether a relay serves the account. Without one only joining works. */
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

/** One forum in a space: an open subgroup with one context running the contract. */
data class ForumRow(
    val id: String,
    val name: String,
    /** Null while the forum exists but its context has not replicated yet. */
    val contextId: String?,
    val joined: Boolean,
)

/** The forums in one space: list, create, join, and invite people. (Swift `ForumsModel`.) */
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
            backend.listSubgroups(namespaceId).map { group ->
                val contextId = group.contextIds.firstOrNull()
                val joined = contextId != null && attempt { backend.isMember(contextId) }.getOrDefault(false)
                ForumRow(group.groupId, group.name?.nullIfBlank() ?: "Forum ${group.groupId.take(SpacesModel.ID_PREFIX)}", contextId, joined)
            }
        }.onSuccess { rows ->
            _forums.value = rows.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_forums.value.isEmpty()) LoadPhase.Failed(ForumErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    /**
     * Create a forum: an OPEN subgroup (so everyone in the space can join it) with a context
     * running the contract, whose `init` takes no arguments.
     */
    suspend fun create(name: String): ForumRef {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw ForumModelException("Give the forum a name.")
        if (applicationId.isEmpty()) throw ForumModelException("Still connecting to Calimero. Try again in a moment.")
        _isCreating.value = true
        try {
            val groupId = worded { backend.createSubgroup(namespaceId, trimmed, isPublic = true) }
            val contextId = worded { backend.createContext(groupId, applicationId, trimmed, JsonObject(emptyMap())) }
            _forums.value =
                (_forums.value + ForumRow(groupId, trimmed, contextId, joined = true))
                    .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
            return ref(groupId, trimmed, contextId)
        } finally {
            _isCreating.value = false
        }
    }

    /** Open a forum, joining its context first when this account is not in it yet. */
    suspend fun enter(forum: ForumRow): ForumRef {
        val contextId = forum.contextId ?: throw ForumModelException("This forum is still syncing. Try again in a moment.")
        if (forum.joined) return ref(forum.id, forum.name, contextId)
        _entering.value = forum.id
        try {
            worded {
                if (!attempt { backend.isMember(contextId) }.getOrDefault(false)) backend.joinContext(contextId)
            }
            _forums.value = _forums.value.map { if (it.id == forum.id) it.copy(joined = true) else it }
            return ref(forum.id, forum.name, contextId)
        } finally {
            _entering.value = null
        }
    }

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
