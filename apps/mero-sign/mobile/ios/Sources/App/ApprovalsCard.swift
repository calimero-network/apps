import MeroKit
import MeroKitUI
import SignCore
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
struct ApprovalsCard: View {
    @ObservedObject var model: ApprovalsModel

    var body: some View {
        if !model.items.isEmpty || model.message != nil {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(text: "Needs your approval")
                Card {
                    VStack(spacing: 0) {
                        ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                            row(item)
                            if index < model.items.count - 1 { Divider().overlay(Palette.hairline).padding(.leading, 56) }
                        }
                        if let message = model.message {
                            Text(message)
                                .font(.system(size: 13))
                                .foregroundStyle(Palette.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                        }
                    }
                }
            }
        }
    }

    private func row(_ item: ApprovalItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: { if case .release = item { return "checkmark.shield" } else { return "arrow.up.circle" } }())
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Palette.ink)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.limeSoft))
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(item.detail).font(.system(size: 13)).foregroundStyle(Palette.muted)
            }
            Spacer(minLength: 8)
            if model.busy == item.id {
                ProgressView().tint(Palette.ink)
            } else {
                Button("Review") {
                    Haptics.tap()
                    Task { await model.approve(item) }
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                .disabled(model.busy != nil)
            }
        }
        .padding(14)
    }
}
