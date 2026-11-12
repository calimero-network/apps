// The pipeline's answers, as Mero CRM's component ABI (`logic/res/abi.json`) declares them: v1's
// snake_case fields, every u64 a decimal string both ways. The calls and the answer types are the
// generated [CrmClient] (`scripts/mobile-codegen.sh` at the repo root).

package network.calimero.crm.generated

import network.calimero.crm.generated.client.CrmClient

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
}

// The answer types are the generated client's ([CrmClient]). Their fields keep the contract's
// snake_case names (`stage_id`, `created_at`, ...); the app reads them by the camelCase names
// below, which are those fields under the names the screens use.

typealias ActivityView = CrmClient.ActivityView

typealias AutomationView = CrmClient.AutomationView

typealias ContactView = CrmClient.ContactView

typealias DealDetail = CrmClient.DealDetail

typealias DealView = CrmClient.DealView

typealias NextActivity = CrmClient.NextActivity

typealias NoteView = CrmClient.NoteView

typealias Settings = CrmClient.Settings

typealias StageView = CrmClient.StageView

val CrmClient.ActivityView.dealId: String? get() = deal_id

val CrmClient.ActivityView.dealTitle: String? get() = deal_title

val CrmClient.ActivityView.contactId: String? get() = contact_id

val CrmClient.ActivityView.dueAt: ULong get() = due_at

val CrmClient.ActivityView.doneAt: ULong? get() = done_at

val CrmClient.ActivityView.automationId: String? get() = automation_id

val CrmClient.ActivityView.createdBy: String get() = created_by

val CrmClient.ActivityView.createdAt: ULong get() = created_at

val CrmClient.AutomationView.stageId: String get() = stage_id

val CrmClient.AutomationView.dueInDays: UInt get() = due_in_days

val CrmClient.AutomationView.createdBy: String get() = created_by

val CrmClient.AutomationView.createdAt: ULong get() = created_at

val CrmClient.ContactView.jobTitle: String get() = job_title

val CrmClient.ContactView.openDeals: UInt get() = open_deals

val CrmClient.ContactView.wonValue: ULong get() = won_value

val CrmClient.ContactView.createdBy: String get() = created_by

val CrmClient.ContactView.createdAt: ULong get() = created_at

val CrmClient.DealView.contactId: String? get() = contact_id

val CrmClient.DealView.contactName: String? get() = contact_name

val CrmClient.DealView.stageId: String get() = stage_id

val CrmClient.DealView.lostReason: String get() = lost_reason

val CrmClient.DealView.expectedClose: ULong? get() = expected_close

val CrmClient.DealView.stageEnteredAt: ULong get() = stage_entered_at

val CrmClient.DealView.closedAt: ULong? get() = closed_at

val CrmClient.DealView.nextActivity: NextActivity? get() = next_activity

val CrmClient.DealView.openActivities: UInt get() = open_activities

val CrmClient.DealView.lastTouchAt: ULong? get() = last_touch_at

val CrmClient.DealView.createdBy: String get() = created_by

val CrmClient.DealView.createdAt: ULong get() = created_at

val CrmClient.NextActivity.dueAt: ULong get() = due_at

val CrmClient.NoteView.dealId: String get() = deal_id

val CrmClient.NoteView.createdAt: ULong get() = created_at

val CrmClient.Settings.rottingDays: UInt get() = rotting_days
