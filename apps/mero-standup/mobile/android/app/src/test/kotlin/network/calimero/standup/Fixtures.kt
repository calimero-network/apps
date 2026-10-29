package network.calimero.standup

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.standup.app.TeamModel
import network.calimero.standup.app.TeamSummary
import network.calimero.standup.generated.DayView
import network.calimero.standup.generated.DecisionPage
import network.calimero.standup.generated.DecisionView
import network.calimero.standup.generated.HelpView
import network.calimero.standup.generated.MemberView
import network.calimero.standup.generated.TagCount
import network.calimero.standup.generated.UpdateView
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/** Wednesday 28 October 2026, 10:00 UTC. */
val clock: Clock = Clock.fixed(Instant.parse("2026-10-28T10:00:00Z"), ZoneOffset.UTC)

const val ME = "me-account"
const val ANA = "ana-account"
const val BO = "bo-account"

fun <T> json(
    serializer: KSerializer<T>,
    value: T,
): JsonElement = Json.encodeToJsonElement(serializer, value)

fun update(
    author: String,
    day: String,
    done: String = "did $day",
    next: String = "next $day",
    blockers: String = "",
    name: String = "",
    helpers: List<HelpView> = emptyList(),
) = UpdateView(day, author, name, done, next, blockers, 1uL, 1uL, helpers)

fun decision(
    id: String,
    title: String,
    supersededBy: String = "",
    createdAt: ULong = 1_790_000_000_000_000_000uL,
) = DecisionView(id, ME, "Me", title, "decided $title", "", "", supersededBy, createdAt, emptyList(), emptyList(), "")

/** A scripted contract: answers by method from the maps, records every call. */
class Script {
    var me = ME
    var myName = "Me"
    var teamName = "Platform"
    var members = listOf(MemberView(ME, "Me", "2026-10-27"), MemberView(ANA, "Ana", "2026-10-28"), MemberView(BO, "", ""))
    var days = mutableMapOf<String, List<UpdateView>>()
    var blockers = emptyList<UpdateView>()
    var decisions = emptyList<DecisionView>()
    var nextCursor: String? = null
    var tags = emptyList<TagCount>()

    fun answer(call: RecordedContractCall): JsonElement? {
        val args = call.args as? JsonObject ?: JsonObject(emptyMap())

        fun arg(key: String) = (args[key] as? JsonPrimitive)?.content.orEmpty()
        return when (call.method) {
            "whoami" -> JsonPrimitive(me)
            "get_name" -> JsonPrimitive(if (arg("account") == me) myName else "")
            "team_name" -> JsonPrimitive(teamName)
            "members" -> json(kotlinx.serialization.builtins.ListSerializer(MemberView.serializer()), members)
            "get_day" -> json(DayView.serializer(), DayView(arg("day"), days[arg("day")].orEmpty()))
            "get_week" -> {
                val start =
                    network.calimero.standup.core.Days
                        .weekDays(arg("start"))
                json(kotlinx.serialization.builtins.ListSerializer(DayView.serializer()), start.map { DayView(it, days[it].orEmpty()) })
            }
            "current_blockers" -> json(kotlinx.serialization.builtins.ListSerializer(UpdateView.serializer()), blockers)
            "list_decisions" -> json(DecisionPage.serializer(), DecisionPage(decisions, nextCursor))
            "tags" -> json(kotlinx.serialization.builtins.ListSerializer(TagCount.serializer()), tags)
            "log_decision" -> JsonPrimitive("new-id")
            else -> JsonNull
        }
    }
}

fun backendWith(script: Script): InMemoryAppBackend {
    val backend = InMemoryAppBackend()
    backend.recording.handler = { script.answer(it) }
    return backend
}

fun teamOn(backend: InMemoryAppBackend) = TeamModel(TeamSummary("ns", "ctx", "Platform"), backend)
