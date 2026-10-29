package network.calimero.issues.core

import com.calimero.mero.account.NoRelayException
import network.calimero.issues.generated.IssueView
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Names and fixed values shared with the web app (`app/src/config.ts`, `theme.ts`). */
object Tracker {
    /** The registry package: what workspaces are founded with and invitation links carry. */
    const val PACKAGE_NAME = "com.calimero.mero-issue-tracker"

    /** The board's columns, in order (the contract's statuses). */
    val statuses = listOf("Open", "In progress", "Blocked", "Done")

    /** Priorities, low to urgent (the contract's values). */
    val priorities = listOf("low", "medium", "high", "urgent")

    /** What a new issue starts at, as on the web. */
    const val DEFAULT_PRIORITY = "high"

    /** How often to re-read while the relay's event stream is not available, in ms. */
    const val POLL_INTERVAL_MS = 5_000L
}

/** Pure presentation helpers, the twins of `app/src/utils/display.ts`, `search.ts` and `fixPrompt.ts`. */
@Suppress("TooManyFunctions")
object TrackerFormat {
    private val issueId = Regex("^issue-\\d+-([0-9a-z]+)$", RegexOption.IGNORE_CASE)

    /** `issue-<ms>-<nonce>` → the first 6 of the nonce; anything else cut to 8. */
    fun shortIssueId(id: String): String {
        issueId.find(id)?.let { return it.groupValues[1].take(6) }
        return if (id.length > 8) id.take(8) else id
    }

    /** Compact relative time (`now`, `5m`, `2h`, `3d`, `1w`, `2mo`, `1y`) from ms or s. */
    @Suppress("ReturnCount")
    fun relativeTime(
        value: Long,
        nowMs: Long = System.currentTimeMillis(),
    ): String {
        if (value <= 0) return ""
        val ms = if (value < 1_000_000_000_000L) value * 1000 else value
        val sec = maxOf(0L, (nowMs - ms) / 1000)
        if (sec < 60) return "now"
        val min = sec / 60
        if (min < 60) return "${min}m"
        val hr = min / 60
        if (hr < 24) return "${hr}h"
        val day = hr / 24
        if (day < 7) return "${day}d"
        val wk = day / 7
        if (wk < 5) return "${wk}w"
        val mo = day / 30
        if (mo < 12) return "${mo}mo"
        return "${day / 365}y"
    }

    /** "5m ago", or "just now". */
    fun ago(
        value: Long,
        nowMs: Long = System.currentTimeMillis(),
    ): String {
        val r = relativeTime(value, nowMs)
        return if (r == "now") "just now" else "$r ago"
    }

    /** `4f8a…c2e1` for a hex key; anything that is not one passes through. */
    fun truncateKey(key: String): String = if (key.length >= 32 && ' ' !in key) "${key.take(4)}…${key.takeLast(4)}" else key

    /** Index into the eight label swatches, stable per label (the web's `labelColor`). */
    fun labelSwatch(label: String): Int = swatch("label:$label")

    /** Index into the eight avatar swatches, stable per seed (the web's `avatarColor`). */
    fun swatch(seed: String): Int {
        var h = 0
        for (c in seed) h = h * 31 + c.code
        return (Math.abs(h.toLong()) % 8).toInt()
    }

    /** Case-insensitive match over id, title, the four sections and labels. */
    fun matches(
        issue: IssueView,
        query: String,
    ): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        val fields = listOf(issue.id, issue.title, issue.summary, issue.impact, issue.repro, issue.resolutionCriteria)
        return fields.any { it.lowercase().contains(q) } || issue.labels.any { it.lowercase().contains(q) }
    }

    /** `"sync, crdt , "` → `["sync", "crdt"]`. */
    fun parseLabels(text: String): List<String> = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    /** A repository's display name from its URL: `https://github.com/acme/core.git` → `core`. */
    fun repoNameFromUrl(url: String): String? {
        var s = url.trim().trimEnd('/')
        if (s.endsWith(".git")) s = s.dropLast(4)
        if ('/' !in s) return null
        val last = s.substringAfterLast('/')
        return last.takeIf { it.isNotEmpty() && ':' !in it }
    }

    /** The "Copy fix prompt" text (keep in step with `app/src/utils/fixPrompt.ts`). */
    fun fixPrompt(
        issue: IssueView,
        repoUrl: String?,
    ): String {
        val repo = repoUrl?.trim().orEmpty()
        val repoLine = if (repo.isEmpty()) "" else "\nRepository: $repo"
        return """
            |You are fixing a tracked issue. Work systematically; do not skip validation.
            |
            |Issue ${issue.id}: ${issue.title}$repoLine
            |
            |## Summary
            |${issue.summary}
            |
            |## Impact
            |${issue.impact}
            |
            |## Repro
            |${issue.repro}
            |
            |## Resolution criteria
            |${issue.resolutionCriteria}
            |
            |## Instructions
            |1. Reproduce first: follow the repro steps/logs above and confirm the bug exists before changing any code. If you cannot reproduce, stop and report why.
            |2. Find the root cause, not the symptom. Check every caller of anything you change.
            |3. Fix with the smallest correct change.
            |4. Validate per this repo's AGENTS.md: choose unit tests vs merobox e2e workflow according to the bug type, add the regression test, and prove the fix against every resolution criterion above.
            |5. Open a PR describing what changed and the test plan (no agent attribution anywhere).
            |6. Babysit the PR: address meroreviewer comments, resolve threads without replying to them, iterate until LGTM and CI is green.
            """.trimMargin()
    }

    /** Plain words for a failure. */
    fun errorText(error: Throwable): String =
        when (error) {
            is NoRelayException -> "No relay serves this account yet. Join a workspace from an invitation link to get one."
            is TrackerException -> error.message.orEmpty()
            is SocketTimeoutException -> "The relay took too long to answer. Try again."
            is UnknownHostException -> "You are offline. Check your connection and try again."
            is IOException -> error.message?.takeIf { it.isNotBlank() } ?: "You are offline. Check your connection and try again."
            else -> error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
        }
}

/** A failure the app words itself. */
class TrackerException(
    message: String,
) : Exception(message)
