import ForumCore
import SwiftUI

/// What waits for the person's approval (an update of Mero Forum, a node
/// release): "Review" opens the node's consent page in the system browser.
/// Nothing shows when there is nothing to approve.
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel
    let orgs: [String]

    var body: some View {
        if !model.items.isEmpty || model.error != nil {
            VStack(spacing: 10) {
                if let error = model.error {
                    NoticeBanner(text: error) { model.error = nil }.padding(.horizontal, -16)
                }
                ForEach(model.items) { item in
                    Card {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: icon(item))
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                                .frame(width: 40, height: 40)
                                .background(Circle().fill(Palette.limeSoft))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                                Text(item.detail).font(.system(size: 14)).foregroundStyle(Palette.muted)
                            }
                            Spacer(minLength: 0)
                            Button {
                                Haptics.tap()
                                Task {
                                    if await model.approve(item, orgs: orgs) { Haptics.success() }
                                }
                            } label: {
                                if model.approving == item.id { ProgressView().tint(Palette.ink) } else { Text("Review") }
                            }
                            .buttonStyle(PrimaryButtonStyle(compact: true))
                            .disabled(model.approving != nil)
                        }
                        .padding(14)
                    }
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

/// Before the node's consent page opens: the confirmation code it will show
/// too, so the person can check the page is the request the app made.
/// "Continue" opens the page in the system browser.
struct ConsentCodeSheet: View {
    let confirmation: ApprovalsModel.Confirmation
    let onAnswer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 20, weight: .semibold)).foregroundStyle(Palette.ink)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Palette.limeSoft))
            VStack(alignment: .leading, spacing: 6) {
                Text("Check the code").font(.system(size: 22, weight: .bold)).foregroundStyle(Palette.ink)
                Text(confirmation.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.inkSoft)
            }
            if let code = confirmation.code {
                Text(code)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced)).foregroundStyle(Palette.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.surface))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.hairline, lineWidth: 1))
                    .accessibilityIdentifier("consent.code")
                Text("Your node's approval page opens next and shows this same code. Approve only if they match.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
            } else {
                Text("Your node's approval page opens next. Approve there with your passkey.")
                    .font(.system(size: 14)).foregroundStyle(Palette.muted)
            }
            Spacer(minLength: 0)
            Button("Continue") {
                Haptics.tap()
                onAnswer(true)
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("consent.continue")
            Button("Cancel") { onAnswer(false) }
                .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .background(Palette.ground.ignoresSafeArea())
        .presentationDetents([.medium])
    }
}
