import SwiftUI

/// An error and/or a notice at the top of a list, each dismissable.
struct StatusBanners: View {
    @Binding var error: String?
    @Binding var notice: String?

    var body: some View {
        if let error {
            Section {
                HStack(alignment: .top) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                    Text(error).font(.footnote)
                    Spacer()
                    Button {
                        self.error = nil
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Dismiss")
                }
                .accessibilityIdentifier("errorBanner")
            }
        }
        if let notice {
            Section {
                HStack(alignment: .top) {
                    Image(systemName: "info.circle.fill").foregroundStyle(.blue)
                    Text(notice).font(.footnote)
                    Spacer()
                    Button {
                        self.notice = nil
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Dismiss")
                }
            }
        }
    }
}

/// A centered explanation for an empty list.
struct EmptyStateView: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical)
    }
}

/// Ask for one name, then run `onSubmit`; dismiss when it succeeds.
struct NameSheet: View {
    let title: String
    let placeholder: String
    let action: String
    var initial: String = ""
    var footer: String?
    let onSubmit: (String) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var working = false

    init(
        title: String, placeholder: String, action: String, initial: String = "", footer: String? = nil,
        onSubmit: @escaping (String) async -> Bool
    ) {
        self.title = title
        self.placeholder = placeholder
        self.action = action
        self.initial = initial
        self.footer = footer
        self.onSubmit = onSubmit
        _name = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(placeholder, text: $name)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("nameField")
                } footer: {
                    if let footer { Text(footer) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if working {
                        ProgressView()
                    } else {
                        Button(action) {
                            Task {
                                working = true
                                let ok = await onSubmit(name)
                                working = false
                                if ok { dismiss() }
                            }
                        }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
    }
}
