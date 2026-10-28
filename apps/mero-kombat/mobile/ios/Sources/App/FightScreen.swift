import KombatCore
import MeroKit
import MeroKitUI
import SwiftUI

/// The fight, full screen and sideways: the game page edge to edge, the pad under the thumbs, a
/// slim bar of round buttons on top. Shared by an arena and practice.
///
/// Held on screen: the display never sleeps mid-round. Sent to the background: the page stops,
/// every pad button is let go, and it picks up where it was on return.
struct FightStage<Bar: View, Bottom: View>: View {
    let host: GameHost
    let showPad: Bool
    @ObservedObject var pad: FightPad
    @ViewBuilder var bar: Bar
    @ViewBuilder var bottom: Bottom
    let onPause: () -> Void
    let onResume: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Theme.stage.ignoresSafeArea()
            GameWebView(host: host).ignoresSafeArea()
            VStack(spacing: 0) {
                HStack(spacing: 8) { bar }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                Spacer(minLength: 0)
                ZStack(alignment: .bottom) {
                    if showPad {
                        HStack(alignment: .bottom) {
                            DPadView(pad: pad)
                            Spacer(minLength: 0)
                            ActionPadView(pad: pad)
                        }
                    }
                    bottom.padding(.bottom, 6)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .persistentSystemOverlays(.hidden)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            let target = host
            pad.send = { [weak target] in target?.deliver?($0) }
        }
        .onDisappear {
            pad.releaseAll()
            UIApplication.shared.isIdleTimerDisabled = false
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                UIApplication.shared.isIdleTimerDisabled = true
                onResume()
            } else {
                pad.releaseAll()
                onPause()
            }
        }
    }
}

/// A round, translucent button for the bar over the arena.
struct StageButton: View {
    let symbol: String
    let label: String
    var on = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(on ? Theme.ink : Theme.onStage)
                .frame(width: 38, height: 38)
                .background(Circle().fill(on ? Theme.lime : Theme.padFill))
                .overlay(Circle().strokeBorder(Theme.padLine, lineWidth: 1))
        }
        .accessibilityLabel(label)
    }
}

/// A pill of text on the stage.
struct StagePill: View {
    let text: String
    var dot: Color?

    var body: some View {
        HStack(spacing: 6) {
            if let dot { Circle().fill(dot).frame(width: 7, height: 7) }
            Text(text).font(Theme.body(12, .semibold)).foregroundStyle(Theme.onStage).lineLimit(1)
        }
        .padding(.horizontal, 10)
        .frame(height: 28)
        .background(Capsule().fill(Theme.padFill))
        .overlay(Capsule().strokeBorder(Theme.padLine, lineWidth: 1))
    }
}

// MARK: - An arena

struct ArenaScreen: View {
    @StateObject private var model: ArenaModel
    @StateObject private var pad = FightPad()
    @Environment(\.dismiss) private var dismiss
    @State private var sheet: ArenaSheet?
    @State private var share: SharedLink?
    @State private var actionError: String?

    enum ArenaSheet: String, Identifiable {
        case fighters, record, details
        var id: String { rawValue }
    }

    init(backend: any MeroAppBackend, ref: ArenaRef, store: PlayerStore) {
        let presence = (backend as? DelegatedAppBackend)?.connection.presence.map {
            RelayPresenceChannel(client: $0, contextId: ref.contextId) as any PresenceChannel
        }
        _model = StateObject(wrappedValue: ArenaModel(backend: backend, ref: ref, store: store, presence: presence))
    }

    var body: some View {
        FightStage(
            host: model, showPad: model.mode == .net, pad: pad,
            bar: { bar }, bottom: { bottom },
            onPause: model.pause, onResume: model.resume
        )
        .task { await model.run() }
        .onDisappear { Task { await model.leaveScreen() } }
        .onChange(of: sheet) { open in if open != nil { pad.releaseAll() } }
        .sheet(item: $sheet) { which in
            switch which {
            case .fighters: CornersSheet(model: model)
            case .record: RecordSheet(model: model)
            case .details: ArenaDetailsSheet(model: model)
            }
        }
        .sheet(item: $share) { link in ShareSheet(items: [link.url]) }
    }

    @ViewBuilder private var bar: some View {
        StageButton(symbol: "chevron.left", label: "Arenas") { dismiss() }
        VStack(alignment: .leading, spacing: 1) {
            Text(model.view?.title ?? KombatConstants.defaultTitle)
                .font(Theme.heading(15)).foregroundStyle(Theme.onStage).lineLimit(1)
            Text("Match \((model.view?.matchIndex ?? 0) + 1)")
                .font(Theme.body(11, .medium)).foregroundStyle(Theme.onStageMuted)
        }
        StagePill(text: model.statusText, dot: model.view?.status == "fighting" ? Theme.lime : nil)
        Spacer(minLength: 4)
        if model.meter.sent > 0 {
            StagePill(text: "\(model.meter.ok) tx · \(model.meter.lastMs) ms")
        }
        StageButton(symbol: model.muted ? "speaker.slash.fill" : "speaker.wave.2.fill", label: model.muted ? "Sound on" : "Sound off") {
            model.muted.toggle()
        }
        StageButton(symbol: "person.2.fill", label: "Fighters") { sheet = .fighters }
        Menu {
            Button { invite() } label: { Label("Invite an opponent", systemImage: "square.and.arrow.up") }
            Button { sheet = .record } label: { Label("Record", systemImage: "list.number") }
            Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
            Button { sheet = .details } label: { Label("Details", systemImage: "info.circle") }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.onStage)
                .frame(width: 38, height: 38)
                .background(Circle().fill(Theme.padFill))
                .overlay(Circle().strokeBorder(Theme.padLine, lineWidth: 1))
        }
        .accessibilityLabel("More")
    }

    @ViewBuilder private var bottom: some View {
        VStack(spacing: 8) {
            if let message = model.error ?? actionError {
                ErrorBanner(message: message) {
                    model.dismissError()
                    actionError = nil
                }
                .frame(maxWidth: 360)
            }
            if model.view == nil {
                StagePill(text: "Reading the arena…")
            } else if !model.isSeated {
                Button {
                    sheet = .fighters
                } label: {
                    Label("Take a corner", systemImage: "figure.martial.arts")
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                Text("You are watching. Take a free corner to fight.")
                    .font(Theme.body(12, .medium)).foregroundStyle(Theme.onStageMuted)
            } else if model.isFinished {
                Button {
                    Haptics.tap()
                    Task { await model.rematch() }
                } label: {
                    Label("Rematch", systemImage: "arrow.clockwise")
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                .disabled(model.busy)
            } else if model.view?.status == "waiting" {
                StagePill(text: "Waiting for an opponent")
                Button { invite() } label: { Label("Invite an opponent", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: false))
            }
        }
    }

    private func invite() {
        pad.releaseAll()
        Task {
            do {
                share = SharedLink(url: try await model.inviteLink())
            } catch {
                actionError = KombatText.error(error)
            }
        }
    }
}

// MARK: - Practice

struct PracticeScreen: View {
    @StateObject private var model: PracticeModel
    @StateObject private var pad = FightPad()
    @Environment(\.dismiss) private var dismiss
    @State private var choosing = false

    init(store: PlayerStore) {
        _model = StateObject(wrappedValue: PracticeModel(store: store))
    }

    var body: some View {
        FightStage(
            host: model, showPad: true, pad: pad,
            bar: {
                StageButton(symbol: "chevron.left", label: "Back") { dismiss() }
                VStack(alignment: .leading, spacing: 1) {
                    Text("You versus the CPU").font(Theme.heading(15)).foregroundStyle(Theme.onStage)
                    Text("Practice · offline").font(Theme.body(11, .medium)).foregroundStyle(Theme.onStageMuted)
                }
                Spacer(minLength: 4)
                StageButton(
                    symbol: model.muted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                    label: model.muted ? "Sound on" : "Sound off"
                ) { model.muted.toggle() }
                StageButton(symbol: "person.fill", label: "Choose your fighter") { choosing = true }
            },
            bottom: {
                if model.over {
                    Button {
                        Haptics.tap()
                        model.rematch()
                    } label: {
                        Label("Rematch", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                }
            },
            onPause: { model.deliver?(.pause) }, onResume: { model.deliver?(.resume) }
        )
        .onChange(of: choosing) { open in if open { pad.releaseAll() } }
        .sheet(isPresented: $choosing) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        FighterGrid(selected: model.fighter, disabled: false) {
                            model.choose($0)
                            choosing = false
                        }
                        HowToFight()
                    }
                    .padding(20)
                }
                .background(Theme.ground)
                .navigationTitle("Choose your fighter")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { choosing = false } } }
            }
        }
    }
}

// MARK: - Sheets

/// The two corners, your name and your fighter: the web app's "Fighters" card.
struct CornersSheet: View {
    @ObservedObject var model: ArenaModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let view = model.view {
                        HStack(alignment: .top, spacing: 12) {
                            corner(view.p1, in: view)
                            Text("VS").font(Theme.heading(15)).foregroundStyle(Theme.muted).padding(.top, 30)
                            corner(view.p2, in: view)
                        }
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Your name").font(Theme.body(13, .semibold)).foregroundStyle(Theme.muted)
                        TextField(KombatConstants.defaultName, text: $model.name)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surface))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.line))
                            .disabled(model.isSeated)
                            .onChange(of: model.name) { if $0.count > 24 { model.name = String($0.prefix(24)) } }
                    }
                    FighterGrid(selected: model.fighter, disabled: model.busy) { id in
                        Task { await model.choose(id) }
                    }
                    HowToFight()
                }
                .padding(20)
            }
            .background(Theme.ground)
            .navigationTitle("Fighters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                if model.isFinished && model.isSeated {
                    ToolbarItem(placement: .navigationBarLeading) {
                        Button { Task { await model.rematch() } } label: { Label("Rematch", systemImage: "arrow.clockwise") }
                            .disabled(model.busy)
                    }
                }
            }
        }
    }

    private func corner(_ fighter: FighterView, in view: ArenaView) -> some View {
        let empty = fighter.member.isEmpty
        let mine = !empty && fighter.member == view.me
        let live = model.live.contains(fighter.seat)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                FighterBadge(fighter: empty ? nil : fighter.fighter, size: 52, mirrored: fighter.seat == "p2")
                VStack(alignment: .leading, spacing: 3) {
                    Text(empty ? "Open corner" : KombatText.name(fighter) + (mine ? " · you" : ""))
                        .font(Theme.heading(16)).foregroundStyle(Theme.ink).lineLimit(1)
                    if empty {
                        Text(fighter.seat == "p1" ? "Left side" : "Right side")
                            .font(Theme.body(13)).foregroundStyle(Theme.muted)
                    } else {
                        HStack(spacing: 5) {
                            Circle().fill(live ? Theme.online : Theme.line).frame(width: 7, height: 7)
                            Text("\(FighterInfo.of(fighter.fighter).name.capitalized) · \(live ? "in the arena" : "away")")
                                .font(Theme.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
                Text("\(fighter.matchesWon)").font(Theme.heading(20)).foregroundStyle(Theme.ink)
                    .accessibilityLabel("\(fighter.matchesWon) matches won")
            }
            if empty && !model.isSeated {
                Button {
                    Haptics.tap()
                    Task { await model.sit(fighter.seat) }
                } label: {
                    Text("Fight here")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.busy)
            }
            if model.canLeave(fighter) {
                Button("Leave") { Task { await model.stand() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.busy)
            }
        }
        .card(padding: 14)
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                .strokeBorder(mine ? Theme.lime : Color.clear, lineWidth: 2))
    }
}

/// The four fighters, as tiles.
struct FighterGrid: View {
    let selected: String
    let disabled: Bool
    let onChoose: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Choose your fighter").font(Theme.body(13, .semibold)).foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                ForEach(FighterInfo.roster) { info in
                    let on = info.id == selected
                    Button {
                        Haptics.tap()
                        onChoose(info.id)
                    } label: {
                        VStack(spacing: 6) {
                            FighterBadge(fighter: info.id, size: 56)
                            Text(info.name).font(Theme.body(13, .bold)).foregroundStyle(Theme.ink)
                            Text(info.special).font(Theme.body(11)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? Theme.limeSoft : Theme.surface))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .strokeBorder(on ? Theme.lime : Theme.line, lineWidth: on ? 2 : 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(disabled)
                    .accessibilityLabel("\(info.name), \(info.title)")
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            Text(FighterInfo.of(selected).title).font(Theme.body(13)).foregroundStyle(Theme.muted)
        }
    }
}

/// The web app's pad hint.
struct HowToFight: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("How to fight").font(Theme.body(13, .semibold)).foregroundStyle(Theme.muted)
            Text("Down + Punch is an uppercut, Down + Kick a sweep, Kick in the air a flying kick. Hold Block to guard.")
                .font(Theme.body(14)).foregroundStyle(Theme.ink2)
        }
        .card(padding: 14)
    }
}

/// Finished matches, newest first: the web app's "Record" card.
struct RecordSheet: View {
    @ObservedObject var model: ArenaModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if model.record.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "list.number").font(.system(size: 28)).foregroundStyle(Theme.muted)
                        Text("No finished matches yet").font(Theme.heading(17)).foregroundStyle(Theme.ink)
                        Text("Win two rounds to take a match.").font(Theme.body(14)).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let view = model.view {
                    List(model.record, id: \.index) { match in
                        HStack(spacing: 12) {
                            Text("Match \(match.index + 1)").font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                            Text(KombatText.winner(match.winner, in: view)).font(Theme.body(15)).foregroundStyle(Theme.ink2)
                            if match.flawless {
                                Text("Flawless").font(Theme.body(11, .bold)).foregroundStyle(Theme.ink)
                                    .padding(.horizontal, 8).padding(.vertical, 3)
                                    .background(Capsule().fill(Theme.lime))
                            }
                            Spacer()
                            Text("\(match.actions) tx").font(Theme.mono).foregroundStyle(Theme.muted)
                        }
                        .listRowBackground(Theme.surface)
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.ground)
            .navigationTitle("Record")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

/// Ids and the chain counts, for whoever needs them.
struct ArenaDetailsSheet: View {
    @ObservedObject var model: ArenaModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DetailRow(label: "Arena (context)", value: model.contextId)
                    DetailRow(label: "Namespace", value: model.ref.namespaceId ?? "Unknown")
                    DetailRow(label: "You", value: model.view?.me ?? "")
                } header: {
                    Text("Ids")
                }
                Section {
                    DetailRow(label: "Every action at this arena", value: "\(model.view?.totalActions ?? 0) tx")
                    DetailRow(label: "This match", value: "\(model.view?.matchActions ?? 0) tx")
                    DetailRow(
                        label: "Sent from this phone",
                        value: "\(model.meter.sent) sent · \(model.meter.ok) confirmed · \(model.meter.failed) failed")
                    DetailRow(label: "Presence", value: model.hasPresence ? "Through your relay" : "Unavailable on this session")
                } header: {
                    Text("Chain")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
