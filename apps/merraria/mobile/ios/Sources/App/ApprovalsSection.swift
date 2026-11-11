import MeroKit
import MeroKitUI
import MerrariaCore
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
                guard let session,
                    let started = try? await session.requestConsent(
                        build(session.callback.url), confirm: { started in await confirm(started.code) })
                else { return nil }
                // The page's return (handled by the session) answers at once; else ask the node.
                if let result = session.consentResult, result.requestId == started.requestId { return result }
                guard let cloud = session.client.cloud else { return nil }
                let id = started.requestId
                return try? await MeroJSON.decode(ConsentResult.self, from: MeroJSON.encode(cloud.consent.pageResult(request: id)))
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
            .alert(
                "Check the code",
                isPresented: Binding(
                    get: { model.confirmationCode != nil },
                    set: { if !$0, model.confirmationCode != nil { model.answerConfirmation(false) } })
            ) {
                Button("Continue") { model.answerConfirmation(true) }
                Button("Cancel", role: .cancel) { model.answerConfirmation(false) }
            } message: {
                Text(confirmationText)
            }
        }
    }

    private var confirmationText: String {
        let code = model.confirmationCode ?? ""
        return code.isEmpty
            ? "Your cluster's approval page opens next. Approve there with your passkey."
            : "The approval page will show the code \(code). Continue only if it matches, then approve with your passkey."
    }
}
