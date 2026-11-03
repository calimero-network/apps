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
            consent: { [weak session] build, confirm in
                guard let session else { return nil }
                let started = try await session.requestConsent(build(session.callback.url), confirm: confirm)
                // The page's return (handled by the session) answers at once; else ask the node.
                if let result = session.consentResult, result.requestId == started.requestId { return result }
                return try? await session.client.cloud?.consentResult(started.requestId)
            })
    }
}

/// Decisions that wait for this account (a node release, an app upgrade),
/// each approved on the node's consent page. Nothing shows when none wait.
/// "Review" first shows the request's confirmation code, which the page
/// shows too, then opens the page in the system browser.
struct ApprovalsSection: View {
    @ObservedObject var model: ApprovalsModel

    var body: some View {
        Group {
            if !model.items.isEmpty || model.message != nil { section }
        }
        .sheet(isPresented: Binding(get: { model.code != nil }, set: { if !$0 { model.cancelCode() } })) {
            ConfirmationCodeSheet(
                code: model.code ?? "", onContinue: { model.continueToPage() }, onCancel: { model.cancelCode() }
            )
            .presentationDetents([.medium])
        }
    }

    private var section: some View {
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

    private func icon(_ item: ApprovalItem) -> String {
        if case .release = item { return "checkmark.shield" }
        return "arrow.up.circle"
    }
}

/// The request's confirmation code, before the consent page opens. The page
/// shows the same code: if they differ, the person stops there.
struct ConfirmationCodeSheet: View {
    let code: String
    let onContinue: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(Theme.ink)
                .frame(width: 60, height: 60)
                .background(Theme.lime, in: Circle())
                .padding(.top, 8)
            Text("Check this code").font(Theme.heading(20)).foregroundStyle(Theme.ink)
            Text(code)
                .font(.system(size: 34, weight: .semibold, design: .monospaced))
                .foregroundStyle(Theme.ink)
                .accessibilityIdentifier("confirmationCode")
            Text("Your node's approval page opens next and shows a code. Approve only if it is this one.")
                .font(Theme.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Spacer()
            Button("Open the approval page") {
                Haptics.tap()
                onContinue()
            }
            .buttonStyle(PrimaryButtonStyle())
            Button("Cancel", action: onCancel).buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .frame(maxWidth: .infinity)
        .background(Theme.ground)
    }
}
