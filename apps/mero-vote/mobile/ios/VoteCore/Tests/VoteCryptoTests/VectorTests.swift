import Foundation
import XCTest

@testable import VoteCrypto

/// Pins this implementation to the web client byte for byte.
///
/// `mobile/test-vectors/vectors.json` is written by `generate.mjs`, which runs
/// the web app's own `protocol.ts` from fixed seeds. The same seeds go through
/// this port here, and every point, scalar, proof, digest, share, partial and
/// count must come out identical. Kotlin `VectorTest` replays the same file.
final class VectorTests: XCTestCase {
    static let vectors: [String: Any] = {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("test-vectors/vectors.json")
        // swiftlint:disable:next force_try
        let data = try! Data(contentsOf: url)
        // swiftlint:disable:next force_cast force_try
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }()

    var v: [String: Any] { Self.vectors }
    var pollId: String { v["poll_id"] as! String }
    var trustees: [String] { v["trustees"] as! [String] }
    var threshold: Int { v["threshold"] as! Int }

    func point(_ hex: Any?) throws -> RistrettoPoint { try RistrettoPoint(hex: hex as! String) }
    func scalar(_ hex: Any?) throws -> Scalar { try Scalar(hex: hex as! String) }

    func branch(_ o: Any?) throws -> Branch {
        let d = o as! [String: Any]
        return Branch(c: try scalar(d["c"]), z: try scalar(d["z"]))
    }

    func wire(_ b: Branch) -> [String: String] { ["c": b.c.hex, "z": b.z.hex] }

    func dealing(_ o: Any?) throws -> Dealing {
        let d = o as! [String: Any]
        return Dealing(
            commitments: try (d["commitments"] as! [String]).map { try RistrettoPoint(hex: $0) },
            proof: try branch(d["proof"]),
            shares: try (d["shares"] as! [[String: String]]).map {
                EncryptedShare(r: try RistrettoPoint(hex: $0["r"]!), v: try Scalar(hex: $0["v"]!))
            })
    }

    func ballot(_ o: Any?) throws -> Ballot {
        let d = o as! [String: Any]
        let choices = try (d["choices"] as! [[String: Any]]).map { ch in
            EncryptedChoice(
                ct: Ciphertext(a: try point(ch["a"]), b: try point(ch["b"])),
                proof: try (ch["proof"] as! [Any]).map { try branch($0) })
        }
        return Ballot(choices: choices, sumProof: try (d["sum_proof"] as! [Any]).map { try branch($0) })
    }

    func rules(_ o: Any?) -> Rules {
        let r = o as! [String: Int]
        return Rules(options: r["options"]!, min: r["min"]!, max: r["max"]!)
    }

    // MARK: primitives

    func testBaseMultiplesEncodeAndDecode() throws {
        let multiples = v["base_multiples"] as! [String]
        var acc = RistrettoPoint.identity
        for (k, expected) in multiples.enumerated() {
            XCTAssertEqual(acc.hex, expected, "\(k)·B")
            let decoded = try RistrettoPoint(hex: expected)
            XCTAssertEqual(decoded.hex, expected)
            XCTAssertTrue(decoded.equals(acc))
            XCTAssertEqual(RistrettoPoint.base.multiply(Scalar(UInt64(k))).hex, expected)
            acc = acc + RistrettoPoint.base
        }
    }

    func testDecodingAcceptsAndRefusesExactlyAsTheWeb() {
        for c in v["point_decoding"] as! [[String: Any]] {
            let hex = c["hex"] as! String
            let ok = (try? RistrettoPoint(hex: hex)) != nil
            XCTAssertEqual(ok, c["valid"] as! Bool, hex)
        }
        for c in v["scalar_decoding"] as! [[String: Any]] {
            let hex = c["hex"] as! String
            XCTAssertEqual((try? Scalar(hex: hex)) != nil, c["valid"] as! Bool, hex)
        }
    }

    func testScalarArithmeticAndMultiplication() throws {
        for c in v["scalar_arithmetic"] as! [[String: String]] {
            let a = try Scalar(hex: c["a"]!)
            let b = try Scalar(hex: c["b"]!)
            XCTAssertEqual((a + b).hex, c["sum"])
            XCTAssertEqual((a - b).hex, c["difference"])
            XCTAssertEqual((a * b).hex, c["product"])
            XCTAssertEqual((a * a.inverse).hex, Scalar.one.hex)
            let aB = RistrettoPoint.base.multiply(a)
            XCTAssertEqual(aB.hex, c["a_times_base"])
            XCTAssertEqual(aB.multiply(b).hex, c["b_times_a_base"])
        }
    }

    func testHashesRngAndLagrange() throws {
        for h in v["hashes"] as! [[String: Any]] {
            let parts = (h["parts"] as! [String]).map { Array($0.utf8) }
            XCTAssertEqual(VoteProtocol.hashToScalar(h["domain"] as! String, parts).hex, h["scalar"] as? String)
            XCTAssertEqual(Hex.encode(VoteProtocol.hashToDigest(h["domain"] as! String, parts)), h["digest"] as? String)
        }
        let rng = v["rng"] as! [String: Any]
        let draw = VoteProtocol.seededRng(rng["seed"] as! String)
        XCTAssertEqual((0..<4).map { _ in draw().hex }, rng["first"] as! [String])
        for l in v["lagrange"] as! [[String: Any]] {
            let set = l["set"] as! [Int]
            XCTAssertEqual(set.map { VoteProtocol.lagrangeAtZero(index: $0, set: set).hex }, l["coefficients"] as! [String])
        }
    }

    // MARK: a whole poll

    func testKeyCeremony() throws {
        var keys: [RistrettoPoint] = []
        for t in v["transport"] as! [[String: Any]] {
            let rng = VoteProtocol.seededRng(t["seed"] as! String)
            let e = rng()
            XCTAssertEqual(e.hex, t["secret"] as? String)
            let (key, proof) = VoteProtocol.makeTransportKey(pollId: pollId, trustee: t["trustee"] as! String, e: e, rng: rng)
            XCTAssertEqual(key.hex, t["key"] as? String)
            XCTAssertEqual(wire(proof), t["proof"] as? [String: String])
            XCTAssertTrue(VoteProtocol.verifyTransportKey(pollId: pollId, trustee: t["trustee"] as! String, key: key, proof: proof))
            XCTAssertFalse(VoteProtocol.verifyTransportKey(pollId: pollId, trustee: "someone-else", key: key, proof: proof))
            keys.append(key)
        }
        var dealings: [Dealing] = []
        for d in v["dealings"] as! [[String: Any]] {
            let dealer = d["dealer"] as! String
            let mine = try VoteProtocol.deal(
                pollId: pollId, dealer: dealer, threshold: threshold, recipients: keys,
                rng: VoteProtocol.seededRng(d["seed"] as! String))
            let expected = try dealing(d["dealing"])
            XCTAssertEqual(mine.commitments.map(\.hex), expected.commitments.map(\.hex))
            XCTAssertEqual(mine.proof, expected.proof)
            XCTAssertEqual(mine.shares.map(\.r.hex), expected.shares.map(\.r.hex))
            XCTAssertEqual(mine.shares.map(\.v), expected.shares.map(\.v))
            XCTAssertNoThrow(try VoteProtocol.verifyDealing(pollId: pollId, dealer: dealer, threshold: threshold, trustees: trustees.count, mine))
            dealings.append(mine)
        }
        XCTAssertEqual(VoteProtocol.jointKey(dealings).hex, v["election_key"] as? String)
        let transport = v["transport"] as! [[String: Any]]
        let shares = v["shares"] as! [[String]]
        for j in trustees.indices {
            let e = try scalar(transport[j]["secret"])
            var x = Scalar.zero
            for (i, d) in dealings.enumerated() {
                let s = try XCTUnwrap(VoteProtocol.openShare(pollId: pollId, dealer: trustees[i], index: j + 1, e: e, d))
                XCTAssertEqual(s.hex, shares[j][i])
                x = x + s
            }
            XCTAssertEqual(x.hex, (v["combined_secrets"] as! [String])[j])
            XCTAssertEqual(VoteProtocol.verificationKey(dealings, index: j + 1).hex, (v["verification_keys"] as! [String])[j])
        }
    }

    func testComplaint() throws {
        let c = v["complaint"] as! [String: Any]
        let d = try dealing(c["dealing"])
        let index = c["index"] as! Int
        let transport = v["transport"] as! [[String: Any]]
        let e = try scalar(transport[index - 1]["secret"])
        let recipient = c["recipient"] as! String
        let dealer = c["dealer"] as! String
        XCTAssertNil(VoteProtocol.openShare(pollId: pollId, dealer: dealer, index: index, e: e, d))
        let (secret, proof) = try VoteProtocol.makeComplaint(
            pollId: pollId, recipient: recipient, dealer: dealer, index: index, e: e, d,
            rng: VoteProtocol.seededRng(c["seed"] as! String))
        XCTAssertEqual(secret.hex, c["secret"] as? String)
        XCTAssertEqual(wire(proof), c["proof"] as? [String: String])
        let key = try point(transport[index - 1]["key"])
        XCTAssertTrue(VoteProtocol.complaintIsValid(
            pollId: pollId, recipient: recipient, dealer: dealer, index: index, transport: key, d, secret: secret, proof: proof))
        let other = try point(transport[1]["key"])
        XCTAssertFalse(VoteProtocol.complaintIsValid(
            pollId: pollId, recipient: recipient, dealer: dealer, index: index, transport: other, d, secret: secret, proof: proof))
        // An honest dealing cannot be complained about successfully.
        let honest = try dealing((v["dealings"] as! [[String: Any]])[2]["dealing"])
        let (s2, p2) = try VoteProtocol.makeComplaint(
            pollId: pollId, recipient: recipient, dealer: dealer, index: index, e: e, honest, rng: VoteProtocol.seededRng("x"))
        XCTAssertFalse(VoteProtocol.complaintIsValid(
            pollId: pollId, recipient: recipient, dealer: dealer, index: index, transport: key, honest, secret: s2, proof: p2))
    }

    func testBallotsPartialsAndCounts() throws {
        let pk = try point(v["election_key"])
        let r = rules(v["rules"])
        var agg = [Ciphertext](repeating: .zero, count: r.options)
        let ballots = v["ballots"] as! [[String: Any]]
        for b in ballots {
            let voter = b["voter"] as! String
            let mine = try VoteProtocol.castBallot(
                pk: pk, pollId: pollId, voter: voter, rules: r, selections: b["selection"] as! [Bool],
                rng: VoteProtocol.seededRng(b["seed"] as! String))
            let theirs = try ballot(b["ballot"])
            XCTAssertEqual(mine.choices.map(\.ct.a.hex), theirs.choices.map(\.ct.a.hex))
            XCTAssertEqual(mine.choices.map(\.ct.b.hex), theirs.choices.map(\.ct.b.hex))
            XCTAssertEqual(mine.choices.map(\.proof), theirs.choices.map(\.proof))
            XCTAssertEqual(mine.sumProof, theirs.sumProof)
            XCTAssertEqual(VoteProtocol.ballotDigest(pollId: pollId, voter: voter, ballot: mine), b["digest"] as? String)
            XCTAssertNoThrow(try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: voter, rules: r, ballot: theirs))
            XCTAssertThrowsError(try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: "someone-else", rules: r, ballot: theirs))
            agg = zip(agg, theirs.choices).map { $0 + $1.ct }
        }
        let aggregate = v["aggregate"] as! [[String: String]]
        XCTAssertEqual(agg.map(\.a.hex), aggregate.map { $0["a"]! })
        XCTAssertEqual(agg.map(\.b.hex), aggregate.map { $0["b"]! })

        var picked = [[(Int, RistrettoPoint)]](repeating: [], count: r.options)
        for p in v["partials"] as! [[String: Any]] {
            let index = p["index"] as! Int
            let trustee = p["trustee"] as! String
            let x = try scalar((v["combined_secrets"] as! [String])[index - 1])
            let vkey = try point((v["verification_keys"] as! [String])[index - 1])
            let rng = VoteProtocol.seededRng(p["seed"] as! String)
            let options = p["options"] as! [[String: Any]]
            for (j, ct) in agg.enumerated() {
                let (d, proof) = VoteProtocol.partialDecrypt(pollId: pollId, trustee: trustee, option: j, x: x, aggA: ct.a, rng: rng)
                XCTAssertEqual(d.hex, options[j]["d"] as? String)
                XCTAssertEqual(wire(proof), options[j]["proof"] as? [String: String])
                XCTAssertTrue(VoteProtocol.verifyPartial(
                    pollId: pollId, trustee: trustee, option: j, vkey: vkey, aggA: ct.a, d: d, proof: proof))
                picked[j].append((index, d))
            }
        }
        let counts = agg.enumerated().map { j, ct in VoteProtocol.openCount(ct, partials: picked[j], max: ballots.count) }
        XCTAssertEqual(counts, (v["counts"] as! [Int]).map { Optional($0) })
    }

    func testSingleChoiceBallots() throws {
        let pk = try point(v["election_key"])
        let r = rules(v["single_rules"])
        for b in v["single_ballots"] as! [[String: Any]] {
            let voter = b["voter"] as! String
            let mine = try VoteProtocol.castBallot(
                pk: pk, pollId: pollId, voter: voter, rules: r, selections: b["selection"] as! [Bool],
                rng: VoteProtocol.seededRng(b["seed"] as! String))
            XCTAssertEqual(VoteProtocol.ballotDigest(pollId: pollId, voter: voter, ballot: mine), b["digest"] as? String)
            XCTAssertNoThrow(try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: voter, rules: r, ballot: try ballot(b["ballot"])))
        }
        // Two picks on a pick-one poll never leave the device.
        XCTAssertThrowsError(try VoteProtocol.castBallot(
            pk: pk, pollId: pollId, voter: "v", rules: r, selections: [true, true, false, false], rng: VoteProtocol.secureRng))
    }

    func testSecureRandomBallotVerifies() throws {
        let pk = try point(v["election_key"])
        let r = Rules(options: 3, min: 1, max: 1)
        let b = try VoteProtocol.castBallot(
            pk: pk, pollId: pollId, voter: "me", rules: r, selections: [false, true, false], rng: VoteProtocol.secureRng)
        XCTAssertNoThrow(try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: "me", rules: r, ballot: b))
    }
}
