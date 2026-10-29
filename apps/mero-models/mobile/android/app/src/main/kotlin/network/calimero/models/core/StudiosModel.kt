package network.calimero.models.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.models.generated.SceneInfo
import kotlin.coroutines.cancellation.CancellationException

/** Where a list screen is. (Swift `LoadState`.) */
sealed class LoadState {
    data object Idle : LoadState()

    data object Loading : LoadState()

    data object Loaded : LoadState()

    data class Failed(
        val message: String,
    ) : LoadState()
}

/** Runs [block], letting cancellation through and turning anything else into a result. */
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

/** A studio: a namespace running Mero Models. Everyone invited to it can open every scene in it. */
data class Studio(
    val id: String,
    val name: String,
    val memberCount: Int,
)

/** The studios this account is in. (Swift `StudiosModel`.) */
class StudiosModel(
    private val backend: MeroAppBackend,
) {
    private val _studios = MutableStateFlow<List<Studio>>(emptyList())
    val studios: StateFlow<List<Studio>> = _studios.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    suspend fun load() {
        if (_studios.value.isEmpty()) _state.value = LoadState.Loading
        attempt { backend.listNamespaces() }
            .onSuccess { list ->
                _studios.value = list.map { Studio(it.id, name(it), it.memberCount) }.sortedBy { it.name.lowercase() }
                _state.value = LoadState.Loaded
            }.onFailure { _state.value = LoadState.Failed(ModelsFormat.errorText(it)) }
    }

    companion object {
        fun name(ns: AppNamespace): String = ns.name?.trim()?.takeIf { it.isNotEmpty() } ?: "Studio ${ModelsFormat.shortId(ns.id)}"
    }
}

/** A scene: one context in the studio, as the web's "New scene" makes it. */
data class SceneSummary(
    val contextId: String,
    val name: String,
    /** From the scene's own `get_scene`, once it answers. */
    val objectCount: Int? = null,
    val memberCount: Int? = null,
    val role: String? = null,
)

/**
 * A studio's scenes: the contexts directly in its root group, and those in any subgroup.
 * (Swift `ScenesModel`.)
 */
class ScenesModel(
    private val backend: MeroAppBackend,
    val studioId: String,
) {
    private val _scenes = MutableStateFlow<List<SceneSummary>>(emptyList())
    val scenes: StateFlow<List<SceneSummary>> = _scenes.asStateFlow()
    private val _state = MutableStateFlow<LoadState>(LoadState.Idle)
    val state: StateFlow<LoadState> = _state.asStateFlow()

    suspend fun load() {
        if (_scenes.value.isEmpty()) _state.value = LoadState.Loading
        val root =
            attempt { backend.listContexts(studioId) }.getOrElse {
                _state.value = LoadState.Failed(ModelsFormat.errorText(it))
                return
            }
        val ids = root.toMutableList()
        attempt { backend.listSubgroups(studioId) }.getOrNull()?.forEach { sg ->
            sg.contextIds.filter { it !in ids }.forEach { ids += it }
        }
        val known = _scenes.value.associateBy { it.contextId }
        _scenes.value = ids.mapIndexed { i, ctx -> known[ctx] ?: SceneSummary(ctx, "Scene ${i + 1}") }
        _state.value = LoadState.Loaded
        enrich()
    }

    /** Each scene's own name and size. A scene this account cannot read yet keeps its placeholder. */
    private suspend fun enrich() {
        val infos: Map<String, SceneInfo> =
            coroutineScope {
                _scenes.value
                    .map { s -> async { s.contextId to attempt { backend.modelsClient(s.contextId).getScene() }.getOrNull() } }
                    .awaitAll()
                    .mapNotNull { (id, info) -> info?.let { id to it } }
                    .toMap()
            }
        _scenes.value =
            _scenes.value.map { s ->
                val info = infos[s.contextId] ?: return@map s
                s.copy(
                    name = info.name.trim().ifEmpty { s.name },
                    objectCount = info.objectCount.toInt(),
                    memberCount = info.memberCount.toInt(),
                    role = info.myRole,
                )
            }
    }

    /** A link to a scene: an invitation to this studio that opens the scene. */
    suspend fun shareLink(contextId: String): String = ModelsInvitation.mint(backend, studioId, contextId)
}
