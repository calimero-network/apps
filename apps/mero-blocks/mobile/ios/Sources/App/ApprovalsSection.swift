import MeroKit
import MeroKitUI
import BlocksCore
import SwiftUI

extension ApprovalsModel {
    /// Approvals for the signed-in session: what waits is read from the node,
    /// and each decision opens the node's consent page in the system browser.
    convenience init(session: MeroAppSession) {
        self.init(
            load: { [weak session] org in
                guard let session else { throw CancellationError() }
                return try await session.pendingApprovals(org: org)
            },
            consent: { [weak session] build, confirm in
                guard let session else { return nil }
                let started = try await session.requestConsent(build(session.callback.url), confirm: confirm)
                // The page's return (handled by the session) answers at once; else ask the node.
                if let result = session.consentResult, result.requestId == started.requestId { return result }
                guard let cloud = session.client.cloud else { return nil }
                let id = started.requestId
                return try? await cloud.answer(as: ConsentResult.self) { try await cloud.consent.pageResult(request: id) }
            })
    }
}

/// Decisions that wait for this account (a node release, an app upgrade), each approved on the
/// node's consent page. Nothing shows when none wait.
struct ApprovalsSection: View {
    @ObservedObject var model: ApprovalsModel

    var body: some View {
        if !model.items.isEmpty || model.message != nil {
            VStack(alignment: .leading, spacing: 12) {
                Text("Needs your approval").font(Theme.body(13, .semibold)).foregroundStyle(Theme.muted)
                ForEach(model.items) { item in
                    HStack(spacing: 12) {
                        Image(systemName: { if case .release = item { return "checkmark.shield" } else { return "arrow.up.circle" } }())
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .frame(width: 40, height: 40)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.limeSoft))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(Theme.body(15, .semibold)).foregroundStyle(Theme.ink)
                            Text(item.detail).font(Theme.body(13)).foregroundStyle(Theme.muted)
                        }
                        Spacer(minLength: 8)
                        if model.busy == item.id {
                            ProgressView().tint(Theme.ink)
                        } else {
                            Button("Review") {
                                Haptics.tap()
                                Task { await model.approve(item) }
                            }
                            .font(Theme.body(14, .semibold))
                            .disabled(model.busy != nil)
                        }
                    }
                }
                if let message = model.message {
                    Text(message).font(Theme.body(13)).foregroundStyle(Theme.muted)
                }
            }
            .card()
            .plainRow()
        }
    }
}

/// The consent request's confirmation code, shown before the node's consent page opens: the page
/// shows the same code, so the person can check it is the request this app made.
struct ConsentCodeSheet: View {
    let confirmation: ConsentConfirmation
    let answer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.limeSoft))
            Text("Check the code").font(Theme.body(24, .bold)).foregroundStyle(Theme.ink)
            Text("\(confirmation.title). Your cluster's approval page opens next and shows this code. Approve only if they match.")
                .font(Theme.body(15)).foregroundStyle(Theme.ink2)
            Text(confirmation.code)
                .font(.system(size: 34, weight: .semibold, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.sunken))
                .accessibilityIdentifier("consentCode")
            Spacer()
            Button {
                Haptics.tap()
                answer(true)
            } label: {
                Label("Open the approval page", systemImage: "arrow.up.forward.app")
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("Not now") { answer(false) }.buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .presentationDetents([.medium])
        .interactiveDismissDisabled()
        .background(Theme.surface)
    }
}
