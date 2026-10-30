import MeroKit
import MeroKitUI
import ModelsCore
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
            consent: { [weak session] build in
                guard let session, let started = try? await session.requestConsent(build(session.callback.url))
                else { return nil }
                // The page's return (handled by the session) answers at once; else ask the node.
                if let result = session.consentResult, result.requestId == started.requestId { return result }
                return try? await session.client.cloud?.consentResult(started.requestId)
            })
    }
}

/// Decisions that wait for this account (a node release, an app upgrade),
/// each approved on the node's consent page. Nothing shows when none wait.
struct ApprovalsSection: View {
    @ObservedObject var model: ApprovalsModel

    var body: some View {
        if !model.items.isEmpty || model.message != nil {
            Section {
                ForEach(model.items) { item in
                    HStack(spacing: 12) {
                        Image(systemName: icon(item))
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.ink)
                            .frame(width: 36, height: 36)
                            .background(Theme.lime, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(Theme.body(15, .medium)).foregroundStyle(Theme.ink)
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
                    .padding(.vertical, 4)
                    .cardRow()
                }
                if let message = model.message {
                    Text(message).font(Theme.body(13)).foregroundStyle(Theme.muted).plainRow()
                }
            } header: {
                SectionLabel("Needs your approval")
            }
        }
    }

    private func icon(_ item: ApprovalItem) -> String {
        if case .release = item { return "checkmark.shield" }
        return "arrow.up.circle"
    }
}
