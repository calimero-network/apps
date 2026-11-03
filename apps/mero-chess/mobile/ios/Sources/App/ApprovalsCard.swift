import ChessCore
import SwiftUI

/// What waits for the person's approval (an update of Mero Chess, a node release): "Review"
/// opens the node's consent page in the system browser. Nothing shows when there is nothing to
/// approve.
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel
    let orgs: [String]

    var body: some View {
        if !model.items.isEmpty || model.error != nil {
            VStack(alignment: .leading, spacing: 10) {
                if let error = model.error { ErrorBanner(message: error) { model.error = nil } }
                ForEach(model.items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: icon(item))
                            .font(.system(size: 17, weight: .medium)).foregroundStyle(Theme.ink)
                            .frame(width: 36, height: 36)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.limeSoft))
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

/// Before the node's consent page opens: the confirmation code it will show too, so the person can
/// check the page is the request the app made. "Continue" opens the page in the system browser.
struct ConsentCodeSheet: View {
    let confirmation: ApprovalsModel.Confirmation
    let onAnswer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 22, weight: .medium)).foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.limeSoft))
            VStack(alignment: .leading, spacing: 6) {
                Text("Check the code").font(Theme.heading(22)).foregroundStyle(Theme.ink)
                Text(confirmation.title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink2)
            }
            if let code = confirmation.code {
                Text(code)
                    .font(.system(size: 32, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surface))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.line, lineWidth: 1))
                    .accessibilityIdentifier("consent.code")
                Text("Your node's approval page opens next and shows this same code. Approve only if they match.")
                    .font(Theme.body(14)).foregroundStyle(Theme.muted)
            } else {
                Text("Your node's approval page opens next. Approve there with your passkey.")
                    .font(Theme.body(14)).foregroundStyle(Theme.muted)
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
        .background(Theme.ground.ignoresSafeArea())
        .presentationDetents([.medium])
        .interactiveDismissDisabled(false)
    }
}
