// The pipeline's answers, as Mero CRM's component ABI (`logic/res/abi.json`) declares them: v1's
// snake_case fields, every u64 a decimal string both ways. The calls are the generated
// [network.calimero.crm.generated.client.CrmClient] (`scripts/mobile-codegen.sh` at the repo root).
// Until the logic derives `AbiType` the ABI names these types without their shape, so the client
// answers their JSON and [CrmContract.read] reads it; then they are generated too and this file
// goes.

package network.calimero.crm.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/** What the app keeps of the contract beside the generated client. */
object CrmContract {
    /** The contract's views, by ABI name. */
    val VIEWS: Set<String> = setOf("getDeal", "getSettings", "listActivities", "listAutomations", "listContacts", "listDeals", "listStages")

    /** The contract's calls, by ABI name. */
    val CALLS: Set<String> =
        setOf(
            "addActivity",
            "addAutomation",
            "addNote",
            "addStage",
            "createContact",
            "createDeal",
            "deleteActivity",
            "deleteAutomation",
            "deleteContact",
            "deleteDeal",
            "deleteNote",
            "deleteStage",
            "markLost",
            "markWon",
            "moveDeal",
            "reopenDeal",
            "reorderStages",
            "rescheduleActivity",
            "setActivityDone",
            "setAutomationEnabled",
            "setCurrency",
            "setRottingDays",
            "updateContact",
            "updateDeal",
            "updateStage",
        )

    val JSON = Json { ignoreUnknownKeys = true }

    /** An answer of the generated client as the app type [T]. */
    inline fun <reified T> read(answer: JsonElement): T = JSON.decodeFromJsonElement(serializer<T>(), answer)
}

/** A u64 field as the wire carries it: a decimal string (a number is read too). */
object U64 : KSerializer<ULong> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("U64", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: ULong) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): ULong {
        val text = (decoder as? JsonDecoder)?.decodeJsonElement()?.jsonPrimitive?.content ?: decoder.decodeString()
        return text.toULongOrNull() ?: throw kotlinx.serialization.SerializationException("not a u64: $text")
    }
}

// ---- answers -----------------------------------------------------------------------------------

@Serializable
data class ActivityView(
    val id: String,
    @SerialName("deal_id") val dealId: String? = null,
    /** The deal's title, resolved here so the to-do list needs no join. */
    @SerialName("deal_title") val dealTitle: String? = null,
    @SerialName("contact_id") val contactId: String? = null,
    val kind: String,
    val subject: String,
    @SerialName("due_at") @Serializable(with = U64::class) val dueAt: ULong,
    val done: Boolean,
    @SerialName("done_at") @Serializable(with = U64::class) val doneAt: ULong? = null,
    val owner: String? = null,
    val note: String,
    @SerialName("automation_id") val automationId: String? = null,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_at") @Serializable(with = U64::class) val createdAt: ULong,
)

@Serializable
data class AutomationView(
    val id: String,
    @SerialName("stage_id") val stageId: String,
    val kind: String,
    val subject: String,
    @SerialName("due_in_days") val dueInDays: UInt,
    val enabled: Boolean,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_at") @Serializable(with = U64::class) val createdAt: ULong,
)

@Serializable
data class ContactView(
    val id: String,
    val name: String,
    val email: String,
    val phone: String,
    val organization: String,
    @SerialName("job_title") val jobTitle: String,
    @SerialName("open_deals") val openDeals: UInt,
    @SerialName("won_value") @Serializable(with = U64::class) val wonValue: ULong,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_at") @Serializable(with = U64::class) val createdAt: ULong,
)

/** A deal with everything the detail page shows (named struct, never a tuple). */
@Serializable
data class DealDetail(
    val deal: DealView,
    val contact: ContactView? = null,
    val activities: List<ActivityView>,
    val notes: List<NoteView>,
)

@Serializable
data class DealView(
    val id: String,
    val title: String,
    @Serializable(with = U64::class) val value: ULong,
    val organization: String,
    @SerialName("contact_id") val contactId: String? = null,
    /** The linked person's name, resolved here so the board needs no join. */
    @SerialName("contact_name") val contactName: String? = null,
    val owner: String? = null,
    @SerialName("stage_id") val stageId: String,
    val status: String,
    @SerialName("lost_reason") val lostReason: String,
    @SerialName("expected_close") @Serializable(with = U64::class) val expectedClose: ULong? = null,
    val source: String,
    /** Win probability: the stage's while open, 100 when won, 0 when lost. */
    val probability: UInt,
    @SerialName("stage_entered_at") @Serializable(with = U64::class) val stageEnteredAt: ULong,
    @SerialName("closed_at") @Serializable(with = U64::class) val closedAt: ULong? = null,
    @SerialName("next_activity") val nextActivity: NextActivity? = null,
    @SerialName("open_activities") val openActivities: UInt,
    /** The most recent completed activity or note, if any. */
    @SerialName("last_touch_at") @Serializable(with = U64::class) val lastTouchAt: ULong? = null,
    @SerialName("created_by") val createdBy: String,
    @SerialName("created_at") @Serializable(with = U64::class) val createdAt: ULong,
)

/** The earliest open activity on a deal — the "next step" the board shows. */
@Serializable
data class NextActivity(
    val id: String,
    val kind: String,
    val subject: String,
    @SerialName("due_at") @Serializable(with = U64::class) val dueAt: ULong,
)

@Serializable
data class NoteView(
    val id: String,
    @SerialName("deal_id") val dealId: String,
    val author: String,
    val body: String,
    @SerialName("created_at") @Serializable(with = U64::class) val createdAt: ULong,
)

@Serializable
data class Settings(
    val currency: String,
    @SerialName("rotting_days") val rottingDays: UInt,
)

@Serializable
data class StageView(
    val id: String,
    val name: String,
    val probability: UInt,
    val position: UInt,
)
