package network.calimero.standup.core

import network.calimero.standup.generated.DecisionView
import network.calimero.standup.generated.UpdateView

/** What the update sheet edits. */
data class UpdateDraft(
    val done: String = "",
    val next: String = "",
    val blockers: String = "",
) {
    constructor(update: UpdateView) : this(update.done, update.next, update.blockers)

    /** Nothing worth posting: the contract wants at least one field. */
    val isEmpty: Boolean get() = listOf(done, next, blockers).all { it.isBlank() }

    companion object {
        /**
         * Today's starting point from your last update (the web's `carryForward`): what was NEXT
         * is most likely DONE now, and a blocker usually outlives a day. Nothing is posted until
         * you press Post.
         */
        fun carryForward(last: UpdateView?): UpdateDraft = if (last == null) UpdateDraft() else UpdateDraft(done = last.next, next = "", blockers = last.blockers)
    }
}

/** What the decision sheet edits. */
data class DecisionDraft(
    val title: String = "",
    val decision: String = "",
    val rationale: String = "",
    val tagsInput: String = "",
    val with: Set<String> = emptySet(),
    /** The standup day it came out of. */
    val fromDay: String? = null,
    /** The decision this one replaces. */
    val supersedes: DecisionView? = null,
) {
    /** The tags as the contract will store them. */
    val tags: List<String> get() = Tags.parse(tagsInput)

    /** A title and a decision: what the contract requires. */
    val isReady: Boolean get() = title.isNotBlank() && decision.isNotBlank()

    companion object {
        /** A fresh draft, carrying a superseded decision's tags and people. */
        fun start(
            fromDay: String? = null,
            supersedes: DecisionView? = null,
        ): DecisionDraft =
            DecisionDraft(
                fromDay = fromDay,
                supersedes = supersedes,
                tagsInput = supersedes?.tags?.joinToString(", ").orEmpty(),
                with =
                    supersedes
                        ?.with
                        ?.map { it.account }
                        ?.toSet()
                        .orEmpty(),
            )
    }
}

/**
 * Tags the way the contract normalizes them (the web's `lib/tags.ts`):
 * "Infra, release process" -> ["infra", "release-process"].
 */
object Tags {
    fun parse(input: String): List<String> =
        input
            .split(",")
            .map { part ->
                part
                    .trim()
                    .split(Regex("\\s+"))
                    .filter { it.isNotEmpty() }
                    .joinToString("-")
                    .lowercase()
            }.filter { it.isNotEmpty() }
            .toSortedSet()
            .toList()
}

/** Limits the contract enforces, mirrored so the sheets can say so first. */
object Limits {
    const val FIELD = 2_000
    const val TITLE = 200
    const val BODY = 5_000
    const val NAME = 64
    const val TEAM_NAME = 80
    const val HELP = 500
    const val TAGS = 8
}
