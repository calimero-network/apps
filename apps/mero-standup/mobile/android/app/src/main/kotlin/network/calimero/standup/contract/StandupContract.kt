// The standup contract (`logic/`, a Calimero 1.0 component): the calls are [StandupClient],
// generated from `logic/res/abi.json` by core's `meroctl app codegen` (`scripts/mobile-codegen.sh`
// at the repo root), and so are the answer types. This file keeps the method table of the web app's
// `app/src/standup.ts`; the iOS app's `StandupTypes.swift` is its twin.
//
// What the component ABI changed from v1, and how this file follows it:
// - method, argument and result names are camelCase (`postUpdate`, `fromDay`, `authorName`,
//   `nextCursor`); unknown argument keys are refused, so every optional argument is written, as
//   `null` when absent;
// - 64-bit timestamps are decimal strings (`ULong` in the generated types); counts stay `u32`
//   numbers;
// - accounts are the cluster's account ids, as opaque strings;
// - a refusal is the node's `APP_ERROR` with the contract's `{ code, fields }` ([StandupAppCode]).

package network.calimero.standup.contract

import network.calimero.standup.generated.StandupClient

// The answer types are the generated client's ([StandupClient], from the ABI).

/** Days with at least one update, newest first; pass `nextCursor` back as `before`. */
typealias DayPage = StandupClient.DayPage

/** A day's count of updates, and of those that named a blocker. */
typealias DaySummary = StandupClient.DaySummary

/** Everyone's standup for one day, ordered by author. */
typealias DayView = StandupClient.DayView

/** A page of decisions; pass `nextCursor` back as `cursor`. */
typealias DecisionPage = StandupClient.DecisionPage

typealias DecisionView = StandupClient.DecisionView

/** An offer to help with a blocker. */
typealias HelpView = StandupClient.HelpView

/** Someone who has taken part: posted an update or named themselves. */
typealias MemberView = StandupClient.MemberView

/** Someone named in a view, with the name they chose ("" if none). */
typealias PersonView = StandupClient.PersonView

/** A tag and how many decisions carry it. */
typealias TagCount = StandupClient.TagCount

typealias UpdateView = StandupClient.UpdateView

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
