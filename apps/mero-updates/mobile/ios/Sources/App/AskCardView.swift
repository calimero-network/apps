import SwiftUI
import UpdatesCore

/// One ask: what is asked, and either the investor's "I can help" or the
/// team's triage of the offers that came in.
struct AskCardView: View {
    let ask: AskView
    @ObservedObject var audience: AudienceModel
    var showPost = false
    @State private var offering = false
    @State private var note = ""
    @State private var busy: String?
    @State private var error: String?

    private var isOpen: Bool { ask.status == "open" }

    var body: some View {
        Card {
            HStack(spacing: 8) {
                Label(AskKind.of(ask.kind).label, systemImage: Symbols.askKind(ask.kind))
                    .font(.caption.weight(.semibold)).foregroundStyle(Palette.ink2)
                if !isOpen { Badge(title: "Resolved", tone: .good) }
                Spacer()
                Label("\(ask.offerCount) offer\(ask.offerCount == 1 ? "" : "s")", systemImage: "hand.raised")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(ask.offerCount > 0 ? Palette.ink : Palette.ink3)
            }
            Text(ask.title).font(.headline).foregroundStyle(Palette.ink)
            if !ask.detail.isEmpty {
                Text(ask.detail).font(.subheadline).foregroundStyle(Palette.ink2)
            }
            if showPost {
                NavigationLink(value: PostRoute(id: ask.postId)) {
                    Label {
                        Text("From \(ask.postTitle) · \(Format.timeAgo(ask.createdAt))").lineLimit(1)
                    } icon: {
                        Image(systemName: "doc.text")
                    }
                    .font(.footnote).foregroundStyle(Palette.ink2)
                }
                .buttonStyle(.plain)
            }
            if audience.isTeam {
                teamActions
            } else if isOpen {
                investorActions
            }
            if let error { ErrorLine(message: error) }
        }
    }

    // MARK: - Investor

    @ViewBuilder private var investorActions: some View {
        if let mine = ask.myOffer, !offering {
            HStack(spacing: 12) {
                Badge(
                    title: mine.status == "accepted"
                        ? "The team accepted your offer"
                        : mine.status == "declined" ? "The team has this covered — thank you" : "You offered to help",
                    tone: .good, icon: mine.status == "declined" ? nil : "checkmark")
                Spacer(minLength: 0)
            }
            HStack(spacing: 16) {
                LinkButton(title: "Edit note") {
                    note = mine.note
                    offering = true
                }
                LinkButton(title: "Withdraw", tint: Palette.danger) {
                    run("withdraw") { try await audience.withdrawOffer(askId: ask.id) }
                }
                .disabled(busy != nil)
            }
        } else if offering {
            TextField(
                "How can you help? e.g. “I know their VP Finance — happy to intro.”", text: $note, axis: .vertical
            )
            .lineLimit(2...5)
            .padding(10)
            .background(Palette.sunken, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            HStack {
                Spacer()
                Button("Cancel") { offering = false }.buttonStyle(SecondaryButtonStyle(compact: true))
                Button(busy == "offer" ? "Sending…" : "Send offer") {
                    run("offer") {
                        try await audience.offerHelp(askId: ask.id, note: note)
                        offering = false
                    }
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                .disabled(busy != nil)
            }
        } else {
            HStack(spacing: 10) {
                Button {
                    run("offer") { try await audience.offerHelp(askId: ask.id, note: "") }
                } label: {
                    Label(busy == "offer" ? "Sending…" : "I can help", systemImage: "hand.raised")
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                .disabled(busy != nil)
                Button("Help with a note") {
                    note = ""
                    offering = true
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
            }
        }
    }

    // MARK: - Team

    @ViewBuilder private var teamActions: some View {
        if !ask.offers.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(ask.offers) { offer in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) {
                            Avatar(account: offer.account, name: offer.name, size: 26)
                            Text(People.label(offer.name, offer.account)).font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.ink)
                            if !offer.firm.isEmpty {
                                Text("· \(offer.firm)").font(.footnote).foregroundStyle(Palette.ink2).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            Text(Format.timeAgo(offer.createdAt)).font(.caption).foregroundStyle(Palette.ink3)
                        }
                        if !offer.note.isEmpty {
                            Text(offer.note).font(.subheadline).foregroundStyle(Palette.ink)
                        }
                        HStack(spacing: 10) {
                            if offer.status == "offered" {
                                Button("Accept") { setOffer(offer, "accepted") }
                                    .buttonStyle(PrimaryButtonStyle(compact: true))
                                Button("Decline") { setOffer(offer, "declined") }
                                    .buttonStyle(SecondaryButtonStyle(compact: true))
                            } else {
                                Badge(
                                    title: offer.status == "accepted" ? "Accepted" : "Declined",
                                    tone: offer.status == "accepted" ? .good : .muted)
                                LinkButton(title: "Undo") { setOffer(offer, "offered") }
                            }
                        }
                        .disabled(busy != nil)
                    }
                    .padding(10)
                    .background(Palette.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        } else if isOpen {
            Text("No offers yet.").font(.footnote).foregroundStyle(Palette.ink3)
        }
        LinkButton(title: isOpen ? "Mark resolved" : "Re-open") {
            run("status") { try await audience.setAskStatus(askId: ask.id, resolved: isOpen) }
        }
        .disabled(busy != nil)
    }

    private func setOffer(_ offer: OfferView, _ status: String) {
        run("offer:\(offer.account)") {
            try await audience.setOfferStatus(askId: ask.id, account: offer.account, status: status)
        }
    }

    private func run(_ key: String, _ body: @escaping () async throws -> Void) {
        busy = key
        error = nil
        Task {
            defer { busy = nil }
            do {
                try await body()
                Haptics.success()
            } catch {
                self.error = ErrorText.describe(error)
                Haptics.error()
            }
        }
    }
}
