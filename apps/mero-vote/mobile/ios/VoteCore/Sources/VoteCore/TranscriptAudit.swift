import Foundation
import VoteCrypto

/// One line of an audit: what was checked, whether it held, and the detail.
public struct AuditCheck: Equatable, Sendable, Identifiable {
    public let name: String
    public let ok: Bool
    public let detail: String
    public var id: String { name }

    public init(name: String, ok: Bool, detail: String) {
        self.name = name
        self.ok = ok
        self.detail = detail
    }
}

/// What re-verifying a transcript on this device came to.
public struct LocalAudit: Equatable, Sendable {
    public let checks: [AuditCheck]
    public let verified: Bool
    public let counts: [UInt64]?
    public let digest: String?
    /// Counts and digest equal what the node reported.
    public let agreesWithNode: Bool
}

/// An independent re-count, on this device, from a transcript alone: a port
/// of the web's `crypto/verify.ts`, check for check and word for word (the
/// web says "in this browser", this says "on this device").
///
/// `get_result` already re-verifies everything on a member's node. This is for
/// the member who does not want to trust even that: it takes the raw inputs
/// (`get_transcript`) and redoes every check with a second implementation. If
/// it agrees with the node (same counts, same transcript digest) neither
/// implementation can be quietly wrong on its own.
public enum TranscriptAudit {
    /// Must equal `transcript_text` in the contract, byte for byte.
    public static func transcriptText(
        pollId: String, definition def: PollDefinition, election: Election, counted: [CountedBallot], counts: [UInt64]
    ) -> String {
        func hexUtf8(_ s: String) -> String { Hex.encode(Array(s.utf8)) }
        var out = "mero-vote/v2/transcript\n"
        out += "poll \(pollId)\n"
        out += "title \(hexUtf8(def.title))\n"
        for (i, o) in def.options.enumerated() { out += "option \(i) \(hexUtf8(o))\n" }
        out += "rules \(def.options.count) \(def.minChoices) \(def.maxChoices)\n"
        out += "threshold \(election.threshold) \(def.trustees.count)\n"
        for (i, t) in def.trustees.enumerated() { out += "trustee \(i + 1) \(t)\n" }
        for q in election.qualified { out += "dealer \(q.dealer) \(q.dealing.commitments.joined(separator: " "))\n" }
        for d in election.disqualified { out += "disqualified \(d)\n" }
        out += "key \(election.key)\n"
        for b in counted { out += "ballot \(b.voter) \(b.digest)\n" }
        for (j, n) in counts.enumerated() { out += "count \(j) \(n)\n" }
        return out
    }

    public static func digest(_ text: String) -> String { VoteProtocol.sha256Hex(text) }

    public static func verify(_ t: Transcript) -> LocalAudit {
        var checks: [AuditCheck] = []
        func push(_ name: String, _ ok: Bool, _ detail: String) {
            checks.append(AuditCheck(name: name, ok: ok, detail: detail))
        }
        func done(_ counts: [UInt64]?, _ digest: String?) -> LocalAudit {
            let verified = checks.allSatisfy(\.ok)
            let c = verified ? counts : nil
            let d = verified ? digest : nil
            let node = t.report
            let agrees = node.verified == verified && node.counts == c && node.transcriptDigest == d
            return LocalAudit(checks: checks, verified: verified, counts: c, digest: d, agreesWithNode: agrees)
        }

        let def = t.definition
        let rules = VoteWire.rules(def)
        let pollId = t.pollId
        push("protocol", t.protocol == VoteProtocol.tag, t.protocol)
        let n = def.trustees.count
        let threshold = Int(def.threshold)

        guard let election = t.state.election else {
            push("election key", true, "key ceremony in progress")
            return done(nil, nil)
        }

        // 1. Dealings and key.
        var dealings: [Dealing] = []
        var dealingsOk = Int(election.threshold) == threshold && election.qualified.count >= threshold
        var last = 0
        for q in election.qualified {
            let idx = (def.trustees.firstIndex(of: q.dealer) ?? -1) + 1
            if idx <= last { dealingsOk = false }
            last = idx
            do {
                let d = try VoteWire.dealing(q.dealing)
                try VoteProtocol.verifyDealing(pollId: pollId, dealer: q.dealer, threshold: threshold, trustees: n, d)
                dealings.append(d)
            } catch {
                dealingsOk = false
            }
        }
        push("dealings", dealingsOk, "\(election.qualified.count) qualified dealings (threshold \(threshold)), each proven")
        let keyOk = dealingsOk && VoteProtocol.jointKey(dealings).hex == election.key
        push("election key", keyOk, "key = sum of qualified constant terms")
        guard let pk = try? VoteWire.point(election.key, "election key") else { return done(nil, nil) }

        // 2. Ballots.
        guard let closure = t.state.closure else {
            push("ballots", true, t.state.phase == .closing ? "closing — the count is not sealed yet" : "voting in progress")
            return done(nil, nil)
        }
        let eligible = { (v: String) in def.voters.isEmpty || def.voters.contains(v) }
        var agg = [Ciphertext](repeating: .zero, count: rules.options)
        var valid = 0
        var seen = Set<String>()
        for cb in closure.counted {
            do {
                guard let tb = t.ballots.first(where: { $0.voter == cb.voter && $0.digest == cb.digest }) else {
                    throw VoteCryptoError("missing")
                }
                guard eligible(cb.voter), !seen.contains(cb.voter) else { throw VoteCryptoError("ineligible or duplicate") }
                seen.insert(cb.voter)
                let ballot = try VoteWire.ballot(tb.ballot)
                try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: cb.voter, rules: rules, ballot: ballot)
                guard VoteProtocol.ballotDigest(pollId: pollId, voter: cb.voter, ballot: ballot) == cb.digest else {
                    throw VoteCryptoError("digest")
                }
                agg = zip(agg, ballot.choices).map { $0 + $1.ct }
                valid += 1
            } catch {
                // counted as invalid below
            }
        }
        let counted = closure.counted.count
        push("ballot proofs", valid == counted, "\(valid) of \(counted) counted ballots verified on this device")

        // 3. Partials and counts. Robust, like the node: an unproven partial is
        //    set aside, and the `t` lowest-indexed good ones are combined.
        var good: [(index: Int, ds: [RistrettoPoint])] = []
        var rejected: [String] = []
        for p in t.partials.sorted(by: { $0.index < $1.index }) {
            let index = (def.trustees.firstIndex(of: p.trustee) ?? -1) + 1
            do {
                guard index == Int(p.index), index != 0, p.options.count == agg.count else { throw VoteCryptoError("shape") }
                let vkey = VoteProtocol.verificationKey(dealings, index: index)
                let ds = try p.options.enumerated().map { j, o -> RistrettoPoint in
                    let d = try VoteWire.point(o.d, "partial")
                    guard VoteProtocol.verifyPartial(
                        pollId: pollId, trustee: p.trustee, option: j, vkey: vkey, aggA: agg[j].a, d: d,
                        proof: try VoteWire.branch(o.proof))
                    else { throw VoteCryptoError("proof") }
                    return d
                }
                good.append((index, ds))
            } catch {
                rejected.append(p.trustee)
            }
        }
        push(
            "partial decryptions", true,
            "\(good.count) of \(threshold) needed" + (rejected.isEmpty ? "" : "; set aside as unproven: \(rejected.joined(separator: ", "))"))
        guard good.count >= threshold, checks.allSatisfy(\.ok) else { return done(nil, nil) }

        let used = Array(good.prefix(threshold))
        let opened = agg.enumerated().map { j, ct in
            VoteProtocol.openCount(ct, partials: used.map { ($0.index, $0.ds[j]) }, max: counted)
        }
        let all = opened.compactMap { $0 }
        let total = all.reduce(0, +)
        let sumOk = all.count == opened.count && total >= counted * Int(def.minChoices) && total <= counted * Int(def.maxChoices)
        push("decryption", sumOk, "every option decrypts to a count within 0..=ballots")
        guard sumOk else { return done(nil, nil) }
        let counts = all.map { UInt64($0) }

        let digest = digest(transcriptText(pollId: pollId, definition: def, election: election, counted: closure.counted, counts: counts))
        if let anchor = t.state.anchor {
            push("anchor", anchor.digest == digest, "anchored on \(anchor.network): \(anchor.reference)")
        }
        return done(counts, digest)
    }
}
