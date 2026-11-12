import Foundation
import MeroKit

// The pipeline's answers, as Mero CRM's component ABI (`../../../../logic/res/abi.json`) declares
// them: v1's snake_case fields, every u64 a decimal string both ways. The calls and the answer
// types are the generated `CrmClient` (`Sources/CrmGenerated`, `scripts/mobile-codegen.sh` at the
// repo root).

extension CrmClient {
    /// The contract's views, by ABI name.
    public static let views: Set<String> = [
        "getDeal", "getSettings", "listActivities", "listAutomations", "listContacts", "listDeals", "listStages",
    ]
    /// The contract's calls, by ABI name.
    public static let calls: Set<String> = [
        "addActivity", "addAutomation", "addNote", "addStage", "createContact", "createDeal",
        "deleteActivity", "deleteAutomation", "deleteContact", "deleteDeal", "deleteNote", "deleteStage",
        "markLost", "markWon", "moveDeal", "reopenDeal", "reorderStages", "rescheduleActivity",
        "setActivityDone", "setAutomationEnabled", "setCurrency", "setRottingDays", "updateContact",
        "updateDeal", "updateStage",
    ]
}

// MARK: - Answers

// The answer types are the generated client's. Their fields keep the contract's snake_case names
// (`stage_id`, `created_at`, ...); the app reads and writes them by the camelCase names below,
// which are those fields under the names the screens use.

public typealias ActivityView = CrmClient.ActivityView
public typealias AutomationView = CrmClient.AutomationView
public typealias ContactView = CrmClient.ContactView
public typealias DealDetail = CrmClient.DealDetail
public typealias DealView = CrmClient.DealView
public typealias NextActivity = CrmClient.NextActivity
public typealias NoteView = CrmClient.NoteView
public typealias Settings = CrmClient.Settings
public typealias StageView = CrmClient.StageView

extension CrmClient.ActivityView {
    public var dealId: String? {
        get { deal_id }
        set { deal_id = newValue }
    }
    public var dealTitle: String? {
        get { deal_title }
        set { deal_title = newValue }
    }
    public var contactId: String? {
        get { contact_id }
        set { contact_id = newValue }
    }
    public var dueAt: UInt64 {
        get { due_at }
        set { due_at = newValue }
    }
    public var doneAt: UInt64? {
        get { done_at }
        set { done_at = newValue }
    }
    public var automationId: String? {
        get { automation_id }
        set { automation_id = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension CrmClient.AutomationView {
    public var stageId: String {
        get { stage_id }
        set { stage_id = newValue }
    }
    public var dueInDays: UInt32 {
        get { due_in_days }
        set { due_in_days = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension CrmClient.ContactView {
    public var jobTitle: String {
        get { job_title }
        set { job_title = newValue }
    }
    public var openDeals: UInt32 {
        get { open_deals }
        set { open_deals = newValue }
    }
    public var wonValue: UInt64 {
        get { won_value }
        set { won_value = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension CrmClient.DealView {
    public var contactId: String? {
        get { contact_id }
        set { contact_id = newValue }
    }
    public var contactName: String? {
        get { contact_name }
        set { contact_name = newValue }
    }
    public var stageId: String {
        get { stage_id }
        set { stage_id = newValue }
    }
    public var lostReason: String {
        get { lost_reason }
        set { lost_reason = newValue }
    }
    public var expectedClose: UInt64? {
        get { expected_close }
        set { expected_close = newValue }
    }
    public var stageEnteredAt: UInt64 {
        get { stage_entered_at }
        set { stage_entered_at = newValue }
    }
    public var closedAt: UInt64? {
        get { closed_at }
        set { closed_at = newValue }
    }
    public var nextActivity: NextActivity? {
        get { next_activity }
        set { next_activity = newValue }
    }
    public var openActivities: UInt32 {
        get { open_activities }
        set { open_activities = newValue }
    }
    public var lastTouchAt: UInt64? {
        get { last_touch_at }
        set { last_touch_at = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension CrmClient.NextActivity {
    public var dueAt: UInt64 {
        get { due_at }
        set { due_at = newValue }
    }
}

extension CrmClient.NoteView {
    public var dealId: String {
        get { deal_id }
        set { deal_id = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension CrmClient.Settings {
    public var rottingDays: UInt32 {
        get { rotting_days }
        set { rotting_days = newValue }
    }
}
