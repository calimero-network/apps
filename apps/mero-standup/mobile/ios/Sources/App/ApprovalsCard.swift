import StandupCore
import SwiftUI

/// What waits for the person's approval (an update of Mero Standup, a node
/// release): "Review" shows the confirmation code first, then opens the
/// node's consent page in the system browser, where the same code shows.
/// Nothing shows when there is nothing to approve.
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel
    let orgs: [String]

    var body: some View {
        if !model.items.isEmpty || model.error != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let error = model.error { Card { ErrorLine(message: error) } }
                ForEach(model.items) { item in
                    Card(padding: 14) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: icon(item))
                                .font(.system(size: 18, weight: .semibold)).foregroundStyle(Palette.ink)
                                .frame(width: 38, height: 38)
                                .background(Palette.limeSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                                Text(item.detail).font(.footnote).foregroundStyle(Palette.ink2)
                            }
                            Spacer(minLength: 0)
                            Button {
                                Haptics.tap()
                                Task { if await model.approve(item, orgs: orgs) { Haptics.success() } }
                            } label: {
                                if model.approving == item.id {
                                    ProgressView().tint(Palette.ink)
                                } else {
                                    Text("Review").font(.footnote.weight(.semibold))
                                }
                            }
                            .foregroundStyle(Palette.ink)
                            .padding(.horizontal, 12)
                            .frame(height: 30)
                            .background(Palette.lime, in: Capsule())
                            .disabled(model.approving != nil)
                        }
                    }
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
