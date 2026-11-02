import CalendarCore
import SwiftUI

/// What waits for the person's approval (an update of Mero Calendar, a node
/// release): "Review" shows the confirmation code first, then opens the
/// node's consent page in the system browser, where the same code shows.
/// Nothing shows when there is nothing to approve.
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel
    let orgs: [String]

    var body: some View {
        if !model.items.isEmpty || model.error != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let error = model.error { Banner(text: error) }
                ForEach(model.items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        IconTile(symbol: icon(item))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                            Text(item.detail).font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 0)
                        Button {
                            Theme.haptic()
                            Task {
                                if await model.approve(item, orgs: orgs) { Theme.success() }
                            }
                        } label: {
                            if model.approving == item.id { ProgressView().tint(Theme.ink) } else { Text("Review") }
                        }
                        .buttonStyle(PillButtonStyle())
                        .disabled(model.approving != nil)
                    }
                    .card(padding: 14)
                }
            }
            .accessibilityIdentifier("approvals.card")
            .alert(
                "Check the code",
                isPresented: Binding(
                    get: { model.confirmationCode != nil }, set: { if !$0 { model.answerConfirmation(false) } }),
                actions: {
                    Button("Open approval page") { model.answerConfirmation(true) }
                    Button("Cancel", role: .cancel) { model.answerConfirmation(false) }
                },
                message: {
                    Text(
                        "The approval page will show \(model.confirmationCode ?? ""). Approve only if it shows the same code.")
                })
        }
    }

    private func icon(_ item: ApprovalsModel.Item) -> String {
        switch item.kind {
        case .upgrade: return "arrow.up.circle"
        case .release: return "checkmark.shield"
        }
    }
}
