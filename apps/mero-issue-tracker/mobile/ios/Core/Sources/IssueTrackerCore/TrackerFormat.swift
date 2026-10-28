import Foundation

/// Names and fixed values shared with the web app (`app/src/config.ts`, `theme.ts`).
public enum Tracker {
    /// The registry package: what workspaces are founded with and invitation links carry.
    public static let packageName = "com.calimero.mero-issue-tracker"
    /// The board's columns, in order (the contract's statuses).
    public static let statuses = ["Open", "In progress", "Blocked", "Done"]
    /// Priorities, low to urgent (the contract's values).
    public static let priorities = ["low", "medium", "high", "urgent"]
    /// What a new issue starts at, as on the web.
    public static let defaultPriority = "high"
    /// How often to re-read while the relay's event stream is not available.
    public static let pollInterval: TimeInterval = 5
}

/// Pure presentation helpers, the twins of `app/src/utils/display.ts`, `search.ts`
/// and `fixPrompt.ts`.
public enum TrackerFormat {
    /// `issue-<ms>-<nonce>` → the first 6 of the nonce; anything else cut to 8.
    public static func shortIssueId(_ id: String) -> String {
        let parts = id.split(separator: "-", omittingEmptySubsequences: false)
        if parts.count == 3, parts[0].lowercased() == "issue", !parts[1].isEmpty,
            parts[1].allSatisfy(\.isNumber), !parts[2].isEmpty,
            parts[2].allSatisfy({ $0.isLetter || $0.isNumber })
        {
            return String(parts[2].prefix(6))
        }
        return id.count > 8 ? String(id.prefix(8)) : id
    }

    /// Compact relative time (`now`, `5m`, `2h`, `3d`, `1w`, `2mo`, `1y`) from ms or s.
    public static func relativeTime(_ value: UInt64, now: Date = Date()) -> String {
        guard value > 0 else { return "" }
        let ms = value < 1_000_000_000_000 ? Double(value) * 1000 : Double(value)
        let sec = max(0, Int(((now.timeIntervalSince1970 * 1000) - ms) / 1000))
        if sec < 60 { return "now" }
        let min = sec / 60
        if min < 60 { return "\(min)m" }
        let hr = min / 60
        if hr < 24 { return "\(hr)h" }
        let day = hr / 24
        if day < 7 { return "\(day)d" }
        let wk = day / 7
        if wk < 5 { return "\(wk)w" }
        let mo = day / 30
        if mo < 12 { return "\(mo)mo" }
        return "\(day / 365)y"
    }

    /// "5m ago", or "just now".
    public static func ago(_ value: UInt64, now: Date = Date()) -> String {
        let r = relativeTime(value, now: now)
        return r == "now" ? "just now" : "\(r) ago"
    }

    /// `4f8a…c2e1` for a hex key; anything that is not one passes through.
    public static func truncateKey(_ key: String) -> String {
        guard key.count >= 32, !key.contains(" ") else { return key }
        return "\(key.prefix(4))…\(key.suffix(4))"
    }

    /// Index into the eight label swatches, stable per label (the web's `labelColor`).
    public static func labelSwatch(_ label: String) -> Int {
        swatch(seed: "label:\(label)")
    }

    /// Index into the eight avatar swatches, stable per seed (the web's `avatarColor`).
    public static func swatch(seed: String) -> Int {
        var h: Int32 = 0
        for unit in seed.utf16 { h = h &* 31 &+ Int32(unit) }
        return Int(h.magnitude % 8)
    }

    /// Case-insensitive match over id, title, the four sections and labels.
    public static func matches(_ issue: IssueView, query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return true }
        let fields = [issue.id, issue.title, issue.summary, issue.impact, issue.repro, issue.resolutionCriteria]
        return fields.contains { $0.lowercased().contains(q) } || issue.labels.contains { $0.lowercased().contains(q) }
    }

    /// `"sync, crdt , "` → `["sync", "crdt"]`.
    public static func parseLabels(_ text: String) -> [String] {
        text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// A repository's display name from its URL: `https://github.com/acme/core.git` → `core`.
    public static func repoName(fromURL url: String) -> String? {
        var s = url.trimmingCharacters(in: .whitespacesAndNewlines)
        while s.hasSuffix("/") { s.removeLast() }
        if s.hasSuffix(".git") { s.removeLast(4) }
        guard s.contains("/"), let last = s.split(separator: "/").last, !last.isEmpty else { return nil }
        let name = String(last)
        return name.contains(":") ? nil : name
    }

    /// The "Copy fix prompt" text (keep in step with `app/src/utils/fixPrompt.ts`).
    public static func fixPrompt(_ issue: IssueView, repoURL: String?) -> String {
        let repo = repoURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let repoLine = repo.isEmpty ? "" : "\nRepository: \(repo)"
        return """
            You are fixing a tracked issue. Work systematically; do not skip validation.

            Issue \(issue.id): \(issue.title)\(repoLine)

            ## Summary
            \(issue.summary)

            ## Impact
            \(issue.impact)

            ## Repro
            \(issue.repro)

            ## Resolution criteria
            \(issue.resolutionCriteria)

            ## Instructions
            1. Reproduce first: follow the repro steps/logs above and confirm the bug exists before changing any code. If you cannot reproduce, stop and report why.
            2. Find the root cause, not the symptom. Check every caller of anything you change.
            3. Fix with the smallest correct change.
            4. Validate per this repo's AGENTS.md: choose unit tests vs merobox e2e workflow according to the bug type, add the regression test, and prove the fix against every resolution criterion above.
            5. Open a PR describing what changed and the test plan (no agent attribution anywhere).
            6. Babysit the PR: address meroreviewer comments, resolve threads without replying to them, iterate until LGTM and CI is green.
            """
    }

    /// Plain words for a failure.
    public static func errorText(_ error: Error) -> String {
        let text = String(describing: error)
        if text.contains("noRelay") {
            return "No relay serves this account yet. Join a workspace from an invitation link to get one."
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost:
                return "You are offline. Check your connection and try again."
            case .timedOut:
                return "The relay took too long to answer. Try again."
            default:
                break
            }
        }
        let described = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return described.isEmpty ? "Something went wrong. Try again." : described
    }
}
