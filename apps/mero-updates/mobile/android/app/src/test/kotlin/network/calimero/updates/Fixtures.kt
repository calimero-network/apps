package network.calimero.updates

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.AudienceSummary
import network.calimero.updates.generated.AskView
import network.calimero.updates.generated.CategoryView
import network.calimero.updates.generated.CommentView
import network.calimero.updates.generated.ContributionView
import network.calimero.updates.generated.DraftView
import network.calimero.updates.generated.EngagementRow
import network.calimero.updates.generated.MeView
import network.calimero.updates.generated.Metric
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.Overview
import network.calimero.updates.generated.PersonView
import network.calimero.updates.generated.PostCard
import network.calimero.updates.generated.PostPage
import network.calimero.updates.generated.PostView
import network.calimero.updates.generated.ReactionCount
import network.calimero.updates.generated.Section
import network.calimero.updates.generated.Settings
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

val ME = "a1".repeat(32)
val ANA = "b2".repeat(32)

/** Wednesday 28 October 2026, noon UTC. */
val clock: Clock = Clock.fixed(Instant.parse("2026-10-28T12:00:00Z"), ZoneOffset.UTC)
val NOW_MS: ULong = clock.millis().toULong()

private val json = Json { encodeDefaults = true }

/**
 * [value] as the component contract answers it: the generated types write the contract's wire
 * themselves (camelCase keys, every `u64` a decimal string).
 */
fun <T> json(
    serializer: KSerializer<T>,
    value: T,
): JsonElement = json.encodeToJsonElement(serializer, value)

@Suppress("LongParameterList")
fun card(
    id: String,
    title: String = "Update",
    kind: String = "update",
    author: String = ME,
    category: String = "",
    status: String = "",
    readByMe: Boolean = true,
    reactions: List<ReactionCount> = emptyList(),
) = PostCard(
    id, kind, author, if (author == ME) "Me" else "Ana", author == ME, title, "", category, status, NOW_MS, NOW_MS,
    0uL, 0uL, 0uL, 0uL, 1uL, readByMe, reactions,
)

fun postView(
    card: PostCard,
    metrics: List<Metric> = emptyList(),
    asks: List<AskView> = emptyList(),
    sections: List<Section> = emptyList(),
) = PostView(card, sections, metrics, asks)

fun person(
    account: String,
    name: String,
    team: Boolean = false,
    admin: Boolean = false,
) = PersonView(account, name, "", admin, team, 1uL, 1uL, 2uL, 1uL, 0uL, 0uL, 0uL)

fun category(
    id: String,
    name: String,
    muted: Boolean = false,
) = CategoryView(id, name, "", "", 0uL, 0uL, muted)

/** A scripted audience: answers every view from these values, records every write. */
class FakeAudience {
    val backend = InMemoryAppBackend()
    var me = MeView(ME, "Me", "", true, true, emptyList())
    var overview = Overview("Acme", 30u, 0uL, 0uL, 0uL, 0uL, 0uL, 0uL, 1uL, true)
    var categories = emptyList<CategoryView>()
    var posts = emptyList<PostCard>()
    var questions = emptyList<PostCard>()
    var postViews = mutableMapOf<String, PostView>()
    var comments = emptyList<CommentView>()
    var drafts = emptyList<DraftView>()
    var series = emptyList<MetricSeries>()
    var people = emptyList<PersonView>()
    var asks = emptyList<AskView>()
    var contributions = emptyList<ContributionView>()
    var settings = Settings("Acme", 14u, 5uL)

    init {
        backend.recording.handler = { answer(it) }
    }

    val recording get() = backend.recording

    @Suppress("CyclomaticComplexMethod")
    private fun answer(call: RecordedContractCall): JsonElement? {
        val args = call.args as? JsonObject ?: JsonObject(emptyMap())

        fun arg(key: String) = (args[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
        return when (call.method) {
            "getMe" -> json(MeView.serializer(), me)
            "getOverview" -> json(Overview.serializer(), overview)
            "listCategories" -> json(ListSerializer(CategoryView.serializer()), categories)
            "listPosts" -> {
                var items = if (arg("kind") == "question") questions else posts
                arg("categoryId")?.let { c -> items = items.filter { it.categoryId == c } }
                (args["limit"] as? JsonPrimitive)?.content?.toIntOrNull()?.let { items = items.take(it) }
                json(PostPage.serializer(), PostPage(items, null))
            }
            "getPost" -> postViews[arg("postId")]?.let { json(PostView.serializer(), it) } ?: JsonNull
            "listComments" -> json(ListSerializer(CommentView.serializer()), comments)
            "listDrafts" -> json(ListSerializer(DraftView.serializer()), drafts)
            "listMetrics" -> json(ListSerializer(MetricSeries.serializer()), series)
            "listPeople" -> json(ListSerializer(PersonView.serializer()), people)
            "getEngagement" -> json(ListSerializer(EngagementRow.serializer()), emptyList())
            "listAsks" -> json(ListSerializer(AskView.serializer()), asks.filter { a -> arg("status").let { it == null || a.status == it } })
            "listContributions" -> json(ListSerializer(ContributionView.serializer()), contributions)
            "getSettings" -> json(Settings.serializer(), settings)
            "saveDraft" -> JsonPrimitive(arg("draftId") ?: "draft-1")
            "publishUpdate" -> JsonPrimitive("post-new")
            "askQuestion" -> JsonPrimitive("q-new")
            "addComment" -> JsonPrimitive("c-new")
            "createCategory" -> JsonPrimitive("cat-new")
            else -> JsonNull
        }
    }

    suspend fun audienceModel(): AudienceModel {
        val summary = AudienceSummary("ns-1", "grp-1", "ctx-1", "All investors", "Acme")
        return AudienceModel(summary, "ctx-1", backend).also { it.load() }
    }
}

fun RecordedContractCall.arg(key: String): String? = ((args as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

fun RecordedContractCall.argElement(key: String): JsonElement? = (args as? JsonObject)?.get(key)
