import ChessCore
import MeroKit
import SwiftUI

/// One table: the board between the two players, then the game, the moves and the record.
struct TableScreen: View {
    @StateObject private var model: TableModel
    @State private var share: SharedLink?
    @State private var showingDetails = false
    @State private var confirmingResign = false
    @State private var inviting = false
    @State private var inviteError: String?

    init(backend: any MeroAppBackend, ref: TableRef) {
        _model = StateObject(
            wrappedValue: TableModel(
                backend: backend, contextId: ref.contextId, namespaceId: ref.namespaceId, names: DefaultsNameStore()))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let error = model.error {
                    ErrorBanner(message: error) { model.dismissError() }
                }
                if let inviteError {
                    ErrorBanner(message: inviteError) { self.inviteError = nil }
                }
                if let view = model.view {
                    table(view)
                } else {
                    VStack(spacing: 14) {
                        ProgressView().tint(Theme.ink)
                        Text("Reading the table…").font(Theme.body(14)).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 80)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.ground.ignoresSafeArea())
        .navigationTitle(model.view?.title ?? "Table")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                Button {
                    invite()
                } label: {
                    if inviting { ProgressView().tint(Theme.ink) } else { Image(systemName: "square.and.arrow.up") }
                }
                .accessibilityLabel("Invite")
                .disabled(inviting || model.namespaceId == nil)
                Menu {
                    Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    Button { showingDetails = true } label: { Label("Details", systemImage: "info.circle") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More")
            }
        }
        .refreshable { await model.refresh() }
        .task { await model.run() }
        .onChange(of: model.movesPlayed) { _ in Haptics.success() }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
        .sheet(isPresented: $showingDetails) { TableDetailsSheet(model: model) }
        .sheet(item: promotionBinding) { pending in
            PromotionSheet(pending: pending) { kind in _ = model.choosePromotion(kind) } onCancel: {
                model.cancelPromotion()
            }
        }
        .confirmationDialog("Resign this game?", isPresented: $confirmingResign, titleVisibility: .visible) {
            Button("Resign", role: .destructive) {
                Haptics.warning()
                Task { await model.resign() }
            }
        } message: {
            Text("The game goes to your opponent.")
        }
    }

    private var promotionBinding: Binding<PendingPromotion?> {
        // Swiping the picker away cancels; choosing a piece has already cleared it.
        Binding(get: { model.promotion }, set: { if $0 == nil, model.promotion != nil { model.cancelPromotion() } })
    }

    @ViewBuilder
    private func table(_ view: TableView) -> some View {
        let material = Board.material(model.squares)
        let top: PieceColor = model.flipped ? .white : .black
        PlayerBar(model: model, color: top, captured: material.captured[top] ?? [], lead: material.lead[top] ?? 0)
        BoardView(model: model)
        PlayerBar(
            model: model, color: top.opposite, captured: material.captured[top.opposite] ?? [],
            lead: material.lead[top.opposite] ?? 0)

        if model.offerFromOpponent && model.isSeated {
            DrawOfferCard(model: model)
        }
        GameCard(model: model, view: view, onResign: { confirmingResign = true })
        if !model.isSeated {
            SeatPrompt(model: model, view: view)
        }
        MovesCard(view: view)
        RecordCard(view: view, past: model.past)
    }

    private func invite() {
        Haptics.tap()
        inviting = true
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink())
            } catch {
                inviteError = ChessText.error(error)
            }
            inviting = false
        }
    }
}

// MARK: - Players

/// One chair: who sits there, whether they are around, what they have taken, whose move it is.
private struct PlayerBar: View {
    @ObservedObject var model: TableModel
    let color: PieceColor
    let captured: [Character]
    let lead: Int

    var body: some View {
        if let view = model.view, let seat = model.seat(color) {
            let occupied = !seat.member.isEmpty
            let mine = occupied && seat.member == view.me
            let toMove = view.status == "inProgress" && view.sideToMove == color.rawValue
            HStack(spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    Circle()
                        .fill(color == .white ? Theme.surface : Theme.ink)
                        .overlay(Circle().strokeBorder(Theme.line, lineWidth: 1))
                        .frame(width: 40, height: 40)
                        .overlay {
                            if occupied {
                                Text(String(seat.name.prefix(1)).uppercased())
                                    .font(Theme.heading(16))
                                    .foregroundStyle(color == .white ? Theme.ink : Theme.surface)
                            } else {
                                PieceImage(assetName: color == .white ? "wK" : "bK").padding(7)
                            }
                        }
                    if occupied {
                        Circle().fill(seat.online ? Theme.online : Theme.muted.opacity(0.5))
                            .frame(width: 11, height: 11)
                            .overlay(Circle().strokeBorder(Theme.surface, lineWidth: 2))
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 4) {
                        Text(occupied ? seat.name : "Seat empty")
                            .font(Theme.heading(15))
                            .foregroundStyle(occupied ? Theme.ink : Theme.muted)
                            .lineLimit(1)
                        if mine { Text("· you").font(Theme.body(14)).foregroundStyle(Theme.muted) }
                    }
                    HStack(spacing: 6) {
                        Text(color.label + (occupied ? (seat.online ? " · online" : " · away") : ""))
                            .font(Theme.body(12)).foregroundStyle(Theme.muted)
                        if !captured.isEmpty {
                            HStack(spacing: -4) {
                                ForEach(Array(captured.enumerated()), id: \.offset) { _, kind in
                                    PieceImage(assetName: Piece(color: color.opposite, kind: kind).assetName)
                                        .frame(width: 15, height: 15)
                                }
                            }
                            if lead > 0 {
                                Text("+\(lead)").font(Theme.body(12, .semibold)).foregroundStyle(Theme.ink2)
                            }
                        }
                    }
                }
                Spacer(minLength: 8)
                if toMove {
                    Text("To move")
                        .font(Theme.body(12, .semibold)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(Theme.lime))
                }
                if !occupied {
                    Button {
                        Haptics.tap()
                        Task { await model.sit(color) }
                    } label: {
                        Label(model.isSeated ? "Play this side too" : "Sit here", systemImage: "person.badge.plus")
                            .labelStyle(.titleOnly)
                    }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                    .disabled(model.busy)
                } else if model.canStand(color) {
                    Button("Stand") { Task { await model.stand() } }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                        .disabled(model.busy)
                }
            }
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Game

private struct DrawOfferCard: View {
    @ObservedObject var model: TableModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "circle.lefthalf.filled").foregroundStyle(Theme.ink)
                Text("Your opponent offers a draw.").font(Theme.heading(15)).foregroundStyle(Theme.ink)
            }
            HStack(spacing: 10) {
                Button {
                    Haptics.tap()
                    Task { await model.acceptDraw() }
                } label: {
                    Label("Accept", systemImage: "checkmark")
                }
                .buttonStyle(PrimaryButtonStyle())
                Button {
                    Task { await model.declineDraw() }
                } label: {
                    Label("Decline", systemImage: "xmark")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .disabled(model.busy)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.limeSoft))
    }
}

/// Where the game stands, and the buttons that go with it.
private struct GameCard: View {
    @ObservedObject var model: TableModel
    let view: TableView
    let onResign: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.isFinished {
                Text(ChessText.score(view.result))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.ink)
            }
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Circle().fill(dotColor).frame(width: 9, height: 9)
                Text(ChessText.status(view)).font(Theme.heading(16)).foregroundStyle(Theme.ink)
            }
            Text(ChessText.meta(view)).font(Theme.body(13)).foregroundStyle(Theme.muted)

            if model.isPlaying {
                VStack(spacing: 10) {
                    if model.myOfferStands {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small).tint(Theme.muted)
                            Text("Draw offered — waiting for a reply.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } else if !model.offerFromOpponent {
                        Button {
                            Haptics.tap()
                            Task { await model.offerDraw() }
                        } label: {
                            Label("Offer draw", systemImage: "circle.lefthalf.filled")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    if let claim = ChessText.claimLabel(view.claimableDraw) {
                        Button {
                            Haptics.tap()
                            Task { await model.claimDraw() }
                        } label: {
                            Label(claim, systemImage: "checkmark.seal")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                    Button(action: onResign) {
                        Label("Resign", systemImage: "flag")
                    }
                    .buttonStyle(SecondaryButtonStyle(destructive: true))
                }
                .disabled(model.busy)
            }
            if model.isFinished && model.isSeated {
                Button {
                    Haptics.tap()
                    Task { await model.rematch() }
                } label: {
                    Label("Rematch", systemImage: "arrow.triangle.2.circlepath")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.busy)
            }
            if model.isSeated {
                Text("Colours swap on every rematch.").font(Theme.body(12)).foregroundStyle(Theme.muted)
            }
        }
        .card()
    }

    private var dotColor: Color {
        if model.isFinished { return Theme.muted }
        if view.check { return Theme.danger }
        if view.myTurn { return Theme.lime }
        return Theme.muted.opacity(0.5)
    }
}

/// Not seated: the name to sit under, and what sitting means.
private struct SeatPrompt: View {
    @ObservedObject var model: TableModel
    let view: TableView

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your name").font(Theme.body(13, .semibold)).foregroundStyle(Theme.muted)
            TextField("Your name", text: $model.name)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.sunken))
                .onChange(of: model.name) { value in if value.count > 32 { model.name = String(value.prefix(32)) } }
            Text(
                !view.white.member.isEmpty && !view.black.member.isEmpty
                    ? "Both chairs are taken, so you are watching. Nothing is hidden from a spectator — chess is a game of complete information."
                    : "Pick an empty chair beside the board to play. Take both to play the board yourself."
            )
            .font(Theme.body(13)).foregroundStyle(Theme.muted)
        }
        .card()
    }
}

/// The scoresheet.
private struct MovesCard: View {
    let view: TableView

    var body: some View {
        let rows = Board.movePairs(view.moves.map(\.san))
        let last = view.moves.count - 1
        VStack(alignment: .leading, spacing: 12) {
            CardTitle(text: "Moves", trailing: view.moves.isEmpty ? nil : "\(view.moves.count) plies")
            if rows.isEmpty {
                Text("No moves yet. White opens.").font(Theme.body(14)).foregroundStyle(Theme.muted)
            } else {
                LazyVGrid(
                    columns: [GridItem(.fixed(32), alignment: .leading), GridItem(.flexible(), alignment: .leading),
                              GridItem(.flexible(), alignment: .leading)],
                    alignment: .leading, spacing: 6
                ) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                        Text("\(row.number).").font(Theme.body(13)).foregroundStyle(Theme.muted)
                        san(row.white, current: i * 2 == last)
                        san(row.black, current: i * 2 + 1 == last)
                    }
                }
            }
        }
        .card()
    }

    private func san(_ text: String, current: Bool) -> some View {
        Text(text)
            .font(.system(size: 14, weight: current ? .semibold : .regular, design: .monospaced))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, current ? 6 : 0)
            .padding(.vertical, current ? 2 : 0)
            .background(RoundedRectangle(cornerRadius: 6).fill(current ? Theme.limeSoft : .clear))
    }
}

/// The finished games, most recent first.
private struct RecordCard: View {
    let view: TableView
    let past: [GameSummary]

    var body: some View {
        let finished = past.filter { $0.result != "*" }
        if !finished.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                CardTitle(text: "Record", trailing: "\(finished.count) \(finished.count == 1 ? "game" : "games")")
                ForEach(finished.reversed(), id: \.index) { game in
                    HStack(spacing: 10) {
                        Text("Game \(game.index + 1)").font(Theme.body(14, .semibold)).foregroundStyle(Theme.ink)
                        Text(ChessText.score(game.result))
                            .font(Theme.body(12, .semibold)).foregroundStyle(Theme.ink)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Capsule().fill(Theme.sunken))
                        Text(ChessText.recordReason(game.reason)).font(Theme.body(13)).foregroundStyle(Theme.muted)
                            .lineLimit(1)
                        Spacer()
                        Text("\(game.plies) plies").font(Theme.body(12)).foregroundStyle(Theme.muted)
                    }
                }
                Text(
                    "\(view.white.name.isEmpty ? "White" : view.white.name) and \(view.black.name.isEmpty ? "Black" : view.black.name) have played \(finished.count) \(finished.count == 1 ? "game" : "games")."
                )
                .font(Theme.body(12)).foregroundStyle(Theme.muted)
            }
            .card()
        }
    }
}

// MARK: - Sheets

/// Promote to: queen first.
private struct PromotionSheet: View {
    let pending: PendingPromotion
    let onChoose: (Character) -> Void
    let onCancel: () -> Void
    @Environment(\.dismiss) private var dismiss

    private static let names: [Character: String] = ["q": "Queen", "r": "Rook", "b": "Bishop", "n": "Knight"]

    var body: some View {
        VStack(spacing: 18) {
            Text("Promote to").font(Theme.heading(20)).foregroundStyle(Theme.ink)
            HStack(spacing: 10) {
                ForEach(pending.kinds, id: \.self) { kind in
                    Button {
                        Haptics.tap()
                        onChoose(kind)
                        dismiss()
                    } label: {
                        VStack(spacing: 6) {
                            PieceImage(assetName: Piece(color: pending.color, kind: kind).assetName)
                                .frame(width: 52, height: 52)
                            Text(Self.names[kind] ?? String(kind)).font(Theme.body(13, .semibold))
                                .foregroundStyle(Theme.ink)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            Button("Cancel") {
                onCancel()
                dismiss()
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .background(Theme.ground.ignoresSafeArea())
        .presentationDetents([.height(280)])
    }
}

/// Ids and what the contract says about this device, for anyone debugging.
private struct TableDetailsSheet: View {
    @ObservedObject var model: TableModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DetailRow(label: "Table (context)", value: model.contextId)
                    DetailRow(label: "Club (namespace)", value: model.namespaceId ?? "Unknown")
                    DetailRow(label: "You, as the contract sees you", value: model.view?.me ?? "—")
                    if let view = model.view {
                        DetailRow(label: "Position (FEN)", value: view.fen)
                        DetailRow(label: "Status", value: "\(view.status) · \(view.result) \(view.reason)")
                    }
                } footer: {
                    Text("The rules run in the contract. This app draws the board from its answers and has no chess engine of its own.")
                }
            }
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
