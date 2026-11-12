// The standup contract (`logic/`, a Calimero 1.0 component): the calls are `StandupClient`,
// generated from `logic/res/abi.json` into `Generated/` by core's `mero-app-build codegen`
// (`scripts/mobile-codegen.sh` at the repo root), and so are the answer types. This file keeps the
// method table of the web app's `app/src/standup.ts`; the Android app's
// `contract/StandupContract.kt` is its twin.
//
// What the component ABI changed from v1, and how this file follows it:
// - method, argument and result names are camelCase (`postUpdate`, `fromDay`,
//   `authorName`, `nextCursor`); unknown argument keys are refused, so every
//   optional argument is written, as `null` when absent;
// - 64-bit timestamps are decimal strings (`UInt64` in the generated types);
//   counts stay `u32` numbers;
// - accounts are the cluster's account ids, as opaque strings;
// - a refusal is the node's `APP_ERROR` with the contract's `{ code, fields }`
//   (`StandupAppCode`), which `ErrorText` puts into words.

import Foundation
import MeroKit

// MARK: - Types

// The answer types are the generated client's (`Generated/StandupClient.swift`, from the ABI).

/// Days with at least one update, newest first; pass `nextCursor` back as `before`.
public typealias DayPage = StandupClient.DayPage
/// A day's count of updates, and of those that named a blocker.
public typealias DaySummary = StandupClient.DaySummary
/// Everyone's standup for one day, ordered by author.
public typealias DayView = StandupClient.DayView
/// A page of decisions; pass `nextCursor` back as `cursor`.
public typealias DecisionPage = StandupClient.DecisionPage
public typealias DecisionView = StandupClient.DecisionView
/// An offer to help with a blocker.
public typealias HelpView = StandupClient.HelpView
/// Someone who has taken part: posted an update or named themselves.
public typealias MemberView = StandupClient.MemberView
/// Someone named in a view, with the name they chose ("" if none).
public typealias PersonView = StandupClient.PersonView
/// A tag and how many decisions carry it.
public typealias TagCount = StandupClient.TagCount
public typealias UpdateView = StandupClient.UpdateView

// MARK: - The component ABI's details

/// The contract's methods, as `abi.json` names them.
public enum StandupMethods {
    public static let calls = ["postUpdate", "clearUpdate", "logDecision", "offerHelp", "withdrawHelp", "setTeamName", "setName"]
    public static let views = [
        "whoami", "getDay", "listDays", "currentBlockers", "members", "getDecision", "listDecisions", "tags", "getWeek",
        "teamName", "getName",
    ]
}

/// The contract's error codes (`#[app::error]`), as `APP_ERROR` carries them.
public enum StandupAppCode: String, Sendable, CaseIterable {
    case notADate = "NotADate"
    case tooLong = "TooLong"
    case empty = "Empty"
    case tooMany = "TooMany"
    case noUpdate = "NoUpdate"
    case noSuchUpdate = "NoSuchUpdate"
    case noBlocker = "NoBlocker"
    case ownBlocker = "OwnBlocker"
    case noHelp = "NoHelp"
    case noSuchDecision = "NoSuchDecision"
    case alreadySuperseded = "AlreadySuperseded"
}
