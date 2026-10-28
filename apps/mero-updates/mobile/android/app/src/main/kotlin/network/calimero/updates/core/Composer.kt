package network.calimero.updates.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import network.calimero.updates.generated.AskInput
import network.calimero.updates.generated.ContributionView
import network.calimero.updates.generated.Metric
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.PostView
import network.calimero.updates.generated.Section
import network.calimero.updates.generated.UpdateInput
import java.time.Clock

/**
 * The composer's working state: what a draft stores (as JSON, in the contract's private storage)
 * and what [toInput] turns into the contract's `UpdateInput` on publish. The JSON keys are the web
 * app's (`app/src/lib/templates.ts`), so a draft saved on the web opens here and the other way round.
 */
@Serializable
data class ComposerState(
    val title: String = "",
    val summary: String = "",
    val categoryId: String = "",
    val sections: List<SectionDraft> = emptyList(),
    val metrics: List<MetricDraft> = emptyList(),
    val asks: List<AskDraft> = emptyList(),
) {
    @Serializable
    data class SectionDraft(
        val kind: String = "text",
        val title: String = "",
        val body: String = "",
    )

    @Serializable
    data class MetricDraft(
        val name: String = "",
        val value: String = "",
        val unit: String = "",
    )

    @Serializable
    data class AskDraft(
        val id: String? = null,
        val kind: String = "intro",
        val title: String = "",
        val detail: String = "",
    )

    /** The JSON a draft stores. */
    fun payload(): String = json.encodeToString(serializer(), this)

    /** What `publish_update` gets: the draft with its blanks removed. */
    fun toInput(): UpdateInput =
        UpdateInput(
            title = title.trim(),
            summary = summary.trim(),
            categoryId = categoryId,
            sections = sections.filter { it.body.isNotBlank() }.map { Section(it.kind, it.title.trim(), it.body.trim()) },
            metrics =
                metrics
                    .filter { it.name.isNotBlank() && it.value.isNotBlank() }
                    .map { Metric(it.name.trim(), it.value.trim(), it.unit.trim()) },
            asks = asks.filter { it.title.isNotBlank() }.map { AskInput(it.id, it.kind, it.title.trim(), it.detail.trim()) },
        )

    /** Why Publish is disabled, or null when it is not. */
    val publishBlocker: String?
        get() {
            if (title.isBlank()) return "Give the update a title."
            val input = toInput()
            if (input.sections.isEmpty() && input.metrics.isEmpty() && input.summary.isEmpty()) {
                return "Write at least one section, KPI or summary."
            }
            return null
        }

    companion object {
        private val json =
            Json {
                encodeDefaults = true
                explicitNulls = true
                ignoreUnknownKeys = true
                coerceInputValues = true
            }

        /** A draft's payload back, or null when it does not parse. */
        fun parse(payload: String): ComposerState? =
            runCatching {
                val element = json.parseToJsonElement(payload)
                if (element !is JsonObject) null else json.decodeFromJsonElement(serializer(), element)
            }.getOrNull()
    }
}

/** A starting shape for an update. */
data class UpdateTemplate(
    val id: String,
    val name: String,
    val description: String,
    val sections: List<SectionShape>,
    /** Pre-fill every KPI reported before, so nobody retypes last month's names. */
    val carryMetrics: Boolean,
    val suggestedAsk: Boolean,
) {
    data class SectionShape(
        val kind: String,
        val title: String,
        val placeholder: String,
    )

    companion object {
        val all =
            listOf(
                UpdateTemplate(
                    "monthly",
                    "Monthly update",
                    "The classic: highlights, lowlights, KPIs and asks.",
                    listOf(
                        SectionShape("highlights", "Highlights", "What went well this month?"),
                        SectionShape("lowlights", "Lowlights", "What didn't — and what you're doing about it."),
                        SectionShape("product", "Product", "What shipped, what's next."),
                        SectionShape("team", "Team", "Hires, departures, open roles."),
                    ),
                    carryMetrics = true,
                    suggestedAsk = true,
                ),
                UpdateTemplate(
                    "quarterly",
                    "Quarterly / board",
                    "A fuller review: financials, goals vs actuals, next quarter.",
                    listOf(
                        SectionShape("summary", "Quarter in review", "The three things that mattered."),
                        SectionShape("financial", "Financials", "Revenue, burn, runway, cash in bank."),
                        SectionShape("goals", "Goals vs actuals", "What you said you'd do, and what happened."),
                        SectionShape("next", "Next quarter", "Goals and the plan to hit them."),
                    ),
                    carryMetrics = true,
                    suggestedAsk = true,
                ),
                UpdateTemplate(
                    "fundraising",
                    "Fundraising",
                    "Announce a round, share terms, ask for intros.",
                    listOf(
                        SectionShape("round", "The round", "Amount, instrument, timing, who's leading."),
                        SectionShape("why-now", "Why now", "Traction and what the money unlocks."),
                    ),
                    carryMetrics = true,
                    suggestedAsk = true,
                ),
                UpdateTemplate(
                    "milestone",
                    "Milestone",
                    "One piece of news worth its own post.",
                    listOf(SectionShape("text", "", "What happened, and why it matters.")),
                    carryMetrics = false,
                    suggestedAsk = false,
                ),
                UpdateTemplate(
                    "blank",
                    "Blank",
                    "Start from nothing.",
                    listOf(SectionShape("text", "", "Write your update…")),
                    carryMetrics = false,
                    suggestedAsk = false,
                ),
            )

        fun of(id: String?): UpdateTemplate = all.firstOrNull { it.id == id } ?: all.first()

        /** The placeholder for a section of [kind], from whichever template defines it. */
        fun placeholder(kind: String): String = all.flatMap { it.sections }.firstOrNull { it.kind == kind }?.placeholder ?: "Write…"

        /** Sections the composer offers to add. */
        val suggestions =
            listOf(
                SectionShape("highlights", "Highlights", ""),
                SectionShape("lowlights", "Lowlights", ""),
                SectionShape("product", "Product", ""),
                SectionShape("team", "Team", ""),
                SectionShape("financial", "Financials", ""),
                SectionShape("text", "", ""),
            )
    }
}

/** The four ways into the composer, all landing in one [ComposerState]. */
sealed interface ComposerStart {
    data class Template(
        val id: String,
    ) : ComposerStart

    data object ReuseLatest : ComposerStart

    data class Draft(
        val id: String,
    ) : ComposerStart

    data class Edit(
        val id: String,
    ) : ComposerStart
}

object Composer {
    /** A fresh composer from a template; carried KPIs come with their names and units, empty values. */
    fun fromTemplate(
        template: UpdateTemplate,
        metrics: List<MetricSeries>,
        categoryId: String = "",
        clock: Clock = Clock.systemDefaultZone(),
    ) = ComposerState(
        title = if (template.id == "monthly") Format.monthTitle(clock) else "",
        summary = "",
        categoryId = categoryId,
        sections = template.sections.map { ComposerState.SectionDraft(it.kind, it.title, "") },
        metrics = if (template.carryMetrics) metrics.map { ComposerState.MetricDraft(it.name, "", it.unit) } else emptyList(),
        asks = if (template.suggestedAsk) listOf(ComposerState.AskDraft(null, "intro", "", "")) else emptyList(),
    )

    /** "Reuse the last one": headings and KPI names carry over, the words and numbers do not. */
    fun fromPrevious(
        post: PostView,
        clock: Clock = Clock.systemDefaultZone(),
    ) = ComposerState(
        title = Format.monthTitle(clock),
        summary = "",
        categoryId = post.card.categoryId,
        sections = post.sections.map { ComposerState.SectionDraft(it.kind, it.title, "") },
        metrics = post.metrics.map { ComposerState.MetricDraft(it.name, "", it.unit) },
        asks = emptyList(),
    )

    /** A published update, loaded for editing in place. */
    fun fromPost(post: PostView) =
        ComposerState(
            title = post.card.title,
            summary = post.card.summary,
            categoryId = post.card.categoryId,
            sections = post.sections.map { ComposerState.SectionDraft(it.kind, it.title, it.body) },
            metrics = post.metrics.map { ComposerState.MetricDraft(it.name, it.value, it.unit) },
            asks = post.asks.map { ComposerState.AskDraft(it.id, it.kind, it.title, it.detail) },
        )

    /** One "Thank you" section naming everyone whose offer was accepted since the last update. */
    fun thanksSection(contributions: List<ContributionView>): ComposerState.SectionDraft? {
        if (contributions.isEmpty()) return null
        val lines =
            contributions.map { c ->
                val who = People.label(c.name, c.account) + if (c.firm.isEmpty()) "" else " (${c.firm})"
                "• $who — ${AskKind.of(c.askKind).label.lowercase()}: ${c.askTitle}"
            }
        return ComposerState.SectionDraft("thanks", "Thank you", lines.joinToString("\n"))
    }
}
