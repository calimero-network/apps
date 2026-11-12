// The standup contract (`logic/`, a Calimero 1.0 component): the calls are
// [network.calimero.standup.generated.StandupClient], generated from `logic/res/abi.json` by core's
// `mero-app-build codegen` (`scripts/mobile-codegen.sh` at the repo root). This file keeps the
// answer types and the method table of the web app's `app/src/standup.ts`; the iOS app's
// `StandupTypes.swift` is its twin.
//
// What the component ABI changed from v1, and how this file follows it:
// - method, argument and result names are camelCase (`postUpdate`, `fromDay`, `authorName`,
//   `nextCursor`); unknown argument keys are refused, so every optional argument is written, as
//   `null` when absent;
// - 64-bit timestamps are decimal strings (read as `ULong`, which takes a quoted number); counts
//   stay `u32` numbers;
// - accounts are the cluster's account ids, as opaque strings;
// - a refusal is the node's `APP_ERROR` with the contract's `{ code, fields }` ([StandupAppCode]).

package network.calimero.standup.contract

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.serializer

/** The JSON the contract speaks. */
val standupJson = Json { ignoreUnknownKeys = true }

/**
 * An answer of the generated [network.calimero.standup.generated.StandupClient] as the app type
 * [T]. The ABI names the standup's types without their shape until the logic derives `AbiType`, so
 * the client answers their JSON.
 */
inline fun <reified T> JsonElement.toStandup(): T = standupJson.decodeFromJsonElement(serializer<T>(), this)

/** Days with at least one update, newest first. */
@Serializable
data class DayPage(
    val days: List<DaySummary>,
    /** Pass back as `before` for the next page; `None` at the end. */
    val nextCursor: String? = null,
)

@Serializable
data class DaySummary(
    val day: String,
    /** How many members posted that day. */
    val updates: UInt,
    /** How many of those named a blocker. */
    val blocked: UInt,
)

/** Everyone's standup for one day. */
@Serializable
data class DayView(
    val day: String,
    /** Ordered by author, so every node lists them the same way. */
    val updates: List<UpdateView>,
)

@Serializable
data class DecisionPage(
    val items: List<DecisionView>,
    /** Pass back as `cursor` for the next page; `None` at the end. */
    val nextCursor: String? = null,
)

@Serializable
data class DecisionView(
    val id: String,
    val author: String,
    val authorName: String,
    val title: String,
    val decision: String,
    val rationale: String,
    /** The decision this one replaces, or "" — only when that claim holds. */
    val supersedes: String,
    /** The decision that replaced this one, or "" while it stands. */
    val supersededBy: String,
    val createdAt: ULong,
    /** v2 notes; empty for a decision logged before v2. */
    val tags: List<String>,
    val with: List<PersonView>,
    /** The standup day it came out of, or "". */
    val fromDay: String,
)

/** An offer to help with a blocker. */
@Serializable
data class HelpView(
    val account: String,
    val name: String,
    val note: String,
    val at: ULong,
)

/** Someone who has taken part: posted an update or named themselves. */
@Serializable
data class MemberView(
    val account: String,
    val name: String,
    /** The latest day they posted for, or "" if they never have. */
    val lastDay: String,
)

/** Someone named in a view, with the name they chose ("" if none). */
@Serializable
data class PersonView(
    val account: String,
    val name: String,
)

/** A tag and how many decisions carry it. */
@Serializable
data class TagCount(
    val tag: String,
    val count: UInt,
)

@Serializable
data class UpdateView(
    val day: String,
    val author: String,
    /** The author's chosen name, or "" when they have not set one. */
    val authorName: String,
    val done: String,
    val next: String,
    val blockers: String,
    val createdAt: ULong,
    val editedAt: ULong,
    /**
     * Teammates who offered to help with the blocker, oldest offer first.
     * Empty when there is no blocker.
     */
    val helpers: List<HelpView>,
)

/** The contract's methods, as `abi.json` names them. */
object StandupMethods {
    val CALLS = listOf("postUpdate", "clearUpdate", "logDecision", "offerHelp", "withdrawHelp", "setTeamName", "setName")
    val VIEWS =
        listOf(
            "whoami",
            "getDay",
            "listDays",
            "currentBlockers",
            "members",
            "getDecision",
            "listDecisions",
            "tags",
            "getWeek",
            "teamName",
            "getName",
        )
}

/** The contract's error codes (`#[app::error]`), as `APP_ERROR` carries them. */
enum class StandupAppCode(
    val code: String,
) {
    NOT_A_DATE("NotADate"),
    TOO_LONG("TooLong"),
    EMPTY("Empty"),
    TOO_MANY("TooMany"),
    NO_UPDATE("NoUpdate"),
    NO_SUCH_UPDATE("NoSuchUpdate"),
    NO_BLOCKER("NoBlocker"),
    OWN_BLOCKER("OwnBlocker"),
    NO_HELP("NoHelp"),
    NO_SUCH_DECISION("NoSuchDecision"),
    ALREADY_SUPERSEDED("AlreadySuperseded"),
    ;

    companion object {
        fun of(code: String): StandupAppCode? = entries.firstOrNull { it.code == code }
    }
}
