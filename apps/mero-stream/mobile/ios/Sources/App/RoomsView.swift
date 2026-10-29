import MeroKit
import StreamCore
import SwiftUI

/// One stream's rooms (the web's `/streams/:id`). Each room is one video call.
struct RoomsView: View {
    @StateObject private var model: RoomsModel
    @EnvironmentObject private var nav: Navigator
    @State private var creating = false
    @State private var shared: SharedLink?

    init(stream: StreamSummary, backend: any MeroAppBackend, applicationId: String?) {
        _model = StateObject(wrappedValue: RoomsModel(stream: stream, backend: backend, applicationId: applicationId))
    }

    var body: some View {
        List {
            Section {
                Text("Each **room** is one video call. Everyone invited to this stream can join any room in it; a room link drops them straight into that call.")
                    .font(.system(size: 15)).foregroundStyle(Palette.inkSoft)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
                if let error = model.error {
                    NoticeBanner(text: error) { model.error = nil }
                        .listRowBackground(Color.clear).listRowInsets(EdgeInsets())
                }
                if let status = model.status {
                    HStack(spacing: 10) {
                        ProgressView().tint(Palette.ink)
                        Text(status).font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
                    }
                    .listRowBackground(Color.clear)
                }
            }
            .listRowSeparator(.hidden)

            if !model.hasLoaded {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else if model.rooms.isEmpty {
                VStack(spacing: 12) {
                    EmptyState(
                        symbol: "video", title: "No rooms yet",
                        message: "Create a room to start a call. If you just joined, rooms appear as the stream syncs; pull to refresh.")
                    Button { creating = true } label: { Label("Create room", systemImage: "plus") }
                        .buttonStyle(PrimaryButtonStyle())
                }
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
            } else {
                Section {
                    ForEach(model.rooms) { room in
                        RoomRow(
                            room: room, roster: room.contextId.flatMap { model.rosters[$0] },
                            busy: model.pending == "enter:\(room.id)"
                        ) { enter(room) }
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                        .swipeActions(edge: .trailing) {
                            Button { invite(room) } label: { Label("Invite", systemImage: "person.badge.plus") }
                                .tint(Palette.ink)
                        }
                        .contextMenu {
                            Button { invite(room) } label: { Label("Invite to this room", systemImage: "person.badge.plus") }
                        }
                    }
                } header: {
                    Text("\(model.rooms.count) room\(model.rooms.count == 1 ? "" : "s")")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
                }
            }

            DetailsDisclosure(rows: [("Stream ID", model.stream.id)])
                .listRowBackground(Color.clear).listRowSeparator(.hidden)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .streamNavigation(model.stream.title)
        .refreshable { await model.load() }
        .task {
            await model.load()
            if let room = nav.autoEnter, room.namespaceId == model.stream.id {
                nav.autoEnter = nil
                enter(model.rooms.first { $0.id == room.id } ?? room)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { inviteStream() } label: { Image(systemName: "person.badge.plus") }
                    .accessibilityLabel("Invite to stream")
                    .disabled(model.pending != nil)
                Button { creating = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Create room")
            }
        }
        .sheet(isPresented: $creating) {
            NameSheet(
                title: "New room", action: "Create", placeholder: "Name a new room", symbol: "number",
                hint: "A room is one video call. Everyone in this stream can join it.",
                busy: model.pending == "create"
            ) { name in
                if let room = await model.create(name: name) {
                    Haptics.success()
                    creating = false
                    open(room)
                }
            }
        }
        .sheet(item: $shared) { link in ShareLinkSheet(text: link.url).presentationDetents([.medium, .large]) }
    }

    private func enter(_ room: RoomSummary) {
        Haptics.tap()
        Task {
            if let entered = await model.enter(room) { open(entered) } else { Haptics.failure() }
        }
    }

    private func open(_ room: RoomSummary) {
        guard let contextId = room.contextId else { return }
        nav.call = CallTarget(stream: model.stream, room: room, contextId: contextId)
    }

    private func invite(_ room: RoomSummary) {
        Haptics.tap()
        Task { if let url = await model.inviteLink(for: room) { shared = SharedLink(url: url) } }
    }

    private func inviteStream() {
        Haptics.tap()
        Task { if let url = await model.streamInviteLink() { shared = SharedLink(url: url) } }
    }
}

struct RoomRow: View {
    let room: RoomSummary
    let roster: [Member]?
    let busy: Bool
    let join: () -> Void

    var body: some View {
        Card {
            HStack(spacing: 14) {
                RowIcon(symbol: "video")
                VStack(alignment: .leading, spacing: 6) {
                    Text(room.title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.ink).lineLimit(1)
                    if let roster, !roster.isEmpty {
                        HStack(spacing: -8) {
                            ForEach(roster.prefix(4), id: \.memberId) { member in
                                Avatar(name: member.username.isEmpty ? member.memberId : member.username, seed: member.memberId, size: 24)
                                    .overlay(Circle().stroke(Palette.surface, lineWidth: 2))
                            }
                            Text(rosterLine(roster)).font(.system(size: 13)).foregroundStyle(Palette.muted)
                                .padding(.leading, 14).lineLimit(1)
                        }
                    } else {
                        Text(room.contextId == nil ? "Still syncing" : "No one has joined yet")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    }
                }
                Spacer(minLength: 8)
                Button(action: join) {
                    if busy { ProgressView().tint(Palette.ink).frame(minWidth: 40) } else { Text("Join") }
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
                .disabled(busy || room.contextId == nil)
            }
            .padding(14)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: join)
    }

    private func rosterLine(_ roster: [Member]) -> String {
        let names = roster.map { $0.username.isEmpty ? People.shortId($0.memberId) : $0.username }
        return names.count <= 2 ? names.joined(separator: ", ") : "\(names[0]), \(names[1]) and \(names.count - 2) more"
    }
}
