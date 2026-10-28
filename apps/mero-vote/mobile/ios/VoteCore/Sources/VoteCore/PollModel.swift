import Foundation
import MeroKit
import VoteCrypto

/// A share dealt to me, and whether it opens against its dealer's commitments.
public struct ReceivedShare: Equatable, Sendable, Identifiable {
    public let dealer: String
    public let ok: Bool
    public let complained: Bool
    public var id: String { dealer }
}

/// One poll, everything shown about it and every action on it: casting a
/// ballot, the trustee's ceremony steps and decryption share, the creator's
/// open / close / seal, the result with its audit, a re-verification on this
/// device, and the public anchor. All crypto runs here; nothing secret
/// leaves the device. (Kotlin `PollModel`; the web's `PollDetail`,
/// `TrusteePanel` and `AuditPanel`.)
@MainActor
public final class PollModel: ObservableObject {
    @Published public private(set) var view: PollView?
    @Published public private(set) var report: AuditReport?
    @Published public private(set) var ceremony: Ceremony?
    @Published public private(set) var phase: LoadPhase = .loading
    @Published public var selection: [Bool] = []
    /// The action in flight (`cast`, `transport`, `deal`, `complain:<dealer>`,
    /// `partial`, `open`, `close`, `seal`, `anchor`, `verify`).
    @Published public private(set) var busy: String?
    /// What just happened, in a success banner.
    @Published public var note: String?
    /// What just failed, in an error banner.
    @Published public var error: String?
    @Published public private(set) var trusteeKey: TrusteeKey?
    @Published public private(set) var localAudit: LocalAudit?

    public let backend: any MeroAppBackend
    public let group: GroupRef
    public let pollId: String
    public let client: VoteClient
    private let keys: any TrusteeKeyStore
    private var me: String?
    private let rng: @Sendable () -> Scalar

    public init(
        backend: any MeroAppBackend, group: GroupRef, pollId: String, keys: any TrusteeKeyStore,
        rng: @escaping @Sendable () -> Scalar = { VoteProtocol.secureRng() }
    ) {
        self.backend = backend
        self.group = group
        self.pollId = pollId
        self.keys = keys
        self.rng = rng
        self.client = VoteClient.make(contract: backend.contract, contextId: group.contextId)
    }

    // MARK: Reading

    public func load() async {
        if view == nil { phase = .loading }
        do {
            if me == nil { me = try await client.whoami().account }
            let v = try await client.getPoll(pollId: pollId)
            view = v
            if selection.count != v.definition.options.count {
                selection = Array(repeating: false, count: v.definition.options.count)
            }
            report = v.state.phase == .closed ? try await client.getResult(pollId: pollId) : nil
            ceremony = v.state.phase == .keyCeremony ? try await client.ceremony(pollId: pollId) : nil
            if let me, trusteeKey == nil {
                trusteeKey = keys.load(contextId: group.contextId, pollId: pollId, account: me)
            }
            phase = .loaded
        } catch {
            if view == nil { phase = .failed(VoteErrorText.describe(error)) } else { self.error = VoteErrorText.describe(error) }
        }
    }

    public func watch() async {
        await VoteWatch.run(backend: backend, contextId: group.contextId) { [weak self] in
            guard let self, self.busy == nil else { return }
            await self.load()
        }
    }

    // MARK: Derived

    public var account: String? { me }
    public var definition: PollDefinition? { view?.definition }
    public var pollPhase: Phase { view?.state.phase ?? .keyCeremony }
    public var isCreator: Bool { me != nil && me == view?.definition.creator }
    public var myIndex: Int { me.flatMap { view?.definition.trustees.firstIndex(of: $0) }.map { $0 + 1 } ?? 0 }
    public var amTrustee: Bool { myIndex > 0 }
    public var mine: TrusteeStatus? { view?.trustees.first { $0.account == me } }
    public var allTransport: Bool { view?.trustees.allSatisfy(\.transportPublished) ?? false }
    public var qualifiedNow: Int {
        view?.trustees.filter { $0.dealingPublished && $0.complaintsAgainst == 0 }.count ?? 0
    }
    public var chosen: Int { selection.filter { $0 }.count }
    public var canCast: Bool {
        guard let def = view?.definition, view?.canVote == true, busy == nil else { return false }
        return chosen >= Int(def.minChoices) && chosen <= Int(def.maxChoices)
    }
    public var counted: [CountedBallot] { view?.state.closure?.counted ?? [] }
    public var myCounted: Bool {
        guard let digest = view?.myDigest else { return false }
        return counted.contains { $0.digest == digest }
    }
    /// Who voted: the counted set once sealed, the turnout before.
    public var voterList: [String] {
        pollPhase == .closed ? counted.map(\.voter) : (view?.turnout.map(\.voter) ?? [])
    }
    public var publishedPartials: Int { view?.trustees.filter(\.partialPublished).count ?? 0 }
    /// Trustees matter most during the ceremony and while the totals await
    /// decryption; once there is a ballot to cast or a result to read they move down.
    public var trusteesLast: Bool {
        pollPhase == .voting || pollPhase == .closing || (pollPhase == .closed && report?.counts != nil)
    }

    /// My transport key as published (the frozen election's, or the ceremony's).
    public var myTransport: String? {
        guard myIndex > 0 else { return nil }
        if let election = view?.state.election, election.transport.count >= myIndex { return election.transport[myIndex - 1] }
        return ceremony?.trustees.first { Int($0.index) == myIndex }?.transport
    }

    /// The shares dealt to me so far, checked with my transport secret.
    public var received: [ReceivedShare] {
        guard amTrustee, let key = trusteeKey, let ceremony, let e = try? Scalar(hex: key.secret) else { return [] }
        return ceremony.trustees.compactMap { t in
            guard let wire = t.dealing else { return nil }
            let ok = (try? VoteWire.dealing(wire)).flatMap {
                VoteProtocol.openShare(pollId: pollId, dealer: t.account, index: myIndex, e: e, $0)
            } != nil
            let complained = ceremony.complaints.contains { $0.recipient == me && $0.dealer == t.account }
            return ReceivedShare(dealer: t.account, ok: ok, complained: complained)
        }
    }

    /// The creator's line beside "Open voting".
    public var ceremonyStatus: String {
        guard let def = view?.definition else { return "" }
        let n = def.trustees.count
        let t = Int(def.threshold)
        if !allTransport { return "Waiting for every trustee's transport key." }
        if qualifiedNow < t {
            return "\(qualifiedNow) honest dealing\(qualifiedNow == 1 ? "" : "s") so far; the key needs at least \(t)."
        }
        if qualifiedNow < n {
            let missing = n - qualifiedNow
            return "Ready. \(missing) trustee\(missing == 1 ? " hasn't" : "s haven't") dealt — waiting for them adds their randomness to the key."
        }
        return "Every trustee has dealt."
    }

    public var canOpenVoting: Bool {
        guard let def = view?.definition else { return false }
        return allTransport && qualifiedNow >= Int(def.threshold) && busy == nil
    }

    public func toggle(_ index: Int) {
        guard let def = view?.definition, selection.indices.contains(index) else { return }
        if VoteFormat.isSingleChoice(def) {
            selection = selection.indices.map { $0 == index }
        } else {
            selection[index].toggle()
        }
    }

    // MARK: Acting

    private func act(_ name: String, done: String? = nil, _ work: () async throws -> Void) async {
        busy = name
        error = nil
        note = nil
        do {
            try await work()
            if let done { note = done }
            busy = nil
            await load()
        } catch {
            busy = nil
            self.error = VoteErrorText.describe(error)
        }
    }

    /// Encrypt, prove and cast. The plaintext is forgotten once it is sent.
    public func cast() async {
        guard let v = view, let me, let election = v.state.election, canCast else { return }
        let selections = selection
        let rules = VoteWire.rules(v.definition)
        let key = election.key
        let pollId = self.pollId
        let rng = self.rng
        await act("cast", done: "Ballot cast. It left this device encrypted — your node and every other member see only ciphertexts and proofs.") {
            let wire = try await Task.detached(priority: .userInitiated) {
                let pk = try VoteWire.point(key, "election key")
                let ballot = try VoteProtocol.castBallot(
                    pk: pk, pollId: pollId, voter: me, rules: rules, selections: selections, rng: rng)
                return VoteWire.ballot(ballot)
            }.value
            _ = try await client.castBallot(pollId: pollId, ballot: wire)
            selection = Array(repeating: false, count: selections.count)
        }
    }

    /// Step 1: a fresh transport secret, kept on this device; its public key with a proof.
    public func publishTransportKey() async {
        guard let me else { return }
        await act("transport", done: "Transport key published. Save a key backup now — without it this device is the only place your trustee key exists.") {
            let e = rng()
            let key = TrusteeKey(contextId: group.contextId, pollId: pollId, account: me, secret: e.hex)
            guard keys.save(key) else { throw VoteModelError.message("This device can't store your trustee key.") }
            trusteeKey = key
            let (pub, proof) = VoteProtocol.makeTransportKey(pollId: pollId, trustee: me, e: e, rng: rng)
            try await client.publishTransportKey(pollId: pollId, key: pub.hex, proof: VoteWire.branch(proof))
        }
    }

    /// Step 2: shares of a fresh random polynomial, one encrypted to each trustee.
    public func publishDealing() async {
        guard let me, let ceremony, let def = view?.definition else { return }
        let transports = ceremony.trustees.sorted { $0.index < $1.index }.map(\.transport)
        let pollId = self.pollId
        let threshold = Int(def.threshold)
        let rng = self.rng
        await act("deal", done: "Shares dealt. Each trustee received one, encrypted to them alone.") {
            let wire = try await Task.detached(priority: .userInitiated) {
                let keys = try transports.map { t -> RistrettoPoint in
                    guard let t else { throw VoteModelError.message("Waiting for every trustee's transport key.") }
                    return try VoteWire.point(t, "transport key")
                }
                // The polynomial lives only inside this call.
                let d = try VoteProtocol.deal(pollId: pollId, dealer: me, threshold: threshold, recipients: keys, rng: rng)
                return VoteWire.dealing(d)
            }.value
            try await client.publishDealing(pollId: pollId, dealing: wire)
        }
    }

    /// Prove that `dealer`'s share to me was bad; their dealing is then left out of the key.
    public func complain(about dealer: String, label: String) async {
        guard let me, let key = trusteeKey, let wire = ceremony?.trustees.first(where: { $0.account == dealer })?.dealing
        else { return }
        let index = myIndex
        await act("complain:\(dealer)", done: "Complaint filed. It proves \(label)'s share to you was bad, and their dealing will be left out of the key.") {
            let e = try VoteWire.scalar(key.secret, "trustee key")
            let (secret, proof) = try VoteProtocol.makeComplaint(
                pollId: pollId, recipient: me, dealer: dealer, index: index, e: e, try VoteWire.dealing(wire), rng: rng)
            try await client.fileComplaint(pollId: pollId, dealer: dealer, secret: secret.hex, proof: VoteWire.branch(proof))
        }
    }

    /// My decryption share of each option's total, under my combined key,
    /// re-derived from the frozen dealings (never stored).
    public func publishPartial(label: @escaping (String) -> String) async {
        guard let me, let key = trusteeKey, let election = view?.state.election, let def = view?.definition else { return }
        let index = myIndex
        let pollId = self.pollId
        let rng = self.rng
        await act("partial", done: "Decryption share published. It decrypts only the per-option totals, never a single ballot.") {
            let e = try VoteWire.scalar(key.secret, "trustee key")
            var x = Scalar.zero
            for q in election.qualified {
                guard let s = VoteProtocol.openShare(pollId: pollId, dealer: q.dealer, index: index, e: e, try VoteWire.dealing(q.dealing))
                else {
                    throw VoteModelError.message(
                        "\(label(q.dealer))'s share to you does not verify, so you cannot decrypt — any \(def.threshold) other trustees can.")
                }
                x = x + s
            }
            let inputs = try await client.tallyInputs(pollId: pollId)
            let combined = x
            let partials = try await Task.detached(priority: .userInitiated) {
                try inputs.aggregate.enumerated().map { j, ct -> WirePartial in
                    let (d, proof) = VoteProtocol.partialDecrypt(
                        pollId: pollId, trustee: me, option: j, x: combined, aggA: try VoteWire.point(ct.a, "aggregate"), rng: rng)
                    return WirePartial(d: d.hex, proof: VoteWire.branch(proof))
                }
            }.value
            try await client.publishPartial(pollId: pollId, partials: partials)
        }
    }

    /// Put a trustee key back from a backup (the web's file, as text).
    public func restoreKey(_ raw: String) throws {
        guard let me else { throw VoteModelError.message("Still loading. Try again in a moment.") }
        let key = try TrusteeKey.parse(raw, contextId: group.contextId, pollId: pollId, account: me)
        if let published = myTransport {
            let derived = (try? Scalar(hex: key.secret)).map { RistrettoPoint.base.multiply($0).hex }
            guard derived == published else {
                throw VoteModelError.message("This key does not match the transport key you published.")
            }
        }
        guard keys.save(key) else { throw VoteModelError.message("This device can't store your trustee key.") }
        trusteeKey = key
        note = "Trustee key restored on this device."
        error = nil
    }

    public func openVoting() async {
        await act("open", done: "Voting is open. The election key is frozen.") {
            _ = try await client.openVoting(pollId: pollId)
        }
    }

    public func closePoll() async {
        await act("close", done: "Poll closed to new ballots. Seal the count once ballots in flight have arrived.") {
            try await client.closePoll(pollId: pollId)
        }
    }

    public func sealPoll() async {
        await act("seal", done: "Count sealed. Trustees can now decrypt the totals.") {
            _ = try await client.sealPoll(pollId: pollId)
        }
    }

    public func anchor(network: String, reference: String) async {
        let network = network.trimmingCharacters(in: .whitespacesAndNewlines)
        let reference = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !network.isEmpty, !reference.isEmpty else { return }
        await act("anchor", done: "Anchor recorded.") {
            _ = try await client.anchorResult(pollId: pollId, network: network, reference: reference)
        }
    }

    /// Re-run every check on this device from the raw transcript, and compare with the node.
    public func reverify() async {
        busy = "verify"
        error = nil
        do {
            let transcript = try await client.getTranscript(pollId: pollId)
            localAudit = await Task.detached(priority: .userInitiated) { TranscriptAudit.verify(transcript) }.value
        } catch {
            self.error = VoteErrorText.describe(error)
        }
        busy = nil
    }

    /// The transcript as pretty JSON, for sharing.
    public func transcriptJSON() async throws -> String {
        let transcript = try await client.getTranscript(pollId: pollId)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return String(decoding: try encoder.encode(transcript), as: UTF8.self)
    }
}
