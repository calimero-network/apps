package network.calimero.crm

import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.crm.app.PipelineModel
import network.calimero.crm.app.PipelineRef
import network.calimero.crm.generated.ActivityView
import network.calimero.crm.generated.AutomationView
import network.calimero.crm.generated.ContactView
import network.calimero.crm.generated.DealView
import network.calimero.crm.generated.NextActivity
import network.calimero.crm.generated.Settings
import network.calimero.crm.generated.StageView
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/** UTC, so day arithmetic in the tests does not depend on the machine. */
val utc: ZoneId = ZoneOffset.UTC

/** Wednesday 28 October 2026, 10:00 UTC. */
val now: ULong = Instant.parse("2026-10-28T10:00:00Z").toEpochMilli().toULong()

fun ms(daysFromNow: Double): ULong = (now.toLong() + (daysFromNow * 86_400_000).toLong()).toULong()

val stages =
    listOf(
        StageView("lead", "Lead in", 10u, 0u),
        StageView("qualified", "Qualified", 25u, 1u),
        StageView("meeting", "Meeting", 40u, 2u),
        StageView("proposal", "Proposal", 60u, 3u),
        StageView("negotiation", "Negotiation", 80u, 4u),
    )

@Suppress("LongParameterList")
fun deal(
    id: String,
    title: String = "Acme — 50 seats",
    value: ULong = 12_000u,
    stage: String = "lead",
    status: String = "open",
    probability: UInt = 10u,
    contactId: String? = "c1",
    owner: String? = "alice",
    organization: String = "Acme",
    close: ULong? = ms(20.0),
    next: NextActivity? = null,
    created: ULong = ms(-2.0),
    lastTouch: ULong? = null,
    closedAt: ULong? = null,
    lostReason: String = "",
) = DealView(
    id = id,
    title = title,
    value = value,
    organization = organization,
    contactId = contactId,
    contactName = if (contactId == null) null else "Ana Diaz",
    owner = owner,
    stageId = stage,
    status = status,
    lostReason = lostReason,
    expectedClose = close,
    source = "Referral",
    probability = probability,
    stageEnteredAt = created,
    closedAt = closedAt,
    nextActivity = next,
    openActivities = if (next == null) 0u else 1u,
    lastTouchAt = lastTouch,
    createdBy = "me",
    createdAt = created,
)

fun next(
    days: Double,
    subject: String = "Call Ana",
) = NextActivity("a1", "call", subject, ms(days))

fun contact(
    id: String,
    name: String,
    org: String = "Acme",
) = ContactView(id, name, "${name.lowercase().take(3)}@acme.test", "", org, "Head of Ops", 1u, 0uL, "me", 1uL)

fun activity(
    id: String,
    due: ULong,
    done: Boolean = false,
    doneAt: ULong? = null,
    kind: String = "call",
) = ActivityView(id, "d1", "Acme", null, kind, "Subject $id", due, done, doneAt, null, "", null, "me", 1uL)

/** A scripted pipeline behind an `InMemoryAppBackend`: answers the reads from these properties. */
class Script {
    var stages = network.calimero.crm.stages
    var deals = emptyList<DealView>()
    var contacts = emptyList<ContactView>()
    var activities = emptyList<ActivityView>()
    var settings = Settings("EUR", 14u)
    var failRead: Throwable? = null

    fun answer(call: RecordedContractCall): JsonElement? {
        failRead?.let { if (call.path == RecordedContractCall.Path.QUERY) throw it }
        return when (call.method) {
            "list_stages" -> Json.encodeToJsonElement(ListSerializer(StageView.serializer()), stages)
            "list_deals" -> Json.encodeToJsonElement(ListSerializer(DealView.serializer()), deals)
            "list_contacts" -> Json.encodeToJsonElement(ListSerializer(ContactView.serializer()), contacts)
            "list_activities" -> Json.encodeToJsonElement(ListSerializer(ActivityView.serializer()), activities)
            "list_automations" -> Json.encodeToJsonElement(ListSerializer(AutomationView.serializer()), emptyList())
            "get_settings" -> Json.encodeToJsonElement(Settings.serializer(), settings)
            "create_deal", "create_contact", "add_activity", "add_note", "add_stage" -> JsonPrimitive("new-${call.method}")
            else -> JsonNull
        }
    }
}

fun backendWith(script: Script): InMemoryAppBackend {
    val backend = InMemoryAppBackend()
    backend.recording.handler = { script.answer(it) }
    return backend
}

val ref = PipelineRef("ns", "ctx", "Sales", "Acme Inc")

fun modelOn(backend: InMemoryAppBackend): PipelineModel {
    backend.members = setOf("ctx")
    return PipelineModel(ref, backend).apply {
        now = { network.calimero.crm.now }
        zone = utc
    }
}

/** The JSON object a call sent. */
fun args(call: RecordedContractCall): JsonObject = call.args as? JsonObject ?: JsonObject(emptyMap())
