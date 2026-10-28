import CalendarCore
import SwiftUI

/// Create, edit or (not the owner) view an event.
struct EventEditor: View {
    @ObservedObject var model: CalendarModel
    let target: EditorTarget

    @Environment(\.dismiss) private var dismiss
    @State private var draft: EventDraft
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false
    @FocusState private var titleFocused: Bool

    init(model: CalendarModel, target: EditorTarget) {
        self.model = model
        self.target = target
        switch target {
        case .new(let day):
            var draft = EventDraft.new(on: day, math: model.math)
            if day != model.math.startOfDay(day) {
                draft.start = day
                draft.end = day.addingTimeInterval(3600)
            }
            _draft = State(initialValue: draft)
        case .existing(let event):
            _draft = State(initialValue: EventDraft.editing(event))
        }
    }

    private var editable: Bool { draft.original.map(model.canEdit) ?? true }

    private var navTitle: String {
        if draft.isNew { return "New event" }
        return editable ? "Edit event" : "Event"
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    Section { Banner(text: error) }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                Section {
                    TextField("Title", text: $draft.title)
                        .font(Theme.heading(18))
                        .focused($titleFocused)
                        .disabled(!editable)
                }

                Section {
                    Toggle(isOn: $draft.isAllDay) { Label("All day", systemImage: "sun.max") }
                        .disabled(!editable)
                    DatePicker(
                        selection: Binding(get: { draft.start }, set: { draft.setStart($0) }),
                        displayedComponents: draft.isAllDay ? [.date] : [.date, .hourAndMinute]
                    ) { Label("Starts", systemImage: "clock") }
                        .disabled(!editable)
                    DatePicker(
                        selection: $draft.end, in: draft.isAllDay ? model.math.startOfDay(draft.start)... : draft.start...,
                        displayedComponents: draft.isAllDay ? [.date] : [.date, .hourAndMinute]
                    ) { Label("Ends", systemImage: "clock.arrow.circlepath") }
                        .disabled(!editable)
                }
                .tint(Theme.ink)

                if editable {
                    Section {
                        Toggle(isOn: Binding(get: { draft.isPrivate }, set: { draft.setPrivate($0) })) {
                            Label("Private", systemImage: "lock.fill")
                        }
                        .disabled(!draft.canTogglePrivate)
                    } footer: {
                        Text(
                            draft.canTogglePrivate
                                ? "Only on this device. A private event never leaves your phone."
                                : "Shared events can't be made private again.")
                    }

                    Section("Color") {
                        ColorSwatches(selected: $draft.color)
                    }
                } else if draft.isPrivate {
                    Section { Label("Private", systemImage: "lock.fill") }
                }

                if !draft.isPrivate {
                    Section("Invite teammates") {
                        inviteesList
                    }
                }

                Section {
                    TextField("Description", text: $draft.description, axis: .vertical)
                        .lineLimit(3...8)
                        .disabled(!editable)
                }

                if let original = draft.original {
                    if !editable {
                        Section {
                            Text("Only the owner can edit this event.")
                                .font(Theme.body(14)).foregroundStyle(Theme.muted)
                        }
                    }
                    if editable {
                        Section {
                            Button(role: .destructive) { confirmDelete = true } label: {
                                Label("Delete event", systemImage: "trash")
                            }
                        }
                    }
                    Section {
                        DetailsDisclosure(rows: [
                            ("Event id", original.id),
                            ("Owner", original.isLocal ? "This device" : original.owner),
                        ])
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(editable ? "Cancel" : "Done") { dismiss() }
                }
                if editable {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saving ? "Saving…" : (draft.isNew ? "Create" : "Save")) { save() }
                            .fontWeight(.semibold)
                            .disabled(saving)
                    }
                }
            }
            .confirmationDialog("Delete this event?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { remove() }
                Button("Cancel", role: .cancel) {}
            }
            .onAppear { if draft.isNew { titleFocused = true } }
        }
        .tint(Theme.ink)
    }

    @ViewBuilder private var inviteesList: some View {
        let people = model.invitees
        let shown = editable ? people : people.filter { draft.peers.contains($0.id) }
        if shown.isEmpty && draft.peers.isEmpty {
            Text("No teammates have joined yet.").font(Theme.body(14)).foregroundStyle(Theme.muted)
        }
        ForEach(shown) { person in
            Button {
                Theme.haptic(.light)
                draft.togglePeer(person.id)
            } label: {
                HStack(spacing: 12) {
                    Avatar(name: model.displayName(person.id), size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(model.displayName(person.id)).font(Theme.body(15)).foregroundStyle(Theme.ink)
                        Text(CalendarConstants.short(person.id, 10)).font(Theme.body(12)).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    if draft.peers.contains(person.id) {
                        Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.ink)
                            .frame(width: 24, height: 24)
                            .background(Theme.lime, in: Circle())
                    }
                }
            }
            .disabled(!editable)
        }
        // Invitees who are not (or no longer) in the member list.
        ForEach(draft.peers.filter { id in !people.contains { $0.id == id } }, id: \.self) { id in
            HStack(spacing: 12) {
                Avatar(name: model.displayName(id), size: 30)
                Text(model.displayName(id)).font(Theme.body(15))
                Spacer()
                if editable {
                    Button { draft.togglePeer(id) } label: { Image(systemName: "xmark") }
                        .foregroundStyle(Theme.muted)
                }
            }
        }
    }

    private func save() {
        Theme.haptic()
        saving = true
        error = nil
        Task {
            do {
                try await model.save(draft)
                Theme.success()
                dismiss()
            } catch {
                self.error = ErrorText.describe(error, doing: "save the event")
            }
            saving = false
        }
    }

    private func remove() {
        guard let event = draft.original else { return }
        Theme.haptic()
        Task {
            do {
                try await model.delete(event)
                dismiss()
            } catch {
                self.error = ErrorText.describe(error, doing: "delete the event")
            }
        }
    }
}

/// The web app's ten event colors.
struct ColorSwatches: View {
    @Binding var selected: String

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 10) {
            ForEach(CalendarConstants.palette, id: \.self) { hex in
                Button {
                    Theme.haptic(.light)
                    selected = hex
                } label: {
                    Circle()
                        .fill(Theme.eventColor(hex))
                        .frame(width: 34, height: 34)
                        .overlay {
                            if selected.lowercased() == hex {
                                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                            }
                        }
                        .overlay(Circle().stroke(Theme.ink.opacity(selected.lowercased() == hex ? 0.9 : 0), lineWidth: 2).padding(-4))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Color \(hex)")
            }
        }
        .padding(.vertical, 6)
    }
}
