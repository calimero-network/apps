import MeroKit
import SwiftUI

/// A workspace's channels and DMs.
struct ChannelsScreen: View {
    @ObservedObject var session: SessionModel
    let backend: DelegatedChatBackend
    @StateObject private var model: ChannelsModel
    @State private var creating = false

    init(session: SessionModel, backend: DelegatedChatBackend, workspace: Workspace) {
        self.session = session
        self.backend = backend
        _model = StateObject(
            wrappedValue: ChannelsModel(
                workspace: workspace, backend: backend,
                displayName: { [weak session] in session?.displayName ?? "" }))
    }

    var body: some View {
        List {
            StatusBanners(error: $model.errorText, notice: .constant(nil))
            Section("Channels") {
                if model.channels.isEmpty, !model.isLoading {
                    Text("No channels yet.").foregroundStyle(.secondary)
                }
                ForEach(model.channels) { channel in
                    ChannelRow(channel: channel, model: model)
                }
            }
            if !model.directMessages.isEmpty {
                Section("Direct messages") {
                    ForEach(model.directMessages) { channel in
                        ChannelRow(channel: channel, model: model)
                    }
                }
            }
        }
        .overlay {
            if model.isLoading && model.channels.isEmpty && model.directMessages.isEmpty { ProgressView() }
        }
        .navigationTitle(model.workspace.name)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    creating = true
                } label: {
                    if model.isWorking { ProgressView() } else { Image(systemName: "plus") }
                }
                .accessibilityLabel("New channel")
            }
        }
        .task { await model.load() }
        .refreshable { await model.load() }
        .sheet(isPresented: $creating) {
            NewChannelSheet { name, isPublic in
                await model.create(name: name, isPublic: isPublic)
            }
        }
    }
}

private struct ChannelRow: View {
    let channel: ChannelEntry
    @ObservedObject var model: ChannelsModel

    var body: some View {
        if channel.isJoined {
            NavigationLink(value: channel) {
                label
            }
            .simultaneousGesture(TapGesture().onEnded { model.markOpened(channel.id) })
        } else {
            HStack {
                label
                Spacer()
                Button("Join") {
                    Task { await model.join(channel) }
                }
                .buttonStyle(.bordered)
                .disabled(model.isWorking)
            }
        }
    }

    private var label: some View {
        HStack {
            Image(systemName: channel.kind == .dm ? "person.fill" : "number")
                .foregroundStyle(.secondary)
            Text(channel.name)
                .fontWeight(channel.unread > 0 ? .semibold : .regular)
            Spacer()
            if channel.unread > 0 {
                Text("\(channel.unread)")
                    .font(.caption.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.accentColor))
                    .foregroundStyle(.white)
                    .accessibilityLabel("\(channel.unread) unread")
            }
        }
    }
}

private struct NewChannelSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isPublic = true
    @State private var working = false
    let onCreate: (String, Bool) async -> Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField("Channel name", text: $name)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Toggle("Public", isOn: $isPublic)
                Text(
                    isPublic
                        ? "Everyone in the workspace can find and join it."
                        : "Only members you add can see it."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .navigationTitle("New channel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working {
                        ProgressView()
                    } else {
                        Button("Create") {
                            Task {
                                working = true
                                let ok = await onCreate(name, isPublic)
                                working = false
                                if ok { dismiss() }
                            }
                        }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
        }
    }
}
