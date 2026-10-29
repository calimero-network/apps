import SwiftUI
import VoteCore

/// The counts, decrypted from the totals only.
struct ResultCard: View {
    @ObservedObject var model: PollModel
    let report: AuditReport
    let label: (String) -> String

    var body: some View {
        let options = model.definition?.options ?? []
        let counts = report.counts
        let total = counts?.reduce(0, +) ?? 0
        let n = UInt64(report.countedBallots)
        let denom = n > 0 ? n : max(total, 1)
        let top = counts?.max() ?? 0
        let winners: [Int] = {
            guard let c = counts, top > 0 else { return [] }
            return options.indices.filter { c.indices.contains($0) && c[$0] == top }
        }()
        let ballots = VoteFormat.count(Int(report.countedBallots), "ballot", "ballots")
        return Panel {
            CardHead(
                symbol: "chart.bar.fill", accent: counts != nil, title: "Result",
                meta: counts != nil ? "\(ballots) · \(VoteFormat.count(Int(total), "selection", "selections"))" : nil
            ) {
                if report.verified {
                    Label("Verified", systemImage: "checkmark.shield.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.success)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Palette.successSoft))
                }
            }
            if counts != nil, top > 0 {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(VoteFormat.percent(top, of: denom))%").font(Typeface.display(34)).foregroundStyle(Palette.ink)
                    Text(
                        (winners.count == 1
                            ? "\(options[winners[0]]) has the most votes"
                            : "A tie between \(winners.map { options[$0] }.joined(separator: ", "))")
                            + ", \(top) of \(ballots)."
                    )
                    .font(.system(size: 15)).foregroundStyle(Palette.inkSoft)
                }
            }
            if let counts {
                VStack(spacing: 12) {
                    ForEach(options.indices, id: \.self) { i in
                        let c = counts.indices.contains(i) ? counts[i] : 0
                        let winner = top > 0 && c == top
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                Text(options[i]).font(.system(size: 15, weight: winner ? .semibold : .regular))
                                    .foregroundStyle(Palette.ink).lineLimit(2)
                                if winner { Badge(text: "Most votes") }
                                Spacer()
                                Text("\(c)").font(.system(size: 15, weight: .semibold)).monospacedDigit()
                                    .foregroundStyle(Palette.ink)
                                Text("\(VoteFormat.percent(c, of: denom))%").font(.system(size: 13)).monospacedDigit()
                                    .foregroundStyle(Palette.muted).frame(minWidth: 38, alignment: .trailing)
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Palette.sunken)
                                    Capsule().fill(winner ? Palette.ink : Palette.inkSoft.opacity(0.55))
                                        .frame(width: geo.size.width * min(1, Double(c) / Double(max(denom, top, 1))))
                                }
                            }
                            .frame(height: 8)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                Text(
                    "Decrypted from the totals only, by \(report.decryptedBy.map(label).joined(separator: " + ")). No single ballot was ever decrypted."
                )
                .font(.system(size: 13)).foregroundStyle(Palette.muted)
            } else if report.verified {
                let t = Int(model.definition?.threshold ?? 0)
                Callout(
                    tone: .info,
                    title: "\(ballots) counted. \(model.publishedPartials) of the \(t) decryption share\(t == 1 ? "" : "s") needed are in.",
                    symbol: "clock")
            } else {
                Callout(tone: .danger, title: "This poll does not verify — see the audit below. No result is shown for it.")
            }
        }
    }
}

/// Every check the node ran, and the same checks re-run on this device.
struct AuditCard: View {
    @ObservedObject var model: PollModel
    let report: AuditReport
    let label: (String) -> String
    @State private var transcript: SharedText?

    var body: some View {
        Panel {
            CardHead(
                symbol: "checkmark.shield.fill", title: "Audit",
                meta: "Your node recomputed all of this from the frozen ballots just now. Nothing here is a stored conclusion.")
            if report.verified {
                Callout(tone: .success, title: "Every check passed", message: "The node re-verified every proof, from the key ceremony to the decryption.")
            } else {
                Callout(tone: .danger, title: "This poll does not verify", message: "At least one check below failed. A poll is only as good as its worst check.")
            }
            Disclosure(title: "Show the checks (\(report.checks.count))") {
                CheckList(checks: report.checks.map { AuditCheck(name: $0.name, ok: $0.ok, detail: $0.detail) })
            }
            if !report.uncounted.isEmpty {
                Callout(
                    tone: .warning,
                    title: "Not in the sealed count: \(report.uncounted.map(label).joined(separator: ", ")) — their ballot reached this node after the seal, or the creator left it out.")
            }
            Button {
                Haptics.tap()
                Task {
                    await model.reverify()
                    if let local = model.localAudit, local.verified && local.agreesWithNode { Haptics.success() } else { Haptics.failure() }
                }
            } label: {
                if model.busy == "verify" {
                    HStack(spacing: 8) {
                        ProgressView().tint(Palette.ink)
                        Text("Re-verifying…")
                    }
                } else {
                    Label("Re-verify on this device", systemImage: "checkmark.shield")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.busy != nil)
            if let transcript {
                ShareLink(item: transcript, preview: SharePreview("Poll transcript")) {
                    Label("Share transcript", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(SecondaryButtonStyle())
            } else {
                Button {
                    Task {
                        if let json = try? await model.transcriptJSON() {
                            transcript = SharedText(text: json, fileName: "mero-vote-transcript-\(model.pollId.prefix(12)).json")
                        }
                    }
                } label: {
                    Label("Share transcript", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            if let local = model.localAudit {
                let good = local.verified && local.agreesWithNode
                Callout(
                    tone: good ? .success : .danger,
                    title: good
                        ? "This device independently reproduced the node's result."
                        : local.agreesWithNode ? "The poll does not verify here either." : "This device disagrees with the node.",
                    message: "Checked from the raw transcript with an independent implementation.")
                Disclosure(title: "Details") { CheckList(checks: local.checks) }
            }
        }
    }
}

/// The transcript digest, held to a public record outside the group.
struct AnchorCard: View {
    @ObservedObject var model: PollModel
    let report: AuditReport
    @State private var recording = false

    var body: some View {
        Panel {
            CardHead(
                symbol: "link.badge.plus", title: "Public anchor",
                meta: report.anchor == nil ? "Hold the result to a digest published outside this group." : nil)
            if let anchor = report.anchor {
                CopyRow(label: "Digest", value: anchor.digest)
                CopyRow(label: "Network", value: anchor.network)
                CopyRow(label: "Reference", value: anchor.reference)
            } else {
                Text(
                    "Publish the transcript digest somewhere outside this group — a transaction memo, a signed git tag, a post — then record where. Anyone given the transcript can then check it against that public digest."
                )
                .font(.system(size: 14)).foregroundStyle(Palette.muted)
                Button("Record anchor") { recording = true }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .sheet(isPresented: $recording) { AnchorSheet(model: model) }
    }
}

struct AnchorSheet: View {
    @ObservedObject var model: PollModel
    @Environment(\.dismiss) private var dismiss
    @State private var network = ""
    @State private var reference = ""

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Record anchor", action: "Record",
                canAct: !network.trimmingCharacters(in: .whitespaces).isEmpty && !reference.trimmingCharacters(in: .whitespaces).isEmpty,
                busy: model.busy == "anchor", cancel: { dismiss() }
            ) {
                Task {
                    await model.anchor(network: network, reference: reference)
                    if model.error == nil {
                        Haptics.success()
                        dismiss()
                    }
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                field("Network", "ethereum:sepolia, git, web", $network)
                field("Reference", "tx hash, URL, tag", $reference)
                if let error = model.error { Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger) }
            }
            .padding(20)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
    }

    private func field(_ title: String, _ placeholder: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sunken))
        }
    }
}
