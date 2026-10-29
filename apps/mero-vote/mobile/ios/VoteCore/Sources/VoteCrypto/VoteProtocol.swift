import CryptoKit
import Foundation
import Security

// mero-vote's ballot cryptography: a line-for-line port of the web client's
// `app/src/crypto/protocol.ts`, which is itself a mirror of the contract's
// Rust (`logic/crates/crypto`). Exponential ElGamal on ristretto255, CDS94
// membership proofs, Chaum–Pedersen DLEQ, Schnorr proofs of knowledge,
// Pedersen DKG with Feldman commitments, Fiat–Shamir over SHA-512.
//
// The order in which every prover draws from `rng` is part of the wire
// format; keep it identical to protocol.ts. Kotlin `VoteProtocol.kt` is the
// same code.

public typealias Rng = () -> Scalar

public struct Branch: Equatable, Sendable {
    public var c: Scalar
    public var z: Scalar

    public init(c: Scalar, z: Scalar) {
        self.c = c
        self.z = z
    }
}

public struct Ciphertext: Sendable {
    public var a: RistrettoPoint
    public var b: RistrettoPoint

    public init(a: RistrettoPoint, b: RistrettoPoint) {
        self.a = a
        self.b = b
    }

    public static let zero = Ciphertext(a: .identity, b: .identity)

    public static func + (x: Ciphertext, y: Ciphertext) -> Ciphertext { Ciphertext(a: x.a + y.a, b: x.b + y.b) }
}

public struct EncryptedChoice: Sendable {
    public var ct: Ciphertext
    public var proof: [Branch]

    public init(ct: Ciphertext, proof: [Branch]) {
        self.ct = ct
        self.proof = proof
    }
}

public struct Ballot: Sendable {
    public var choices: [EncryptedChoice]
    public var sumProof: [Branch]

    public init(choices: [EncryptedChoice], sumProof: [Branch]) {
        self.choices = choices
        self.sumProof = sumProof
    }
}

public struct EncryptedShare: Sendable {
    public var r: RistrettoPoint
    public var v: Scalar

    public init(r: RistrettoPoint, v: Scalar) {
        self.r = r
        self.v = v
    }
}

public struct Dealing: Sendable {
    public var commitments: [RistrettoPoint]
    public var proof: Branch
    public var shares: [EncryptedShare]

    public init(commitments: [RistrettoPoint], proof: Branch, shares: [EncryptedShare]) {
        self.commitments = commitments
        self.proof = proof
        self.shares = shares
    }
}

/// A poll's choice rules: how many options, and how many a voter may pick.
public struct Rules: Equatable, Sendable {
    public var options: Int
    public var min: Int
    public var max: Int

    public init(options: Int, min: Int, max: Int) {
        self.options = options
        self.min = min
        self.max = max
    }
}

public struct VoteCryptoError: Error, LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public enum VoteProtocol {
    public static let tag = "mero-vote/v2/"
    public static let maxOptions = 16

    static let g = RistrettoPoint.base

    // MARK: bytes

    static func utf8(_ s: String) -> [UInt8] { Array(s.utf8) }

    static func u32le(_ n: Int) -> [UInt8] {
        let v = UInt32(truncatingIfNeeded: n)
        return (0..<4).map { UInt8(truncatingIfNeeded: v >> (8 * UInt32($0))) }
    }

    static func u64le(_ n: UInt64) -> [UInt8] {
        (0..<8).map { UInt8(truncatingIfNeeded: n >> (8 * UInt64($0))) }
    }

    // MARK: hashing

    static func framed(_ domain: String, _ parts: [[UInt8]]) -> [UInt8] {
        var out = utf8(tag) + utf8(domain) + [0]
        for p in parts {
            out += u32le(p.count)
            out += p
        }
        return out
    }

    public static func hashToScalar(_ domain: String, _ parts: [[UInt8]]) -> Scalar {
        Scalar(reducing: Array(SHA512.hash(data: framed(domain, parts))))
    }

    public static func hashToDigest(_ domain: String, _ parts: [[UInt8]]) -> [UInt8] {
        Array(SHA256.hash(data: framed(domain, parts)))
    }

    public static func sha256Hex(_ text: String) -> String {
        Hex.encode(SHA256.hash(data: Data(text.utf8)))
    }

    /// Deterministic stream, for tests only. Mirrors `seededRng`.
    public static func seededRng(_ seed: String) -> Rng {
        let s = utf8(seed)
        var k: UInt64 = 0
        return {
            defer { k += 1 }
            return hashToScalar("test-rng", [s, u64le(k)])
        }
    }

    /// ``seededRng(_:)`` safe to hand across tasks, for view-model tests.
    public static func seededRngSendable(_ seed: String) -> @Sendable () -> Scalar {
        let stream = SeededStream(seed)
        return { stream.next() }
    }

    /// 64 uniform bytes from the system CSPRNG, reduced mod ℓ (bias < 2⁻²⁵⁰).
    public static func secureRng() -> Scalar {
        var b = [UInt8](repeating: 0, count: 64)
        let status = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
        precondition(status == errSecSuccess, "the system random generator failed")
        return Scalar(reducing: b)
    }

    // MARK: ElGamal

    public static func encrypt(_ pk: RistrettoPoint, _ m: Scalar, _ r: Scalar) -> Ciphertext {
        Ciphertext(a: g.multiply(r), b: g.multiply(m) + pk.multiply(r))
    }

    public static func smallDlog(_ target: RistrettoPoint, max: Int) -> Int? {
        var acc = RistrettoPoint.identity
        for m in 0...Swift.max(max, 0) {
            if acc.equals(target) { return m }
            acc = acc + g
        }
        return nil
    }

    // MARK: proofs

    static func membershipChallenge(
        _ domain: String, _ ctx: [[UInt8]], _ pk: RistrettoPoint, _ ct: Ciphertext, _ values: [UInt64],
        _ commitments: [(RistrettoPoint, RistrettoPoint)]
    ) -> Scalar {
        var parts = ctx + [pk.bytes, ct.a.bytes, ct.b.bytes]
        for v in values { parts.append(u64le(v)) }
        for (t1, t2) in commitments { parts += [t1.bytes, t2.bytes] }
        return hashToScalar(domain, parts)
    }

    /// CDS94 OR-proof. rng order: (cᵢ, zᵢ) for each i ≠ real, then w.
    public static func proveMembership(
        _ domain: String, _ ctx: [[UInt8]], _ pk: RistrettoPoint, _ ct: Ciphertext, _ values: [UInt64], real: Int,
        r: Scalar, rng: Rng
    ) -> [Branch] {
        let n = values.count
        var branches = [Branch](repeating: Branch(c: .zero, z: .zero), count: n)
        var commitments = [(RistrettoPoint, RistrettoPoint)](repeating: (.identity, .identity), count: n)
        for i in 0..<n where i != real {
            let c = rng()
            let z = rng()
            let shifted = ct.b - g.multiply(Scalar(values[i]))
            commitments[i] = (g.multiply(z) - ct.a.multiply(c), pk.multiply(z) - shifted.multiply(c))
            branches[i] = Branch(c: c, z: z)
        }
        let w = rng()
        commitments[real] = (g.multiply(w), pk.multiply(w))
        let challenge = membershipChallenge(domain, ctx, pk, ct, values, commitments)
        var others = Scalar.zero
        for i in 0..<n where i != real { others = others + branches[i].c }
        let cReal = challenge - others
        branches[real] = Branch(c: cReal, z: w + cReal * r)
        return branches
    }

    public static func verifyMembership(
        _ domain: String, _ ctx: [[UInt8]], _ pk: RistrettoPoint, _ ct: Ciphertext, _ values: [UInt64],
        _ proof: [Branch]
    ) -> Bool {
        guard !values.isEmpty, proof.count == values.count else { return false }
        var commitments: [(RistrettoPoint, RistrettoPoint)] = []
        var sum = Scalar.zero
        for (i, br) in proof.enumerated() {
            let shifted = ct.b - g.multiply(Scalar(values[i]))
            commitments.append((g.multiply(br.z) - ct.a.multiply(br.c), pk.multiply(br.z) - shifted.multiply(br.c)))
            sum = sum + br.c
        }
        return sum == membershipChallenge(domain, ctx, pk, ct, values, commitments)
    }

    static func dleqChallenge(
        _ domain: String, _ ctx: [[UInt8]], _ base: RistrettoPoint, _ pubG: RistrettoPoint, _ pubBase: RistrettoPoint,
        _ t1: RistrettoPoint, _ t2: RistrettoPoint
    ) -> Scalar {
        hashToScalar(domain, ctx + [pubG.bytes, base.bytes, pubBase.bytes, t1.bytes, t2.bytes])
    }

    /// Chaum–Pedersen DLEQ. rng is drawn once.
    public static func proveDleq(
        _ domain: String, _ ctx: [[UInt8]], base: RistrettoPoint, x: Scalar, rng: Rng
    ) -> (RistrettoPoint, RistrettoPoint, Branch) {
        let pubG = g.multiply(x)
        let pubBase = base.multiply(x)
        let w = rng()
        let c = dleqChallenge(domain, ctx, base, pubG, pubBase, g.multiply(w), base.multiply(w))
        return (pubG, pubBase, Branch(c: c, z: w + c * x))
    }

    public static func verifyDleq(
        _ domain: String, _ ctx: [[UInt8]], base: RistrettoPoint, pubG: RistrettoPoint, pubBase: RistrettoPoint,
        _ p: Branch
    ) -> Bool {
        let t1 = g.multiply(p.z) - pubG.multiply(p.c)
        let t2 = base.multiply(p.z) - pubBase.multiply(p.c)
        return p.c == dleqChallenge(domain, ctx, base, pubG, pubBase, t1, t2)
    }

    /// Schnorr proof of knowledge. rng is drawn once.
    public static func proveKnowledge(_ domain: String, _ ctx: [[UInt8]], x: Scalar, rng: Rng) -> (RistrettoPoint, Branch) {
        let h = g.multiply(x)
        let w = rng()
        let c = hashToScalar(domain, ctx + [h.bytes, g.multiply(w).bytes])
        return (h, Branch(c: c, z: w + c * x))
    }

    public static func verifyKnowledge(_ domain: String, _ ctx: [[UInt8]], h: RistrettoPoint, _ p: Branch) -> Bool {
        let t = g.multiply(p.z) - h.multiply(p.c)
        return p.c == hashToScalar(domain, ctx + [h.bytes, t.bytes])
    }

    // MARK: ballots

    public static func checkRules(_ r: Rules) throws {
        if r.options < 2 || r.options > maxOptions { throw VoteCryptoError("a poll needs 2..=16 options") }
        if r.min > r.max || r.max > r.options || r.max == 0 { throw VoteCryptoError("bad choice bounds") }
    }

    static func sumValues(_ r: Rules) -> [UInt64] { (r.min...r.max).map { UInt64($0) } }

    static let binary: [UInt64] = [0, 1]

    /// rng order: per option, r then that option's proof draws; then the sum proof's.
    public static func castBallot(
        pk: RistrettoPoint, pollId: String, voter: String, rules: Rules, selections: [Bool], rng: Rng
    ) throws -> Ballot {
        try checkRules(rules)
        guard selections.count == rules.options else { throw VoteCryptoError("one selection per option") }
        let chosen = selections.filter { $0 }.count
        guard chosen >= rules.min, chosen <= rules.max else {
            throw VoteCryptoError("selection count outside the poll's bounds")
        }
        let pkB = pk.bytes
        let poll = utf8(pollId)
        let who = utf8(voter)
        var choices: [EncryptedChoice] = []
        var totalR = Scalar.zero
        var total = Ciphertext.zero
        for (i, sel) in selections.enumerated() {
            let m: UInt64 = sel ? 1 : 0
            let r = rng()
            let ct = encrypt(pk, Scalar(m), r)
            let proof = proveMembership(
                "choice", [poll, who, pkB, u32le(i)], pk, ct, binary, real: Int(m), r: r, rng: rng)
            totalR = totalR + r
            total = total + ct
            choices.append(EncryptedChoice(ct: ct, proof: proof))
        }
        let sumProof = proveMembership(
            "sum", [poll, who, pkB], pk, total, sumValues(rules), real: chosen - rules.min, r: totalR, rng: rng)
        return Ballot(choices: choices, sumProof: sumProof)
    }

    /// Throws with the reason a ballot must not be counted.
    public static func verifyBallot(pk: RistrettoPoint, pollId: String, voter: String, rules: Rules, ballot: Ballot) throws {
        try checkRules(rules)
        guard ballot.choices.count == rules.options else { throw VoteCryptoError("one ciphertext per option") }
        let pkB = pk.bytes
        let poll = utf8(pollId)
        let who = utf8(voter)
        var total = Ciphertext.zero
        for (i, ch) in ballot.choices.enumerated() {
            guard verifyMembership("choice", [poll, who, pkB, u32le(i)], pk, ch.ct, binary, ch.proof) else {
                throw VoteCryptoError("an option is not an encryption of 0 or 1")
            }
            total = total + ch.ct
        }
        guard verifyMembership("sum", [poll, who, pkB], pk, total, sumValues(rules), ballot.sumProof) else {
            throw VoteCryptoError("the number of options chosen is outside the bounds")
        }
    }

    public static func ballotDigest(pollId: String, voter: String, ballot: Ballot) -> String {
        var owned: [[UInt8]] = []
        for ch in ballot.choices {
            owned += [ch.ct.a.bytes, ch.ct.b.bytes]
            for br in ch.proof { owned += [br.c.bytes, br.z.bytes] }
        }
        for br in ballot.sumProof { owned += [br.c.bytes, br.z.bytes] }
        return Hex.encode(
            hashToDigest(
                "ballot",
                [utf8(pollId), utf8(voter), u32le(ballot.choices.count), u32le(ballot.sumProof.count)] + owned))
    }

    // MARK: distributed key generation

    public static func makeTransportKey(pollId: String, trustee: String, e: Scalar, rng: Rng) -> (RistrettoPoint, Branch) {
        proveKnowledge("transport", [utf8(pollId), utf8(trustee)], x: e, rng: rng)
    }

    public static func verifyTransportKey(pollId: String, trustee: String, key: RistrettoPoint, proof: Branch) -> Bool {
        verifyKnowledge("transport", [utf8(pollId), utf8(trustee)], h: key, proof)
    }

    static func shareMask(_ pollId: String, _ dealer: String, _ index: Int, _ r: RistrettoPoint, _ secret: RistrettoPoint)
        -> Scalar
    {
        hashToScalar("sharemask", [utf8(pollId), utf8(dealer), u32le(index), r.bytes, secret.bytes])
    }

    public static func evalCommitments(_ commitments: [RistrettoPoint], at x: Int) -> RistrettoPoint {
        var acc = RistrettoPoint.identity
        var pow = Scalar.one
        let xs = Scalar(UInt64(x))
        for c in commitments {
            acc = acc + c.multiply(pow)
            pow = pow * xs
        }
        return acc
    }

    /// rng order: `threshold` coefficients, the proof nonce, then one k per recipient.
    public static func deal(pollId: String, dealer: String, threshold: Int, recipients: [RistrettoPoint], rng: Rng) throws
        -> Dealing
    {
        guard threshold >= 1, threshold <= recipients.count else {
            throw VoteCryptoError("threshold must be 1..=trustees")
        }
        let coeffs = (0..<threshold).map { _ in rng() }
        let (_, proof) = proveKnowledge("keyshare", [utf8(pollId), utf8(dealer)], x: coeffs[0], rng: rng)
        let commitments = coeffs.map { g.multiply($0) }
        var shares: [EncryptedShare] = []
        for (pos, e) in recipients.enumerated() {
            let index = pos + 1
            let x = Scalar(UInt64(index))
            var f = Scalar.zero
            for a in coeffs.reversed() { f = f * x + a }
            let k = rng()
            let r = g.multiply(k)
            shares.append(EncryptedShare(r: r, v: f + shareMask(pollId, dealer, index, r, e.multiply(k))))
        }
        return Dealing(commitments: commitments, proof: proof, shares: shares)
    }

    public static func verifyDealing(pollId: String, dealer: String, threshold: Int, trustees: Int, _ d: Dealing) throws {
        guard threshold >= 1, d.commitments.count == threshold, d.shares.count == trustees else {
            throw VoteCryptoError("a dealing has t commitments and one share per trustee")
        }
        guard verifyKnowledge("keyshare", [utf8(pollId), utf8(dealer)], h: d.commitments[0], d.proof) else {
            throw VoteCryptoError("dealing: no proof of knowledge of the constant term")
        }
    }

    /// Decrypt and check share `index`; nil means the dealer cheated this recipient.
    public static func openShare(pollId: String, dealer: String, index: Int, e: Scalar, _ d: Dealing) -> Scalar? {
        guard index >= 1, index <= d.shares.count else { return nil }
        let enc = d.shares[index - 1]
        let s = enc.v - shareMask(pollId, dealer, index, enc.r, enc.r.multiply(e))
        return g.multiply(s).equals(evalCommitments(d.commitments, at: index)) ? s : nil
    }

    public static func makeComplaint(
        pollId: String, recipient: String, dealer: String, index: Int, e: Scalar, _ d: Dealing, rng: Rng
    ) throws -> (RistrettoPoint, Branch) {
        guard index >= 1, index <= d.shares.count else { throw VoteCryptoError("no such share") }
        let enc = d.shares[index - 1]
        let (_, secret, proof) = proveDleq(
            "complaint", [utf8(pollId), utf8(recipient), utf8(dealer)], base: enc.r, x: e, rng: rng)
        return (secret, proof)
    }

    public static func complaintIsValid(
        pollId: String, recipient: String, dealer: String, index: Int, transport: RistrettoPoint, _ d: Dealing,
        secret: RistrettoPoint, proof: Branch
    ) -> Bool {
        guard index >= 1, index <= d.shares.count else { return false }
        let enc = d.shares[index - 1]
        let ctx = [utf8(pollId), utf8(recipient), utf8(dealer)]
        guard verifyDleq("complaint", ctx, base: enc.r, pubG: transport, pubBase: secret, proof) else { return false }
        let s = enc.v - shareMask(pollId, dealer, index, enc.r, secret)
        return !g.multiply(s).equals(evalCommitments(d.commitments, at: index))
    }

    public static func jointKey(_ qualified: [Dealing]) -> RistrettoPoint {
        qualified.reduce(RistrettoPoint.identity) { $0 + $1.commitments[0] }
    }

    public static func verificationKey(_ qualified: [Dealing], index: Int) -> RistrettoPoint {
        qualified.reduce(RistrettoPoint.identity) { $0 + evalCommitments($1.commitments, at: index) }
    }

    public static func lagrangeAtZero(index: Int, set: [Int]) -> Scalar {
        var num = Scalar.one
        var den = Scalar.one
        for m in set where m != index {
            num = num * Scalar(UInt64(m))
            den = den * (Scalar(UInt64(m)) - Scalar(UInt64(index)))
        }
        return num * den.inverse
    }

    /// Under the trustee's combined key xⱼ.
    public static func partialDecrypt(
        pollId: String, trustee: String, option: Int, x: Scalar, aggA: RistrettoPoint, rng: Rng
    ) -> (RistrettoPoint, Branch) {
        let (_, d, proof) = proveDleq(
            "partial", [utf8(pollId), utf8(trustee), u32le(option)], base: aggA, x: x, rng: rng)
        return (d, proof)
    }

    /// `vkey` is the trustee's verificationKey.
    public static func verifyPartial(
        pollId: String, trustee: String, option: Int, vkey: RistrettoPoint, aggA: RistrettoPoint, d: RistrettoPoint,
        proof: Branch
    ) -> Bool {
        verifyDleq("partial", [utf8(pollId), utf8(trustee), u32le(option)], base: aggA, pubG: vkey, pubBase: d, proof)
    }

    /// Combine exactly `t` partials `(index, Dⱼ)` with Lagrange coefficients.
    public static func openCount(_ agg: Ciphertext, partials: [(Int, RistrettoPoint)], max: Int) -> Int? {
        let set = partials.map(\.0)
        var mask = RistrettoPoint.identity
        for (i, d) in partials { mask = mask + d.multiply(lagrangeAtZero(index: i, set: set)) }
        return smallDlog(agg.b - mask, max: max)
    }
}

/// The seeded stream behind ``VoteProtocol/seededRngSendable(_:)``.
final class SeededStream: @unchecked Sendable {
    private let lock = NSLock()
    private let seed: [UInt8]
    private var k: UInt64 = 0

    init(_ seed: String) { self.seed = Array(seed.utf8) }

    func next() -> Scalar {
        lock.lock()
        defer { lock.unlock() }
        defer { k += 1 }
        return VoteProtocol.hashToScalar("test-rng", [seed, VoteProtocol.u64le(k)])
    }
}
