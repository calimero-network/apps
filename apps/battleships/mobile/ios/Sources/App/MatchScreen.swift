import BattleshipsCore
import SwiftUI

/// One match: place your fleet, take turns, see the audited result, rematch.
struct MatchScreen: View {
    enum Waters: String, CaseIterable {
        case theirs = "Their waters"
        case yours = "Your fleet"
    }

    @StateObject private var model: MatchModel
    let route: MatchRoute
    let rematched: (MatchRoute) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var waters: Waters = .theirs
    @State private var rematching = false

    init(backend: any BattleshipsBackend, route: MatchRoute, store: any BoardStore, rematched: @escaping (MatchRoute) -> Void) {
        _model = StateObject(wrappedValue: MatchModel(ref: route.ref, me: route.me, backend: backend, store: store))
        self.route = route
        self.rematched = rematched
    }

    private var opponentName: String { Names.player(route.ref.opponent, me: route.me) }

    var body: some View {
        VStack(spacing: 0) {
            if let notice = model.notice {
                NoticeBanner(text: notice) { model.notice = nil }
            }
            ScrollView {
                VStack(spacing: 16) {
                    stageContent
                    DetailsDisclosure(rows: [
                        ("Match", route.ref.matchId),
                        ("Match context", route.ref.contextId),
                        ("Lobby context", route.ref.lobbyContextId),
                        ("You play as", route.me),
                        ("Opponent", route.ref.opponent),
                        ("Your commitment", model.stored?.commitment ?? ""),
                    ])
                }
                .padding(16)
            }
            .refreshable { await model.refresh() }
        }
        .background(Palette.ground.ignoresSafeArea())
        .appNavigation("vs \(opponentName)")
        .safeAreaInset(edge: .bottom) { bottomBar }
        .task {
            await model.refresh()
            await model.live()
        }
        .onChange(of: model.stage) { stage in
            if stage == .finished {
                model.outcome == .won ? Haptics.success() : Haptics.heavy()
            }
        }
    }

    // MARK: Stages

    @ViewBuilder
    private var stageContent: some View {
        switch model.stage {
        case .loading:
            VStack(spacing: 12) {
                ProgressView().tint(Palette.ink)
                Text(model.syncing ? "Waiting for the match to reach your relay…" : "Opening the match…")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 80)
        case .failed(let message):
            ErrorState(message: message) { Task { await model.refresh() } }
        case .placing:
            placement
        case .waiting:
            waiting
        case .battle:
            battle
        case .finished:
            finished
        case .boardMissing:
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    SymbolTile(symbol: "iphone.slash", tone: Palette.dangerSoft, tint: Palette.danger)
                    Text("Your fleet is on another device").font(Typeface.display(19)).foregroundStyle(Palette.ink)
                    Text(
                        "You deployed this match's fleet somewhere else. Only that device holds the board, so only it can answer shots and reveal it at the end. Open the match there."
                    )
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
                }
            }
        }
    }

    // MARK: Placement

    private var placement: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Place your fleet").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                Text("Tap a square to place the selected ship. Tap a placed ship to turn it. Ships can't touch.")
                    .font(.system(size: 15)).foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Card(padding: 12) {
                BoardGrid(looks: BoardLooks.placement(model.layout, selected: model.selectedShip)) { cell in
                    if model.tapPlacement(cell) { Haptics.tap() } else { Haptics.failure() }
                }
            }
            ShipTray(model: model)
            HStack(spacing: 10) {
                Button {
                    model.toggleOrientation()
                    Haptics.tap()
                } label: {
                    Label(
                        model.horizontal ? "Across" : "Down",
                        systemImage: model.horizontal ? "arrow.left.and.right" : "arrow.up.and.down")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                Button {
                    model.shuffle()
                    Haptics.tap()
                } label: {
                    Label("Shuffle", systemImage: "shuffle")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                Button {
                    model.clearLayout()
                    Haptics.tap()
                } label: {
                    Label("Clear", systemImage: "trash")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                .disabled(model.layout.placedCount == 0)
            }
            HStack(spacing: 8) {
                Image(systemName: "lock.fill").font(.system(size: 12))
                Text("Your board stays on this phone. Only a sealed fingerprint of it is shared until the match ends.")
                    .font(.system(size: 13))
            }
            .foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Waiting

    private var waiting: some View {
        VStack(spacing: 14) {
            Card {
                HStack(spacing: 12) {
                    ProgressView().tint(Palette.ink)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Fleet deployed").font(Typeface.display(18)).foregroundStyle(Palette.ink)
                        Text("Waiting for \(opponentName) to place theirs.").font(.system(size: 15)).foregroundStyle(Palette.muted)
                    }
                }
            }
            SectionLabel(text: "Your fleet")
            Card(padding: 12) { BoardGrid(looks: BoardLooks.own(board: model.ownBoard, sunk: model.ownSunk)) }
        }
    }

    // MARK: Battle

    private var battle: some View {
        VStack(spacing: 14) {
            TurnBanner(text: model.turnText, mine: model.isMyTurn)
            Picker("Board", selection: $waters) {
                ForEach(Waters.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            Card(padding: 12) {
                if waters == .theirs {
                    BoardGrid(looks: BoardLooks.enemy(shots: model.shots, sunk: model.enemySunk, aim: model.aim)) { cell in
                        Task {
                            let wasAimed = model.aim == cell
                            await model.tapTarget(cell)
                            if wasAimed { Haptics.heavy() } else if model.aim == cell { Haptics.tap() }
                        }
                    }
                } else {
                    BoardGrid(looks: BoardLooks.own(board: model.ownBoard, sunk: model.ownSunk))
                }
            }
            FleetStatus(theirsSunk: model.enemySunk.count, yoursSunk: model.ownSunk.count, legend: true)
        }
    }

    // MARK: Finished

    private var finished: some View {
        VStack(spacing: 14) {
            ResultCard(outcome: model.outcome ?? .auditing, detail: model.endedText, opponent: opponentName)
            Picker("Board", selection: $waters) {
                ForEach(Waters.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            Card(padding: 12) {
                if waters == .theirs {
                    BoardGrid(looks: BoardLooks.enemy(shots: model.shots, sunk: model.enemySunk, aim: nil))
                } else {
                    BoardGrid(looks: BoardLooks.own(board: model.ownBoard, sunk: model.ownSunk))
                }
            }
            FleetStatus(theirsSunk: model.enemySunk.count, yoursSunk: model.ownSunk.count, legend: false)
        }
    }

    // MARK: Bottom bar

    @ViewBuilder
    private var bottomBar: some View {
        switch model.stage {
        case .placing:
            bar {
                Button {
                    Task {
                        Haptics.tap()
                        if await model.deploy() { Haptics.success() } else { Haptics.failure() }
                    }
                } label: {
                    if model.busy {
                        ProgressView().tint(Palette.ink)
                    } else {
                        Label(
                            model.layout.isComplete
                                ? "Deploy fleet" : "Place \(Fleet.classes.count - model.layout.placedCount) more",
                            systemImage: "checkmark.shield")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.layout.isComplete || model.busy)
            }
        case .battle where model.aim != nil:
            bar {
                HStack(spacing: 10) {
                    Button {
                        model.clearAim()
                    } label: {
                        Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).frame(width: 50, height: 50)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.ink)
                    .background(Circle().fill(Palette.surface))
                    .overlay(Circle().stroke(Palette.hairline, lineWidth: 1))
                    .accessibilityLabel("Cancel aim")
                    Button {
                        Task {
                            Haptics.heavy()
                            await model.fire()
                        }
                    } label: {
                        if model.busy {
                            ProgressView().tint(Palette.ink)
                        } else {
                            Label("Fire at \(model.aim?.label ?? "")", systemImage: "scope")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.busy)
                }
            }
        case .finished:
            bar {
                HStack(spacing: 10) {
                    Button("Lobby") { dismiss() }.buttonStyle(SecondaryButtonStyle())
                    Button {
                        rematch()
                    } label: {
                        if rematching {
                            ProgressView().tint(Palette.ink)
                        } else {
                            Label("Rematch", systemImage: "arrow.counterclockwise")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(rematching)
                }
            }
        default:
            EmptyView()
        }
    }

    private func bar<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Palette.ground.opacity(0.96).ignoresSafeArea())
    }

    private func rematch() {
        guard !rematching else { return }
        rematching = true
        Haptics.tap()
        Task {
            do {
                let ref = try await MatchMaker.create(
                    backend: model.backend, namespace: route.lobby, lobbyContextId: route.ref.lobbyContextId,
                    opponent: route.ref.opponent)
                Haptics.success()
                rematched(MatchRoute(ref: ref, me: route.me, lobby: route.lobby))
            } catch {
                model.notice = ErrorText.describe(error, fallback: "Couldn't start a rematch. Try again.")
                Haptics.failure()
            }
            rematching = false
        }
    }
}

/// The five ships: tap one to select it (to place or move it); a placed one can be taken back.
private struct ShipTray: View {
    @ObservedObject var model: MatchModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Fleet.classes.indices, id: \.self) { index in
                    let ship = Fleet.classes[index]
                    let placed = model.layout.ships[index] != nil
                    let selected = model.selectedShip == index
                    Button {
                        model.select(index)
                        Haptics.tap()
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 4) {
                                Text(ship.name).font(.system(size: 14, weight: .semibold))
                                if placed { Image(systemName: "checkmark.circle.fill").font(.system(size: 12)) }
                            }
                            HStack(spacing: 2) {
                                ForEach(0..<ship.length, id: \.self) { _ in
                                    RoundedRectangle(cornerRadius: 2).fill(selected ? Palette.ink : Palette.ship.opacity(placed ? 0.35 : 0.85))
                                        .frame(width: 10, height: 10)
                                }
                            }
                        }
                        .foregroundStyle(Palette.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected ? Palette.lime : Palette.surface))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(selected ? Palette.lime : Palette.hairline, lineWidth: selected ? 1 : 0.5))
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        if placed {
                            Button(role: .destructive) { model.remove(index) } label: {
                                Label("Take back", systemImage: "arrow.uturn.backward")
                            }
                        }
                    }
                    .accessibilityLabel("\(ship.name), \(ship.length) squares\(placed ? ", placed" : "")")
                }
            }
        }
    }
}

private struct TurnBanner: View {
    let text: String
    let mine: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: mine ? "scope" : "hourglass")
                .font(.system(size: 16, weight: .semibold))
            Text(text).font(.system(size: 16, weight: .semibold))
            Spacer()
        }
        .foregroundStyle(Palette.ink)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(mine ? Palette.lime : Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: mine ? 0 : 0.5))
        .animation(.easeOut(duration: 0.2), value: mine)
    }
}

private struct FleetStatus: View {
    let theirsSunk: Int
    let yoursSunk: Int
    let legend: Bool

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                tile("Their fleet", sunk: theirsSunk)
                tile("Your fleet", sunk: yoursSunk)
            }
            if legend {
                HStack(spacing: 14) {
                    key(.hit, "Hit")
                    key(.sunk, "Sunk")
                    key(.miss, "Miss")
                    key(.pending, "Waiting")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func tile(_ title: String, sunk: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.muted)
            Text("\(sunk) of \(Fleet.classes.count) sunk").font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }

    private func key(_ look: SquareLook, _ label: String) -> some View {
        HStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 3).fill(look.fill)
                if let symbol = look.symbol {
                    Image(systemName: symbol).font(.system(size: 14 * look.symbolScale * 1.6, weight: .bold)).foregroundStyle(look.tint)
                }
            }
            .frame(width: 16, height: 16)
            Text(label).font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
    }
}

private struct ResultCard: View {
    let outcome: MatchModel.Outcome
    let detail: String?
    let opponent: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(outcome == .won ? Palette.ink : tint)
                .frame(width: 68, height: 68)
                .background(Circle().fill(tone))
            Text(title).font(Typeface.display(28, weight: .bold)).foregroundStyle(Palette.ink)
            Text(detail ?? subtitle)
                .font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Palette.hairline, lineWidth: 0.5))
    }

    private var title: String {
        switch outcome {
        case .won: return "Victory"
        case .lost: return "Defeat"
        case .auditing: return "Checking the boards"
        case .void: return "No winner"
        }
    }

    private var subtitle: String {
        switch outcome {
        case .won: return "You sank \(opponent)'s fleet, and your board checked out."
        case .lost: return "\(opponent) sank your fleet."
        case .auditing: return "Both boards are revealed and checked against every answer. This takes a moment."
        case .void: return "Neither board matched its answers."
        }
    }

    private var symbol: String {
        switch outcome {
        case .won: return "trophy.fill"
        case .lost: return "flag.fill"
        case .auditing: return "checkmark.shield"
        case .void: return "exclamationmark.triangle"
        }
    }

    private var tone: Color {
        switch outcome {
        case .won: return Palette.lime
        case .lost: return Palette.sunken
        case .auditing: return Palette.pendingSoft
        case .void: return Palette.dangerSoft
        }
    }

    private var tint: Color {
        switch outcome {
        case .won, .lost: return Palette.ink
        case .auditing: return Palette.pending
        case .void: return Palette.danger
        }
    }
}
