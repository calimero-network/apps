import ModelsCore
import SwiftUI

/// The app mark: the web app's icon (an orange cube with a vertex on top).
struct AppMark: View {
    var size: CGFloat = 56

    var body: some View {
        Image("Logo")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A round initials avatar in the member's colour.
struct Avatar: View {
    let id: String
    let name: String
    var size: CGFloat = 32

    var body: some View {
        Circle()
            .fill(Theme.memberColor(id))
            .frame(width: size, height: size)
            .overlay(
                Text(ModelsFormat.initials(name))
                    .font(.system(size: size * 0.38, weight: .semibold))
                    .foregroundStyle(.white))
            .accessibilityLabel(name)
    }
}

/// An icon, a title, a line of help, and an optional action.
struct EmptyState: View {
    let icon: String
    let title: String
    let message: String
    var action: (title: String, run: () -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(Theme.muted)
                .frame(width: 64, height: 64)
                .background(Theme.sunken, in: Circle())
            Text(title).font(Theme.heading(18)).foregroundStyle(Theme.ink)
            Text(message)
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            if let action {
                Button(action.title, action: action.run)
                    .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                    .padding(.top, 4)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

/// Loading placeholder rows.
struct LoadingRows: View {
    var count = 3

    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .fill(Theme.sunken)
                    .frame(height: 76)
            }
        }
        .padding(16)
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading")
    }
}

/// Ids and other technical facts, folded away.
struct DetailsDisclosure: View {
    let rows: [(String, String)]
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(rows, id: \.0) { label, value in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(Theme.body(12, .medium)).foregroundStyle(Theme.muted)
                        Text(value)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Theme.ink2)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(.top, 8)
        } label: {
            Label("Details", systemImage: "info.circle").font(Theme.body(14, .medium)).foregroundStyle(Theme.ink2)
        }
        .tint(Theme.ink2)
    }
}

/// A failure, in words, with a way to try again.
struct ErrorBanner: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        EmptyState(icon: "exclamationmark.triangle", title: "Something went wrong", message: message, action: ("Try again", retry))
    }
}

/// A role as a small pill: Admin, Editor, Viewer.
struct RoleBadge: View {
    let role: String

    var body: some View {
        Text(role.prefix(1).uppercased() + role.dropFirst())
            .font(Theme.body(12, .semibold))
            .foregroundStyle(role == "admin" ? Theme.ink : Theme.ink2)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(role == "admin" ? Theme.lime : Theme.sunken, in: Capsule())
    }
}

/// An object kind's icon on a tinted tile.
struct KindTile: View {
    let kind: String
    var size: CGFloat = 32

    var body: some View {
        Image(systemName: Theme.kindIcon(kind))
            .font(.system(size: size * 0.45, weight: .medium))
            .foregroundStyle(Theme.ink)
            .frame(width: size, height: size)
            .background(Theme.sunken, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
    }
}

/// The system share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// A link waiting for the share sheet.
struct SharedLink: Identifiable {
    let id = UUID()
    let url: String
}
