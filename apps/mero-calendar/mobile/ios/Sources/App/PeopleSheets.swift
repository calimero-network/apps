import CalendarCore
import SwiftUI

/// The calendar's members (`get_members`).
struct MembersSheet: View {
    @ObservedObject var model: CalendarModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.members.isEmpty {
                    Text("No one has set a name yet.").font(Theme.body(15)).foregroundStyle(Theme.muted)
                }
                ForEach(model.members) { person in
                    HStack(spacing: 12) {
                        Avatar(name: model.displayName(person.id))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.displayName(person.id)).font(Theme.body(16, .semibold)).foregroundStyle(Theme.ink)
                            Text(CalendarConstants.short(person.id, 10)).font(Theme.body(12)).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        if person.id == model.me {
                            Text("You").font(Theme.body(12, .semibold)).foregroundStyle(Theme.ink)
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(Theme.lime, in: Capsule())
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .navigationTitle("Members")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("sheet.done")
                }
            }
            .refreshable { await model.reload() }
        }
        .presentationDetents([.medium, .large])
        .tint(Theme.ink)
    }
}

/// "Your name": what teammates see on your events.
struct NameSheet: View {
    let initial: String
    let onSave: (String) -> Void
    let onSkip: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @FocusState private var focused: Bool

    init(initial: String, onSave: @escaping (String) -> Void, onSkip: @escaping () -> Void) {
        self.initial = initial
        self.onSave = onSave
        self.onSkip = onSkip
        _name = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("What should your teammates call you?").font(Theme.body(15)).foregroundStyle(Theme.muted)
                TextField("e.g. Alice", text: $name)
                    .fieldStyle()
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(save)
                Spacer()
                Button("Save", action: save)
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(20)
            .background(Theme.ground.ignoresSafeArea())
            .navigationTitle("Your name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Skip") {
                        onSkip()
                        dismiss()
                    }
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
        .tint(Theme.ink)
    }

    private func save() {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Theme.haptic()
        onSave(name)
        dismiss()
    }
}

/// The calendar's ids, behind "Details".
struct CalendarDetailsSheet: View {
    @ObservedObject var model: CalendarModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                row("Calendar", model.calendar.name)
                row("Team", model.team.name)
                row("Calendar id (app instance)", model.calendar.id)
                row("Calendar team id", model.calendar.groupId)
                row("Team id (organization)", model.team.id)
                row("Your account", model.me)
                Section {
                    Text("Private events are kept on this device and are never sent to your cluster or your team.")
                        .font(Theme.body(13)).foregroundStyle(Theme.muted)
                }
            }
            .navigationTitle("Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .tint(Theme.ink)
    }

    private func row(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(Theme.body(12, .semibold)).foregroundStyle(Theme.muted)
            Text(value).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.ink).textSelection(.enabled)
        }
        .padding(.vertical, 2)
    }
}
