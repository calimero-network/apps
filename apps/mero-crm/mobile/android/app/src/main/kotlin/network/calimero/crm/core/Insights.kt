package network.calimero.crm.core

import network.calimero.crm.generated.ActivityView
import network.calimero.crm.generated.ContactView
import network.calimero.crm.generated.DealView
import network.calimero.crm.generated.StageView
import java.time.Instant
import java.time.Month
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

data class StageStat(
    val stage: StageView,
    val count: Int,
    val value: ULong,
    val weighted: ULong,
)

data class ForecastMonth(
    val label: String,
    val value: ULong,
    val weighted: ULong,
)

data class OwnerStat(
    /** As stored; label with the model's `ownerLabel`. "" is unassigned. */
    val owner: String,
    val wonValue: ULong,
    val openValue: ULong,
    val wonCount: Int,
)

data class ReasonCount(
    val reason: String,
    val count: Int,
)

/** The Insights page's numbers (the web's `computeStats`). */
data class PipelineStats(
    val openCount: Int,
    val openValue: ULong,
    val weightedValue: ULong,
    val wonCount: Int,
    val wonValue: ULong,
    val lostCount: Int,
    val lostValue: ULong,
    /** 0..100, or null before anything has closed. */
    val winRate: Int?,
    val avgWonValue: ULong?,
    val avgCycleDays: Int?,
    val wonThisMonth: ULong,
    val perStage: List<StageStat>,
    val lostReasons: List<ReasonCount>,
    val byOwner: List<OwnerStat>,
    /** Open value by expected-close month, this month and the next five, plus undated. */
    val forecast: List<ForecastMonth>,
)

enum class ActivityBucket(
    val title: String,
    /** Shown under an empty section; null hides the section when empty. */
    val emptyText: String?,
) {
    OVERDUE("Overdue", null),
    TODAY("Today", "Nothing due today."),
    UPCOMING("Upcoming", "Nothing scheduled ahead."),
    DONE("Recently done", null),
}

/** A company: the organization named on people and deals, gathered. */
data class Company(
    val name: String,
    val people: List<ContactView>,
    val deals: List<DealView>,
) {
    val id: String get() = Insights.companyKey(name)
    val openDeals: List<DealView> get() = deals.filter { it.status == "open" }
    val openValue: ULong get() = openDeals.sumOf { it.value }
    val wonValue: ULong get() = deals.filter { it.status == "won" }.sumOf { it.value }
}

object Insights {
    fun weighted(deal: DealView): ULong = (deal.value.toDouble() * deal.probability.toDouble() / 100).roundToLong().toULong()

    private fun sum(xs: List<DealView>): ULong = xs.sumOf { it.value }

    private fun wsum(xs: List<DealView>): ULong = xs.sumOf { weighted(it) }

    fun stats(
        deals: List<DealView>,
        stages: List<StageView>,
        now: ULong,
        zone: ZoneId,
        locale: Locale = Locale.getDefault(),
    ): PipelineStats {
        val open = deals.filter { it.status == "open" }
        val won = deals.filter { it.status == "won" }
        val lost = deals.filter { it.status == "lost" }
        val monthStart =
            Instant
                .ofEpochMilli(now.toLong())
                .atZone(zone)
                .toLocalDate()
                .withDayOfMonth(1)
        val monthStartMs = Days.atTime(monthStart, 0, zone)
        val cycles = won.mapNotNull { d -> d.closedAt?.let { maxOf(0, Days.between(d.createdAt, it, zone)) } }

        val reasons = LinkedHashMap<String, Int>()
        for (d in lost) {
            val key = d.lostReason.trim().ifEmpty { "No reason given" }
            reasons[key] = (reasons[key] ?: 0) + 1
        }

        val owners = LinkedHashMap<String, OwnerStat>()
        for (d in deals) {
            if (d.status == "lost") continue
            val key = d.owner.orEmpty()
            val o = owners[key] ?: OwnerStat(key, 0uL, 0uL, 0)
            owners[key] =
                if (d.status == "won") {
                    o.copy(wonValue = o.wonValue + d.value, wonCount = o.wonCount + 1)
                } else {
                    o.copy(openValue = o.openValue + d.value)
                }
        }

        val forecast = mutableListOf<ForecastMonth>()
        for (i in 0 until FORECAST_MONTHS) {
            val start = monthStart.plusMonths(i.toLong())
            val startMs = Days.atTime(start, 0, zone)
            val endMs = Days.atTime(start.plusMonths(1), 0, zone)
            val inMonth =
                open.filter { d ->
                    val c = d.expectedClose ?: return@filter false
                    // Slipped dates count in the current month: they are due now, not never.
                    if (i == 0) c < endMs else c in startMs until endMs
                }
            val withYear = i == 0 || start.month == Month.JANUARY
            val label = start.format(DateTimeFormatter.ofPattern(if (withYear) "MMM yy" else "MMM", locale))
            forecast += ForecastMonth(label, sum(inMonth), wsum(inMonth))
        }
        val undated = open.filter { it.expectedClose == null }
        if (undated.isNotEmpty()) forecast += ForecastMonth("No date", sum(undated), wsum(undated))

        val closed = won.size + lost.size
        return PipelineStats(
            openCount = open.size,
            openValue = sum(open),
            weightedValue = wsum(open),
            wonCount = won.size,
            wonValue = sum(won),
            lostCount = lost.size,
            lostValue = sum(lost),
            winRate = if (closed > 0) (won.size.toDouble() / closed * 100).roundToInt() else null,
            avgWonValue = if (won.isEmpty()) null else (sum(won).toDouble() / won.size).roundToLong().toULong(),
            avgCycleDays = if (cycles.isEmpty()) null else (cycles.sum().toDouble() / cycles.size).roundToInt(),
            wonThisMonth = sum(won.filter { (it.closedAt ?: 0uL) >= monthStartMs }),
            perStage =
                stages.map { stage ->
                    val inStage = open.filter { it.stageId == stage.id }
                    StageStat(stage, inStage.size, sum(inStage), wsum(inStage))
                },
            lostReasons = reasons.map { ReasonCount(it.key, it.value) }.sortedByDescending { it.count },
            byOwner = owners.values.sortedWith(compareByDescending<OwnerStat> { it.wonValue }.thenByDescending { it.openValue }),
            forecast = forecast,
        )
    }

    /** The to-do list, grouped by when each is due. Done newest first. */
    fun buckets(
        list: List<ActivityView>,
        now: ULong,
        zone: ZoneId,
    ): Map<ActivityBucket, List<ActivityView>> {
        val today = Days.startOfDay(now, zone)
        val tomorrow = Days.atTime(Days.localDate(now, zone).plusDays(1), 0, zone)
        val out = ActivityBucket.entries.associateWith { mutableListOf<ActivityView>() }
        for (a in list) {
            val bucket =
                when {
                    a.done -> ActivityBucket.DONE
                    a.dueAt < today -> ActivityBucket.OVERDUE
                    a.dueAt < tomorrow -> ActivityBucket.TODAY
                    else -> ActivityBucket.UPCOMING
                }
            out.getValue(bucket) += a
        }
        return out.mapValues { (bucket, items) ->
            if (bucket == ActivityBucket.DONE) items.sortedByDescending { it.doneAt ?: 0uL } else items.sortedBy { it.dueAt }
        }
    }

    fun dealMatches(
        deal: DealView,
        query: String,
        ownerLabel: (String?) -> String = { it.orEmpty() },
    ): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        return listOf(deal.title, deal.organization, deal.contactName.orEmpty(), ownerLabel(deal.owner), deal.source)
            .any { it.lowercase().contains(q) }
    }

    fun contactMatches(
        c: ContactView,
        query: String,
    ): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        return listOf(c.name, c.email, c.phone, c.organization, c.jobTitle).any { it.lowercase().contains(q) }
    }

    fun activityMatches(
        a: ActivityView,
        query: String,
    ): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        return a.subject.lowercase().contains(q) ||
            a.dealTitle
                .orEmpty()
                .lowercase()
                .contains(q)
    }

    fun companyKey(name: String): String = name.trim().lowercase()

    /** Every organization named on a person or a deal, with its people and deals, by name. */
    fun companies(
        contacts: List<ContactView>,
        deals: List<DealView>,
    ): List<Company> {
        val names = LinkedHashMap<String, String>()
        val people = HashMap<String, MutableList<ContactView>>()
        val dealsBy = HashMap<String, MutableList<DealView>>()
        for (c in contacts) {
            val key = companyKey(c.organization)
            if (key.isEmpty()) continue
            names.putIfAbsent(key, c.organization.trim())
            people.getOrPut(key) { mutableListOf() } += c
        }
        for (d in deals) {
            val key = companyKey(d.organization)
            if (key.isEmpty()) continue
            names.putIfAbsent(key, d.organization.trim())
            dealsBy.getOrPut(key) { mutableListOf() } += d
        }
        return names
            .map { (key, name) ->
                Company(
                    name,
                    people[key].orEmpty().sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }),
                    dealsBy[key].orEmpty().sortedByDescending { it.createdAt },
                )
            }.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
    }

    fun companyMatches(
        c: Company,
        query: String,
    ): Boolean {
        val q = query.trim().lowercase()
        return q.isEmpty() || c.name.lowercase().contains(q)
    }

    private const val FORECAST_MONTHS = 6
}
