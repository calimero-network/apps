import DesignCore
import SwiftUI

/// What waits for the person's approval (an update of Mero Calendar, a node
/// release): "Review" opens the node's consent page in the system browser.
/// Nothing shows when there is nothing to approve.
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel
    let orgs: [String]

    var body: some View {
        if !model.items.isEmpty || model.error != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let error = model.error {
                    Text(error).font(Theme.body(14)).foregroundStyle(Theme.danger)
                }
                ForEach(model.items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: icon(item))
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .frame(width: 36, height: 36)
                            .background(Theme.lime.opacity(0.35), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                            Text(item.detail).font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 0)
                        Button {
                            Haptics.tap()
                            Task {
                                if await model.approve(item, orgs: orgs) { Haptics.success() }
                            }
                        } label: {
                            if model.approving == item.id { ProgressView().tint(Theme.ink) } else { Text("Review") }
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                        .disabled(model.approving != nil)
                    }
                    .card(padding: 14)
                }
            }
            .accessibilityIdentifier("approvals.card")
        }
    }

    private func icon(_ item: ApprovalsModel.Item) -> String {
        switch item.kind {
        case .upgrade: return "arrow.up.circle"
        case .release: return "checkmark.shield"
        }
    }
}

/// The confirmation code shown before the consent page opens: the page shows the same code, so the
/// person can tell it is the request this app made.
@MainActor
final class ConsentCodeCheck: ObservableObject {
    @Published private(set) var code: String?
    private var waiting: CheckedContinuation<Bool, Never>?

    var isShown: Binding<Bool> {
        Binding(get: { self.code != nil }, set: { if !$0 { self.answer(false) } })
    }

    /// Show `code` and wait for the person; no code (an older node) goes straight on.
    func confirm(_ code: String?) async -> Bool {
        guard let code, !code.isEmpty else { return true }
        answer(false)
        return await withCheckedContinuation { continuation in
            waiting = continuation
            self.code = code
        }
    }

    func answer(_ ok: Bool) {
        code = nil
        waiting?.resume(returning: ok)
        waiting = nil
    }
}
