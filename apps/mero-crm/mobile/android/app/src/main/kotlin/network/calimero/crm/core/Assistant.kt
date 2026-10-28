package network.calimero.crm.core

import network.calimero.crm.generated.ContactView
import network.calimero.crm.generated.DealDetail
import network.calimero.crm.generated.DealView
import network.calimero.crm.generated.StageView
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToInt

/** The deal assistant: the web app's `utils/crm.ts` rules, one for one. Deterministic and local. */
enum class HealthLevel(
    val label: String,
    val word: String,
) {
    HEALTHY("On track", "healthy"),
    AT_RISK("Needs attention", "at-risk"),
    CRITICAL("At risk of slipping", "critical"),
}

data class DealHealth(
    /** 0..100 */
    val score: Int,
    val level: HealthLevel,
    /** Nothing has happened on the deal for longer than the pipeline allows. */
    val rotting: Boolean,
    /** Days since anything happened (done activity, note, stage move, creation). */
    val idleDays: Int,
    val reasons: List<String>,
    /** Stage probability, adjusted by health. */
    val winLikelihood: Int,
)

data class SuggestedActivity(
    val kind: ActivityKind,
    val subject: String,
    val dueInDays: Int,
)

enum class DealField { CONTACT, EXPECTED_CLOSE, OWNER }

data class NextAction(
    val id: String,
    val title: String,
    val why: String,
    /** When present, one tap schedules it. */
    val activity: SuggestedActivity? = null,
    /** When present, the button opens the deal's editor instead. */
    val field: DealField? = null,
) {
    /** The button's words. */
    val buttonTitle: String
        get() =
            when {
                activity == null -> "Fix"
                activity.dueInDays == 0 -> "Schedule today"
                else -> "Schedule in ${activity.dueInDays}d"
            }
}

data class EmailDraft(
    val subject: String,
    val body: String,
)

object Assistant {
    /** Most recent sign of life on a deal. */
    fun lastTouch(deal: DealView): ULong = maxOf(deal.lastTouchAt ?: 0uL, deal.stageEnteredAt, deal.createdAt)

    /** Score an open deal the way a sales manager reads the board. Closed deals are simply healthy. */
    fun health(
        deal: DealView,
        rottingDays: Int,
        now: ULong,
        zone: ZoneId,
    ): DealHealth {
        if (deal.status != "open") {
            return DealHealth(100, HealthLevel.HEALTHY, false, 0, emptyList(), deal.probability.toInt())
        }
        var score = 100
        val reasons = mutableListOf<String>()
        val today = Days.startOfDay(now, zone)
        val idle = maxOf(0, Days.between(lastTouch(deal), now, zone))
        val rotting = idle > rottingDays

        val next = deal.nextActivity
        if (next == null) {
            score -= 30
            reasons += "No next step scheduled"
        } else if (next.dueAt < today) {
            val late = Days.between(next.dueAt, now, zone)
            score -= 25
            reasons += "Next step overdue by $late day${if (late == 1) "" else "s"}"
        }
        if (rotting) {
            score -= 30
            reasons += "No activity in $idle days"
        } else if (idle.toDouble() > rottingDays.toDouble() / 2) {
            score -= 10
            reasons += "Quiet for $idle days"
        }
        val inStage = maxOf(0, Days.between(deal.stageEnteredAt, now, zone))
        if (inStage > rottingDays * 2) {
            score -= 10
            reasons += "In this stage for $inStage days"
        }
        val close = deal.expectedClose
        if (close == null) {
            score -= 5
            reasons += "No expected close date"
        } else if (close < today) {
            score -= 20
            reasons += "Expected close date has passed"
        }
        if (deal.contactId == null) {
            score -= 10
            reasons += "No contact person linked"
        }
        if (deal.owner.isNullOrEmpty()) {
            score -= 5
            reasons += "Nobody owns this deal"
        }
        score = score.coerceIn(0, 100)
        val level =
            when {
                score >= 80 -> HealthLevel.HEALTHY
                score >= 45 -> HealthLevel.AT_RISK
                else -> HealthLevel.CRITICAL
            }
        val win = (deal.probability.toDouble() * (0.5 + score.toDouble() / 200)).roundToInt()
        return DealHealth(score, level, rotting, idle, reasons, win)
    }

    /** The playbook step for where a deal sits in the pipeline (0 = first stage). */
    fun playbookStep(
        stageIndex: Int,
        stageCount: Int,
    ): SuggestedActivity {
        val phase = if (stageCount <= 1) 0.0 else stageIndex.toDouble() / (stageCount - 1)
        return when {
            phase < 0.2 -> SuggestedActivity(ActivityKind.CALL, "Discovery call: qualify need, budget and timeline", 1)
            phase < 0.45 -> SuggestedActivity(ActivityKind.MEETING, "Book a demo with the decision maker", 3)
            phase < 0.7 -> SuggestedActivity(ActivityKind.EMAIL, "Send the proposal", 2)
            phase < 0.9 -> SuggestedActivity(ActivityKind.CALL, "Follow up on the proposal", 2)
            else -> SuggestedActivity(ActivityKind.MEETING, "Agree final terms and close", 2)
        }
    }

    fun nextActions(
        deal: DealView,
        stages: List<StageView>,
        rottingDays: Int,
        now: ULong,
        zone: ZoneId,
    ): List<NextAction> {
        if (deal.status != "open") return emptyList()
        val out = mutableListOf<NextAction>()
        val health = health(deal, rottingDays, now, zone)
        val idx = maxOf(0, stages.indexOfFirst { it.id == deal.stageId })
        val today = Days.startOfDay(now, zone)
        val next = deal.nextActivity

        if (next != null && next.dueAt < today) {
            out += NextAction("overdue", "Finish or reschedule “${next.subject}”", "An overdue step tells the buyer the deal is not a priority.")
        }
        if (health.rotting) {
            out +=
                NextAction(
                    "reengage",
                    "Re-engage with a short check-in",
                    "Nothing has happened in ${health.idleDays} days. Deals that go quiet rarely come back on their own.",
                    activity = SuggestedActivity(ActivityKind.EMAIL, "Check-in: keep the conversation moving", 0),
                )
        }
        if (next == null) {
            val step = playbookStep(idx, stages.size)
            val stageName = stages.getOrNull(idx)?.name ?: "this stage"
            out += NextAction("playbook", step.subject, "The usual next step at $stageName. Every open deal should have one.", activity = step)
        }
        if (deal.contactId == null) {
            out += NextAction("contact", "Link the person you are talking to", "A deal without a contact is a deal nobody can follow up on.", field = DealField.CONTACT)
        }
        val close = deal.expectedClose
        if (close == null || close < today) {
            out +=
                NextAction(
                    "close-date",
                    if (close == null) "Set an expected close date" else "Update the slipped close date",
                    "The forecast is only as honest as its close dates.",
                    field = DealField.EXPECTED_CLOSE,
                )
        }
        if (deal.owner.isNullOrEmpty()) {
            out += NextAction("owner", "Give the deal an owner", "Shared ownership is no ownership.", field = DealField.OWNER)
        }
        val late = stages.size > 1 && idx >= floor((stages.size - 1) * 0.6).toInt()
        if (late && next != null && out.isEmpty()) {
            out +=
                NextAction(
                    "decision-maker",
                    "Confirm the decision maker and sign-off process",
                    "Late-stage deals slip on procurement, not on interest.",
                    activity = SuggestedActivity(ActivityKind.CALL, "Confirm decision process and sign-off", 3),
                )
        }
        return out
    }

    private fun firstName(name: String?): String =
        name
            ?.trim()
            ?.split(Regex("\\s+"))
            ?.firstOrNull()
            ?.ifEmpty { null } ?: "there"

    /** A short, stage-appropriate follow-up email the person can copy and edit. */
    fun followUpEmail(
        deal: DealView,
        stages: List<StageView>,
        contact: ContactView?,
        sender: String,
    ): EmailDraft {
        val idx = maxOf(0, stages.indexOfFirst { it.id == deal.stageId })
        val phase = if (stages.size <= 1) 0.0 else idx.toDouble() / (stages.size - 1)
        val org = deal.organization.ifEmpty { contact?.organization?.ifEmpty { null } ?: "your team" }
        val hi = "Hi ${firstName(contact?.name ?: deal.contactName)},"
        val sign = "\n\nBest,\n${sender.ifEmpty { "Me" }}"
        val (subject, middle) =
            when {
                phase < 0.2 ->
                    "Quick question about $org" to
                        "I'd love to learn a little more about what $org is trying to solve, and whether we're a fit. Would you have 20 minutes this week for a quick call?"
                phase < 0.45 ->
                    "Next step: a short demo for $org" to
                        "Thanks for the conversation so far. The natural next step is a 30-minute walkthrough with whoever else should weigh in. Could you suggest a couple of times that work?"
                phase < 0.7 ->
                    "Proposal for $org" to
                        "As promised, here is the proposal we discussed for \"${deal.title}\". I've kept it to what we agreed matters most. Happy to walk through it together."
                phase < 0.9 ->
                    "Following up on the proposal" to
                        "I wanted to check whether you've had a chance to review the proposal, and whether there are any questions or changes I can help with before you decide."
                else ->
                    "Finalising ${deal.title}" to
                        "We're nearly there. Is there anything left on your side, contract, sign-off or timing, that I can help unblock so we can get started?"
            }
        return EmailDraft(subject, "$hi\n\n$middle$sign")
    }

    private fun longDate(
        ms: ULong,
        zone: ZoneId,
    ): String = Instant.ofEpochMilli(ms.toLong()).atZone(zone).format(DateTimeFormatter.ofPattern("EEE MMM dd yyyy", Locale.US))

    /** Everything an AI assistant needs to coach this deal, in one paste. No ids, no keys. */
    fun coachingPrompt(
        detail: DealDetail,
        stages: List<StageView>,
        currency: String,
        rottingDays: Int,
        now: ULong,
        zone: ZoneId,
    ): String {
        val deal = detail.deal
        val health = health(deal, rottingDays, now, zone)
        val stage = stages.firstOrNull { it.id == deal.stageId }
        val reasons = if (health.reasons.isEmpty()) "" else " — " + health.reasons.joinToString("; ")
        val lines =
            mutableListOf(
                "You are an experienced B2B sales coach. Help me move this deal forward.",
                "",
                "## Deal",
                "- Title: ${deal.title}",
                "- Value: ${Money.format(deal.value, currency)}",
                "- Organization: ${deal.organization.ifEmpty { "(unknown)" }}",
                "- Stage: ${stage?.name ?: "(unknown)"} (${deal.probability}% stage probability) of ${stages.joinToString(" → ") { it.name }}",
                "- Status: ${deal.status}${if (deal.lostReason.isEmpty()) "" else " (lost: ${deal.lostReason})"}",
                "- Expected close: ${deal.expectedClose?.let { longDate(it, zone) } ?: "(not set)"}",
                "- Source: ${deal.source.ifEmpty { "(unknown)" }}",
                "- Health: ${health.score}/100 (${health.level.word})$reasons",
            )
        detail.contact?.let { c ->
            val title = if (c.jobTitle.isEmpty()) "" else ", ${c.jobTitle}"
            val org = if (c.organization.isEmpty()) "" else " at ${c.organization}"
            lines += listOf("", "## Contact", "- ${c.name}$title$org")
        }
        if (detail.activities.isNotEmpty()) {
            lines += listOf("", "## Activities")
            for (a in detail.activities.takeLast(15)) {
                val note = if (a.note.isEmpty()) "" else " — ${a.note}"
                lines += "- [${if (a.done) "done" else "open"}] ${ActivityKind.label(a.kind)}: ${a.subject} (due ${longDate(a.dueAt, zone)})$note"
            }
        }
        if (detail.notes.isNotEmpty()) {
            lines += listOf("", "## Notes (newest first)")
            for (n in detail.notes.take(10)) lines += "- ${longDate(n.createdAt, zone)}: ${n.body.trim().split(Regex("\\s+")).joinToString(" ")}"
        }
        lines +=
            listOf(
                "",
                "## What I need",
                "1. The two or three biggest risks to closing this deal, and how to address each.",
                "2. The single best next step, with a date.",
                "3. A short, specific follow-up email I can send today.",
            )
        return lines.joinToString("\n")
    }
}
