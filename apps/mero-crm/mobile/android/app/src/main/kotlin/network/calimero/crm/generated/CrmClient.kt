// The pipeline's contract, as Mero CRM's component ABI (`logic/res/abi.json`) declares it: methods
// and arguments in camelCase, every u64 as a decimal string both ways, a refusal as
// `422 APP_ERROR {code, fields}`. Answers keep v1's snake_case fields. Written from the ABI (no
// codegen targets a component ABI yet); `ContractSurfaceTest` pins the method list and parameter
// names to it.

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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/**
 * Carries one call to an app instance and returns the method's JSON result.
 *
 * [query] runs a view (`kind: view` in the ABI) and [execute] a call. Both take the arguments as a
 * JSON object and return the JSON the method produced.
 */
interface ContextContractCalling {
    suspend fun query(method: String, argsJson: String): String

    suspend fun execute(method: String, argsJson: String): String
}

/** Typed calls to the contract. Views go through `query`, calls through `execute`. */
class CrmClient(private val transport: ContextContractCalling) {
    /**
     * `addActivity`: a call, sent with `execute`.
     */
    suspend fun addActivity(dealId: String? = null, contactId: String? = null, kind: String, subject: String, dueAt: ULong, owner: String? = null, note: String): String = call("addActivity", JsonObject(mapOf("dealId" to opt(dealId), "contactId" to opt(contactId), "kind" to opt(kind), "subject" to opt(subject), "dueAt" to u64(dueAt), "owner" to opt(owner), "note" to opt(note))))

    /**
     * "When a deal enters `stage_id`, schedule a `kind` activity called
     * `subject`, due in `due_in_days` days." Returns the rule's id.
     *
     * `addAutomation`: a call, sent with `execute`.
     */
    suspend fun addAutomation(stageId: String, kind: String, subject: String, dueInDays: UInt): String = call("addAutomation", JsonObject(mapOf("stageId" to opt(stageId), "kind" to opt(kind), "subject" to opt(subject), "dueInDays" to JsonPrimitive(dueInDays.toLong()))))

    /**
     * `addNote`: a call, sent with `execute`.
     */
    suspend fun addNote(dealId: String, body: String): String = call("addNote", JsonObject(mapOf("dealId" to opt(dealId), "body" to opt(body))))

    /**
     * Append a stage at the end of the pipeline. Returns its id.
     *
     * `addStage`: a call, sent with `execute`.
     */
    suspend fun addStage(name: String, probability: UInt): String = call("addStage", JsonObject(mapOf("name" to opt(name), "probability" to JsonPrimitive(probability.toLong()))))

    /**
     * `createContact`: a call, sent with `execute`.
     */
    suspend fun createContact(name: String, email: String, phone: String, organization: String, jobTitle: String): String = call("createContact", JsonObject(mapOf("name" to opt(name), "email" to opt(email), "phone" to opt(phone), "organization" to opt(organization), "jobTitle" to opt(jobTitle))))

    /**
     * Add a deal to a stage. Returns its id. Runs the stage's automations.
     *
     * `createDeal`: a call, sent with `execute`.
     */
    suspend fun createDeal(title: String, value: ULong, organization: String, contactId: String? = null, stageId: String, owner: String? = null, expectedClose: ULong? = null, source: String): String = call("createDeal", JsonObject(mapOf("title" to opt(title), "value" to u64(value), "organization" to opt(organization), "contactId" to opt(contactId), "stageId" to opt(stageId), "owner" to opt(owner), "expectedClose" to u64(expectedClose), "source" to opt(source))))

    /**
     * `deleteActivity`: a call, sent with `execute`.
     */
    suspend fun deleteActivity(activityId: String) {
        call<JsonElement>("deleteActivity", JsonObject(mapOf("activityId" to opt(activityId))))
    }

    /**
     * `deleteAutomation`: a call, sent with `execute`.
     */
    suspend fun deleteAutomation(automationId: String) {
        call<JsonElement>("deleteAutomation", JsonObject(mapOf("automationId" to opt(automationId))))
    }

    /**
     * Delete a person. Only their creator may (the creation stamp, again).
     * Deals keep their history but lose the link, so no deal points at
     * someone who no longer exists.
     *
     * `deleteContact`: a call, sent with `execute`.
     */
    suspend fun deleteContact(contactId: String) {
        call<JsonElement>("deleteContact", JsonObject(mapOf("contactId" to opt(contactId))))
    }

    /**
     * Delete a deal with its activities and all its notes. Only its creator may
     * (`APP_ERROR Forbidden` for anyone else).
     *
     * `deleteDeal`: a call, sent with `execute`.
     */
    suspend fun deleteDeal(dealId: String) {
        call<JsonElement>("deleteDeal", JsonObject(mapOf("dealId" to opt(dealId))))
    }

    /**
     * Delete a note. Only its author may (`APP_ERROR Forbidden` for anyone else).
     *
     * `deleteNote`: a call, sent with `execute`.
     */
    suspend fun deleteNote(noteId: String) {
        call<JsonElement>("deleteNote", JsonObject(mapOf("noteId" to opt(noteId))))
    }

    /**
     * Remove a stage. Refused while any open deal sits in it, and for the last
     * remaining stage — a pipeline always has somewhere to put a deal. A deal
     * moved into it concurrently is not lost: the board shows a deal whose
     * stage is gone in the first stage (see `deal_view`).
     *
     * `deleteStage`: a call, sent with `execute`.
     */
    suspend fun deleteStage(stageId: String) {
        call<JsonElement>("deleteStage", JsonObject(mapOf("stageId" to opt(stageId))))
    }

    /**
     * One deal with its person, activities (by due date) and notes (newest
     * first). Reads only that deal's rows: its activities and notes are index
     * seeks, its person one lookup.
     *
     * `getDeal`: a view, sent with `query`.
     */
    suspend fun getDeal(dealId: String): DealDetail = view("getDeal", JsonObject(mapOf("dealId" to opt(dealId))))

    /**
     * `getSettings`: a view, sent with `query`.
     */
    suspend fun getSettings(): Settings = view("getSettings", JsonObject(emptyMap()))

    /**
     * Activities, optionally for one deal and/or by done-ness, by due date.
     * One deal's activities are an index seek.
     *
     * `listActivities`: a view, sent with `query`.
     */
    suspend fun listActivities(dealId: String? = null, done: Boolean? = null): List<ActivityView> = view("listActivities", JsonObject(mapOf("dealId" to opt(dealId), "done" to opt(done))))

    /**
     * `listAutomations`: a view, sent with `query`.
     */
    suspend fun listAutomations(): List<AutomationView> = view("listAutomations", JsonObject(emptyMap()))

    /**
     * Everyone in the address book, by name, with their deal totals.
     *
     * `listContacts`: a view, sent with `query`.
     */
    suspend fun listContacts(): List<ContactView> = view("listContacts", JsonObject(emptyMap()))

    /**
     * Deals, optionally filtered by status, stage and owner, newest first.
     *
     * The most selective filter given is an index seek; the others filter
     * what it returns.
     *
     * `listDeals`: a view, sent with `query`.
     */
    suspend fun listDeals(status: String? = null, stageId: String? = null, owner: String? = null): List<DealView> = view("listDeals", JsonObject(mapOf("status" to opt(status), "stageId" to opt(stageId), "owner" to opt(owner))))

    /**
     * Stages in pipeline order.
     *
     * `listStages`: a view, sent with `query`.
     */
    suspend fun listStages(): List<StageView> = view("listStages", JsonObject(emptyMap()))

    /**
     * Close a deal as lost, with the reason (feeds the lost-reasons report).
     *
     * `markLost`: a call, sent with `execute`.
     */
    suspend fun markLost(dealId: String, reason: String) {
        call<JsonElement>("markLost", JsonObject(mapOf("dealId" to opt(dealId), "reason" to opt(reason))))
    }

    /**
     * Close a deal as won.
     *
     * `markWon`: a call, sent with `execute`.
     */
    suspend fun markWon(dealId: String) {
        call<JsonElement>("markWon", JsonObject(mapOf("dealId" to opt(dealId))))
    }

    /**
     * Move an open deal to another stage and run that stage's automations.
     * Moving to the stage it is already in is a no-op.
     *
     * `moveDeal`: a call, sent with `execute`.
     */
    suspend fun moveDeal(dealId: String, stageId: String) {
        call<JsonElement>("moveDeal", JsonObject(mapOf("dealId" to opt(dealId), "stageId" to opt(stageId))))
    }

    /**
     * Put a closed deal back on the board, in the stage it closed from.
     *
     * `reopenDeal`: a call, sent with `execute`.
     */
    suspend fun reopenDeal(dealId: String) {
        call<JsonElement>("reopenDeal", JsonObject(mapOf("dealId" to opt(dealId))))
    }

    /**
     * Reorder the pipeline. `stage_ids` must name every stage exactly once.
     *
     * `reorderStages`: a call, sent with `execute`.
     */
    suspend fun reorderStages(stageIds: List<String>) {
        call<JsonElement>("reorderStages", JsonObject(mapOf("stageIds" to JsonArray(stageIds.map { JsonPrimitive(it) }))))
    }

    /**
     * Move an activity to a new due time.
     *
     * `rescheduleActivity`: a call, sent with `execute`.
     */
    suspend fun rescheduleActivity(activityId: String, dueAt: ULong) {
        call<JsonElement>("rescheduleActivity", JsonObject(mapOf("activityId" to opt(activityId), "dueAt" to u64(dueAt))))
    }

    /**
     * Mark an activity done (or undo that).
     *
     * `setActivityDone`: a call, sent with `execute`.
     */
    suspend fun setActivityDone(activityId: String, done: Boolean) {
        call<JsonElement>("setActivityDone", JsonObject(mapOf("activityId" to opt(activityId), "done" to opt(done))))
    }

    /**
     * `setAutomationEnabled`: a call, sent with `execute`.
     */
    suspend fun setAutomationEnabled(automationId: String, enabled: Boolean) {
        call<JsonElement>("setAutomationEnabled", JsonObject(mapOf("automationId" to opt(automationId), "enabled" to opt(enabled))))
    }

    /**
     * Set the pipeline currency: a three-letter ISO 4217 code such as `EUR`.
     *
     * `setCurrency`: a call, sent with `execute`.
     */
    suspend fun setCurrency(currency: String) {
        call<JsonElement>("setCurrency", JsonObject(mapOf("currency" to opt(currency))))
    }

    /**
     * Days without activity before an open deal is flagged as rotting (1..=365).
     *
     * `setRottingDays`: a call, sent with `execute`.
     */
    suspend fun setRottingDays(days: UInt) {
        call<JsonElement>("setRottingDays", JsonObject(mapOf("days" to JsonPrimitive(days.toLong()))))
    }

    /**
     * `updateContact`: a call, sent with `execute`.
     */
    suspend fun updateContact(contactId: String, name: String, email: String, phone: String, organization: String, jobTitle: String) {
        call<JsonElement>("updateContact", JsonObject(mapOf("contactId" to opt(contactId), "name" to opt(name), "email" to opt(email), "phone" to opt(phone), "organization" to opt(organization), "jobTitle" to opt(jobTitle))))
    }

    /**
     * Edit a deal's fields. Only fields whose value differs are written, so a
     * concurrent teammate edit to another field survives.
     *
     * `updateDeal`: a call, sent with `execute`.
     */
    suspend fun updateDeal(dealId: String, title: String, value: ULong, organization: String, contactId: String? = null, owner: String? = null, expectedClose: ULong? = null, source: String) {
        call<JsonElement>("updateDeal", JsonObject(mapOf("dealId" to opt(dealId), "title" to opt(title), "value" to u64(value), "organization" to opt(organization), "contactId" to opt(contactId), "owner" to opt(owner), "expectedClose" to u64(expectedClose), "source" to opt(source))))
    }

    /**
     * Rename a stage and/or change its win probability.
     *
     * `updateStage`: a call, sent with `execute`.
     */
    suspend fun updateStage(stageId: String, name: String, probability: UInt) {
        call<JsonElement>("updateStage", JsonObject(mapOf("stageId" to opt(stageId), "name" to opt(name), "probability" to JsonPrimitive(probability.toLong()))))
    }

    private suspend inline fun <reified T> view(
        method: String,
        args: JsonObject,
    ): T = json.decodeFromString(serializer<T>(), transport.query(method, args.toString()))

    private suspend inline fun <reified T> call(
        method: String,
        args: JsonObject,
    ): T = json.decodeFromString(serializer<T>(), transport.execute(method, args.toString()))

    companion object {
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

        private val json = Json { ignoreUnknownKeys = true }

        /** A u64 argument: a decimal string; `none` an explicit null. */
        private fun u64(value: ULong?): JsonElement = value?.let { JsonPrimitive(it.toString()) } ?: JsonNull

        private fun opt(value: String?): JsonElement = value?.let { JsonPrimitive(it) } ?: JsonNull

        private fun opt(value: Boolean?): JsonElement = value?.let { JsonPrimitive(it) } ?: JsonNull
    }
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
