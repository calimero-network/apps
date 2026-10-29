import MeroKit
import SwiftUI
import VoteCore

/// One poll: where it stands, your ballot, the trustees, the result and its audit.
struct PollScreen: View {
    @StateObject private var model: PollModel
    @StateObject private var group: GroupModel
    @State private var confirm: Confirm?

    init(backend: any MeroAppBackend, route: PollRoute, keys: any TrusteeKeyStore) {
        _model = StateObject(
            wrappedValue: PollModel(backend: backend, group: route.group, pollId: route.pollId, keys: keys))
        _group = StateObject(wrappedValue: GroupModel(backend: backend, group: route.group))
    }

    enum Confirm: String, Identifiable {
        case close, seal
        var id: String { rawValue }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch model.phase {
                case .loading:
                    ForEach(0..<2, id: \.self) { _ in SkeletonCard() }
                case .failed(let message):
                    ErrorState(message: message) { Task { await model.load() } }
                case .loaded:
                    if let view = model.view { content(view) }
                }
            }
            .padding(16)
        }
        .background(Palette.ground)
        .refreshable {
            await model.load()
            await group.refresh()
        }
        .task {
            async let poll: Void = model.load()
            async let people: Void = group.refresh()
            _ = await (poll, people)
        }
        .task { await model.watch() }
        .voteNavigation("Poll")
        .confirmationDialog(
            confirm == .close ? "Close this poll?" : "Seal the count?", isPresented: confirmShown, titleVisibility: .visible,
            presenting: confirm
        ) { which in
            Button(which == .close ? "Close poll" : "Seal", role: .destructive) {
                Haptics.tap()
                Task { which == .close ? await model.closePoll() : await model.sealPoll() }
            }
        } message: { which in
            Text(which == .close ? "No new ballots are accepted after this." : "The ballots your node holds now are frozen and counted.")
        }
    }

    private var confirmShown: Binding<Bool> {
        Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })
    }

    @ViewBuilder private func content(_ view: PollView) -> some View {
        hero(view)
        if !model.trusteesLast { TrusteeCard(model: model, label: group.label) }
        if view.state.phase == .voting { ballot(view) }
        if view.state.phase == .closed, let report = model.report {
            ResultCard(model: model, report: report, label: group.label)
            AuditCard(model: model, report: report, label: group.label)
            if report.anchor != nil || (model.isCreator && report.counts != nil) {
                AnchorCard(model: model, report: report)
            }
        }
        if model.trusteesLast { TrusteeCard(model: model, label: group.label) }
        if view.state.phase != .keyCeremony { turnout(view) }
        Card {
            DetailsDisclosure(rows: [
                ("Poll id", model.pollId),
                ("Election key", view.state.election?.key ?? ""),
                ("Transcript digest", model.report?.transcriptDigest ?? ""),
                ("Your receipt", view.myDigest ?? ""),
            ])
            .padding(.horizontal, 16)
        }
    }

    // MARK: Hero

    private func hero(_ view: PollView) -> some View {
        let def = view.definition
        let phase = view.state.phase
        return Panel {
            PhaseBadge(phase: phase)
            Text(def.title).font(Typeface.display(24)).foregroundStyle(Palette.ink)
            if !def.description.isEmpty {
                Text(def.description).font(.system(size: 16)).foregroundStyle(Palette.inkSoft)
            }
            VStack(alignment: .leading, spacing: 7) {
                fact("person", "Created by \(group.label(def.creator))")
                fact("checkmark", VoteFormat.ruleText(min: def.minChoices, max: def.maxChoices))
                fact("person.2", def.voters.isEmpty ? "Every member can vote." : "\(def.voters.count) eligible voters.")
                if let closes = def.closesAt { fact("calendar", "Planned close \(VoteFormat.date(ms: closes))") }
            }
            steps(phase)
            if let note = model.note { SuccessBanner(text: note) { model.note = nil } }
            if let error = model.error { NoticeBanner(text: error) { model.error = nil }.padding(.horizontal, -16) }
        }
    }

    private func fact(_ symbol: String, _ text: String) -> some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: symbol).frame(width: 18)
        }
        .font(.system(size: 14))
        .foregroundStyle(Palette.inkSoft)
    }

    private func steps(_ phase: Phase) -> some View {
        let at = VoteFormat.stepIndex(phase)
        return HStack(alignment: .top, spacing: 0) {
            ForEach(Array(VoteFormat.steps.enumerated()), id: \.offset) { i, step in
                VStack(spacing: 6) {
                    ZStack {
                        Circle().fill(i < at ? Palette.ink : i == at ? Palette.lime : Palette.sunken)
                        if i < at {
                            Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Palette.lime)
                        } else {
                            Text("\(i + 1)").font(.system(size: 12, weight: .bold))
                                .foregroundStyle(i == at ? Palette.ink : Palette.muted)
                        }
                    }
                    .frame(width: 26, height: 26)
                    Text(step.1).font(.system(size: 11, weight: i == at ? .semibold : .regular))
                        .foregroundStyle(i <= at ? Palette.ink : Palette.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(i == at ? .isSelected : [])
            }
        }
        .padding(.top, 4)
    }

    // MARK: Ballot

    private func ballot(_ view: PollView) -> some View {
        let def = view.definition
        let single = VoteFormat.isSingleChoice(def)
        let rule = VoteFormat.ruleText(min: def.minChoices, max: def.maxChoices)
        return Panel {
            CardHead(
                symbol: "lock.fill", accent: true, title: view.myDigest == nil ? "Your ballot" : "Change your vote",
                meta: view.canVote ? "\(rule) Your choice is encrypted on this device before it is sent." : nil)
            if view.canVote {
                VStack(spacing: 8) {
                    ForEach(def.options.indices, id: \.self) { i in
                        let on = model.selection.indices.contains(i) && model.selection[i]
                        Button {
                            model.toggle(i)
                            Haptics.tap()
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: single ? (on ? "largecircle.fill.circle" : "circle") : (on ? "checkmark.square.fill" : "square"))
                                    .font(.system(size: 20))
                                    .foregroundStyle(on ? Palette.ink : Palette.muted)
                                Text(def.options[i]).font(.system(size: 16, weight: on ? .semibold : .regular))
                                    .foregroundStyle(Palette.ink)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 0)
                            }
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? Palette.limeSoft : Palette.surface))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(on ? Palette.ink : Palette.hairline, lineWidth: on ? 1 : 0.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                Button {
                    Haptics.tap()
                    Task {
                        await model.cast()
                        model.error == nil ? Haptics.success() : Haptics.failure()
                    }
                } label: {
                    if model.busy == "cast" {
                        HStack(spacing: 8) {
                            ProgressView().tint(Palette.ink)
                            Text("Encrypting & proving…")
                        }
                    } else {
                        Label(view.myDigest == nil ? "Encrypt & cast ballot" : "Replace my ballot", systemImage: "lock.fill")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.canCast)
                Label("Encrypted and proven well-formed before it leaves this phone", systemImage: "checkmark.shield")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
            } else {
                Text("You are not on this poll's voter roll.").font(.system(size: 15)).foregroundStyle(Palette.muted)
            }
            if let digest = view.myDigest {
                VStack(alignment: .leading, spacing: 4) {
                    CopyRow(label: "Your receipt", value: digest)
                    Text("After the close, check it appears in the counted list.")
                        .font(.system(size: 13)).foregroundStyle(Palette.muted)
                }
            }
        }
    }

    // MARK: Turnout

    private func turnout(_ view: PollView) -> some View {
        let phase = view.state.phase
        let voters = model.voterList
        return Panel {
            CardHead(
                symbol: "person.2",
                title: phase == .closed ? "Counted ballots (\(model.counted.count))" : "Turnout (\(view.turnout.count))",
                meta: "Who voted is public. What they voted is not.")
            if voters.isEmpty {
                Text("No ballots yet.").font(.system(size: 15)).foregroundStyle(Palette.muted)
            } else {
                FlowLayout(spacing: 8) {
                    ForEach(voters, id: \.self) { v in
                        HStack(spacing: 6) {
                            Avatar(label: group.label(v), seed: v, size: 22)
                            Text(group.label(v) + (v == model.account ? " (you)" : ""))
                                .font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink)
                        }
                        .padding(.leading, 4)
                        .padding(.trailing, 12)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Palette.sunken))
                    }
                }
            }
            if phase == .closed, let digest = view.myDigest {
                if model.myCounted {
                    Callout(tone: .success, title: "Your ballot \(VoteFormat.short(digest)) is in the counted set.", symbol: "checkmark")
                } else {
                    Callout(
                        tone: .warning,
                        title: "Your latest ballot \(VoteFormat.short(digest)) is NOT in the counted set — it reached the creator's node after the seal.")
                }
            }
            if phase == .closing {
                Callout(
                    tone: .info,
                    title: "Closing: nodes refuse new ballots as soon as they see the close, but ballots cast before that are still arriving. "
                        + (model.isCreator ? "Seal once everyone's nodes have caught up." : "The creator seals the count next."),
                    symbol: "clock")
            }
            if model.isCreator && phase == .voting {
                creatorBar("Stops new ballots. The count is frozen in the next step.") {
                    Button(model.busy == "close" ? "Closing…" : "Close poll") { confirm = .close }
                        .buttonStyle(DangerButtonStyle())
                        .disabled(model.busy != nil)
                }
            }
            if model.isCreator && phase == .closing {
                creatorBar("Freezes the ballots your node holds now.") {
                    Button {
                        confirm = .seal
                    } label: {
                        Label(model.busy == "seal" ? "Sealing…" : "Seal the count", systemImage: "lock.fill")
                    }
                    .buttonStyle(DangerButtonStyle())
                    .disabled(model.busy != nil)
                }
            }
        }
    }

    private func creatorBar<B: View>(_ text: String, @ViewBuilder button: () -> B) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(Palette.hairline).frame(height: 0.5)
            Text(text).font(.system(size: 14)).foregroundStyle(Palette.muted)
            button()
        }
    }
}
