import MeroKit
import MeroKitUI
import StreamCore
import SwiftUI

/// Your streams (the web's `/streams`): a stream is a space you invite people
/// to, and each room in it is one video call.
struct StreamsView: View {
    @StateObject private var model: StreamsModel
    @EnvironmentObject private var nav: Navigator
    @EnvironmentObject private var session: MeroAppSession
    let onSignOut: () -> Void
    @State private var creating = false
    @State private var joining = false
    @State private var shared: SharedLink?

    init(backend: any MeroAppBackend, onSignOut: @escaping () -> Void) {
        _model = StateObject(wrappedValue: StreamsModel(backend: backend))
        self.onSignOut = onSignOut
    }

    var body: some View {
        List {
            Section {
                Text("A **stream** is a space you invite people to. Each **room** inside it is one video call.")
                    .font(.system(size: 15)).foregroundStyle(Palette.inkSoft)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                if let error = model.error {
                    NoticeBanner(text: error) { model.error = nil }
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
                if let notice = model.notice {
                    NoticeBanner(
                        text: notice, symbol: "exclamationmark.triangle.fill", tint: Palette.ink,
                        background: Palette.warnSoft
                    ) { model.notice = nil }
                    .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
            }
            .listRowSeparator(.hidden)

            if !model.hasLoaded {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if model.streams.isEmpty {
                VStack(spacing: 12) {
                    EmptyState(
                        symbol: "square.stack.3d.up", title: "No streams yet",
                        message: model.hasRelay
                            ? "Create one to start a call, or open an invitation link someone sent you."
                            : "Your account has no relay yet. Join a stream with an invitation link first.")
                    if model.hasRelay {
                        Button { creating = true } label: { Label("Create stream", systemImage: "plus") }
                            .buttonStyle(PrimaryButtonStyle())
                    }
                    Button { joining = true } label: { Label("Join with a link", systemImage: "link") }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(model.streams) { stream in
                        Button { nav.path = [stream] } label: { StreamRow(stream: stream) }
                            .buttonStyle(.plain)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                            .swipeActions(edge: .trailing) {
                                Button { invite(stream) } label: { Label("Invite", systemImage: "person.badge.plus") }
                                    .tint(Palette.ink)
                            }
                            .contextMenu {
                                Button { invite(stream) } label: { Label("Invite to stream", systemImage: "person.badge.plus") }
                            }
                    }
                } header: {
                    Text("\(model.streams.count) stream\(model.streams.count == 1 ? "" : "s")")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .streamNavigation("Streams")
        .refreshable { await model.load() }
        .task { await model.load() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button { joining = true } label: { Label("Join with a link", systemImage: "link") }
                    Button(role: .destructive, action: onSignOut) {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "person.crop.circle").accessibilityLabel("Account")
                }
            }
            if model.hasRelay {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { creating = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Create stream")
                }
            }
        }
        .overlay {
            if model.isWorking {
                ProgressView().padding(18).background(RoundedRectangle(cornerRadius: 14).fill(Palette.surface))
            }
        }
        .sheet(isPresented: $creating) {
            NameSheet(
                title: "New stream", action: "Create", placeholder: "Name a new stream", symbol: "square.stack.3d.up",
                hint: "You can invite people to the whole stream, or straight into one of its rooms.",
                busy: model.isWorking
            ) { name in
                if let stream = await model.create(name: name) {
                    Haptics.success()
                    creating = false
                    nav.path = [stream]
                }
            }
        }
        .sheet(isPresented: $joining) {
            JoinLinkSheet(model: model) { landing in
                joining = false
                // A relayless account now has the admitting relay.
                Task { await session.didJoinNamespace() }
                switch landing {
                case .stream(let stream): nav.path = [stream]
                case .room(let stream, let room):
                    nav.autoEnter = room
                    nav.path = [stream]
                }
            }
        }
        .sheet(item: $shared) { link in ShareLinkSheet(text: link.url).presentationDetents([.medium, .large]) }
    }

    private func invite(_ stream: StreamSummary) {
        Haptics.tap()
        Task {
            if let url = await model.inviteLink(for: stream) { shared = SharedLink(url: url) }
        }
    }
}

struct StreamRow: View {
    let stream: StreamSummary

    var body: some View {
        Card {
            HStack(spacing: 14) {
                RowIcon(symbol: "square.stack.3d.up")
                VStack(alignment: .leading, spacing: 4) {
                    Text(stream.title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink)
                        .lineLimit(1)
                    HStack(spacing: 12) {
                        if let rooms = stream.roomCount {
                            Label("\(rooms) room\(rooms == 1 ? "" : "s")", systemImage: "number")
                        }
                        Label("\(stream.memberCount) member\(stream.memberCount == 1 ? "" : "s")", systemImage: "person.2")
                    }
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    .labelStyle(.titleAndIcon)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.muted)
            }
            .padding(14)
        }
    }
}

/// One text field and an action: naming a new stream or room.
struct NameSheet: View {
    let title: String
    let action: String
    let placeholder: String
    let symbol: String
    let hint: String
    let busy: Bool
    let submit: (String) async -> Void
    @State private var name = ""
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: title, action: action, canAct: !trimmed.isEmpty, busy: busy, cancel: { dismiss() },
                act: { Task { await submit(trimmed) } })
            VStack(alignment: .leading, spacing: 12) {
                FieldBox(placeholder: placeholder, text: $name, symbol: symbol)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { if !trimmed.isEmpty { Task { await submit(trimmed) } } }
                Text(hint).font(.system(size: 14)).foregroundStyle(Palette.muted)
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
        .onAppear { focused = true }
    }

    private var trimmed: String { String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60)) }
}

/// Paste an invitation link.
struct JoinLinkSheet: View {
    @ObservedObject var model: StreamsModel
    let onJoined: (InvitationLanding) -> Void
    @State private var text = ""
    @State private var problem: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Join with a link", action: "Join", canAct: !text.trimmingCharacters(in: .whitespaces).isEmpty,
                busy: model.isWorking, cancel: { dismiss() }, act: join)
            VStack(alignment: .leading, spacing: 12) {
                FieldBox(placeholder: "Paste an invitation link", text: $text, symbol: "link")
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if let problem = problem ?? model.error {
                    Text(problem).font(.system(size: 14)).foregroundStyle(Palette.danger)
                }
                Text("A stream link opens its rooms; a room link drops you straight into that call.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
                if UIPasteboard.general.hasStrings {
                    Button {
                        text = UIPasteboard.general.string ?? ""
                    } label: {
                        Label("Paste", systemImage: "doc.on.clipboard")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                Spacer()
            }
            .padding(16)
        }
        .background(Palette.surface)
        .presentationDetents([.medium])
    }

    private func join() {
        guard let invitation = StreamInvitation.parse(text) else {
            problem = StreamError.notAnInvitation.errorDescription
            Haptics.failure()
            return
        }
        problem = nil
        Task {
            if let landing = await model.join(invitation) {
                Haptics.success()
                onJoined(landing)
            } else {
                Haptics.failure()
            }
        }
    }
}
