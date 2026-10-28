import SwiftUI
import UpdatesCore

/// Team only: how the company appears to investors, and how updates are filed.
struct SettingsView: View {
    @ObservedObject var audience: AudienceModel
    @StateObject private var model: SettingsModel
    @Environment(\.dismiss) private var dismiss
    @State private var editing: CategoryView?
    @State private var adding = false
    @State private var archive: CategoryView?

    init(audience: AudienceModel) {
        self.audience = audience
        _model = StateObject(wrappedValue: SettingsModel(audience: audience))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Acme Inc.", text: $model.companyName)
                        .onChange(of: model.companyName) {
                            if $0.count > Limits.companyName { model.companyName = String($0.prefix(Limits.companyName)) }
                        }
                    Picker("Update cadence", selection: $model.cadenceDays) {
                        ForEach(Catalog.cadences, id: \.days) { Text($0.label).tag($0.days) }
                    }
                    .tint(Palette.ink)
                    Button {
                        Task {
                            if await model.save() { Haptics.success() } else { Haptics.error() }
                        }
                    } label: {
                        HStack {
                            Text(model.isSaving ? "Saving…" : "Save")
                            if model.saved && !model.isSaving {
                                Spacer()
                                Label("Saved", systemImage: "checkmark").foregroundStyle(Palette.good)
                            }
                        }
                    }
                    .disabled(model.isSaving || !model.hasLoaded)
                } header: {
                    Text("Company")
                } footer: {
                    Text(
                        "The name is shown at the top of every update. The cadence drives the “next update due” reminder on the team's home screen. Regular beats long: investors trust the founder who writes every month, good news or not."
                    )
                }

                Section {
                    ForEach(audience.categories) { category in
                        HStack {
                            CategoryChip(category: category)
                            Spacer()
                            Text(Format.plural(category.updateCount, "update")).font(.footnote).foregroundStyle(Palette.ink2)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { archive = category } label: { Label("Archive", systemImage: "archivebox") }
                            Button { editing = category } label: { Label("Edit", systemImage: "pencil") }.tint(Palette.ink)
                        }
                        .contextMenu {
                            Button { editing = category } label: { Label("Edit", systemImage: "pencil") }
                            Button(role: .destructive) { archive = category } label: { Label("Archive", systemImage: "archivebox") }
                        }
                    }
                    Button { adding = true } label: { Label("New category", systemImage: "plus") }
                    if audience.categories.isEmpty {
                        Button {
                            Task { _ = await model.addStarters() }
                        } label: {
                            Label("Add starter set (Monthly, Fundraising, Product, Hiring, Board)", systemImage: "sparkles")
                        }
                    }
                } header: {
                    Text("Categories")
                } footer: {
                    Text("File every update under one. Investors filter by category and can mute the ones they don't need.")
                }

                if let error = model.error {
                    Section { ErrorLine(message: error) }
                }
            }
            .tint(Palette.ink)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await model.load() }
            .sheet(isPresented: $adding) {
                CategorySheet(title: "New category", initial: nil) { name, emoji, color in
                    await model.createCategory(name: name, emoji: emoji, color: color)
                }
            }
            .sheet(item: $editing) { category in
                CategorySheet(title: "Edit category", initial: category) { name, emoji, color in
                    await model.editCategory(category.id, name: name, emoji: emoji, color: color)
                }
            }
            .confirmationDialog(
                "Archive \(archive?.name ?? "")?",
                isPresented: Binding(get: { archive != nil }, set: { if !$0 { archive = nil } }),
                titleVisibility: .visible
            ) {
                Button("Archive", role: .destructive) {
                    if let category = archive { Task { _ = await model.archiveCategory(category.id) } }
                }
            } message: {
                Text("Archiving is permanent. Existing updates keep the label.")
            }
        }
    }
}

/// Name, emoji and colour for a category.
private struct CategorySheet: View {
    let title: String
    let initial: CategoryView?
    let save: (String, String, String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var emoji = ""
    @State private var color = Catalog.categoryColors[0]
    @State private var saving = false

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    InputField(placeholder: "Emoji", text: $emoji, limit: Limits.emoji).frame(width: 84)
                    InputField(placeholder: "Category name", text: $name, limit: Limits.categoryName)
                }
                Text("Colour").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                HStack(spacing: 10) {
                    ForEach(Catalog.categoryColors, id: \.self) { swatch in
                        Button { color = swatch } label: {
                            Circle().fill(Color(css: swatch)).frame(width: 30, height: 30)
                                .overlay(Circle().strokeBorder(Palette.ink, lineWidth: color == swatch ? 2.5 : 0).padding(-4))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(swatch)
                        .accessibilityAddTraits(color == swatch ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
                Button {
                    saving = true
                    Task {
                        let ok = await save(name, emoji, color)
                        saving = false
                        if ok {
                            Haptics.success()
                            dismiss()
                        } else {
                            Haptics.error()
                        }
                    }
                } label: {
                    Text(saving ? "Saving…" : (initial == nil ? "Add" : "Save"))
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
            }
            .padding(20)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .onAppear {
                if let initial {
                    name = initial.name
                    emoji = initial.emoji
                    color = initial.color.isEmpty ? Catalog.categoryColors[0] : initial.color
                }
            }
        }
        .presentationDetents([.medium])
    }
}
