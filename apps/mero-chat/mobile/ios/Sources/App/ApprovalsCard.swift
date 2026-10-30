import SwiftUI

/// What waits for the person's approval (an update of Mero Chat, a node
/// release): "Review" opens the node's consent page in the system browser.
/// Nothing shows when there is nothing to approve.
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel
    let orgs: [String]

    var body: some View {
        if !model.items.isEmpty || model.error != nil {
            VStack(alignment: .leading, spacing: 8) {
                Theme.label("Approvals", size: 10.9, opacity: 35)
                if let error = model.error {
                    Banner(kind: .error, text: error) { model.error = nil }
                }
                ForEach(model.items) { item in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: icon(item))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                            .frame(width: 30, height: 30)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.accent(10)))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(Theme.font(14, .semibold)).foregroundStyle(Theme.ink)
                            Text(item.detail).font(Theme.font(12)).foregroundStyle(Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                        Button {
                            Task { await model.approve(item, orgs: orgs) }
                        } label: {
                            if model.approving == item.id {
                                ProgressView().tint(Theme.accent)
                            } else {
                                Text("Review").font(Theme.font(13, .semibold))
                            }
                        }
                        .buttonStyle(SecondaryButtonStyle(fullWidth: false))
                        .disabled(model.approving != nil)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.ink(4)))
                }
            }
            .padding(.bottom, 20)
            .accessibilityIdentifier("approvalsCard")
        }
    }

    private func icon(_ item: ApprovalsModel.Item) -> String {
        switch item.kind {
        case .upgrade: return "arrow.up.circle"
        case .release: return "checkmark.shield"
        }
    }
}
