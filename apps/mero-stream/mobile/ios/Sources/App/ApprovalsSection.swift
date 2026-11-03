import MeroKit
import MeroKitUI
import StreamCore
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
struct ApprovalsSection: View {
    @ObservedObject var model: ApprovalsModel

    var body: some View {
        if !model.items.isEmpty || model.message != nil {
            Section {
                ForEach(model.items) { item in
                    Card {
                        HStack(spacing: 14) {
                            RowIcon(symbol: { if case .release = item { return "checkmark.shield" } else { return "arrow.up.circle" } }())
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
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
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                }
                if let message = model.message {
                    Text(message).font(.system(size: 13)).foregroundStyle(Palette.muted)
                        .listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
            } header: {
                Text("Needs your approval").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            }
        }
    }
}

/// The consent request's confirmation code, shown before the node's consent
/// page opens: the page shows the same code, so the person can check it is
/// the request this app made.
struct ConsentCodeSheet: View {
    let confirmation: ConsentConfirmation
    let answer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            RowIcon(symbol: "checkmark.shield")
            Text("Check the code").font(Typeface.display(26)).foregroundStyle(Palette.ink)
            Text("\(confirmation.title). Your cluster's approval page opens next and shows this code. Approve only if they match.")
                .font(.system(size: 16)).foregroundStyle(Palette.inkSoft)
            Text(confirmation.code)
                .font(.system(size: 34, weight: .semibold, design: .monospaced))
                .foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 18)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.sunken))
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
        .background(Palette.surface)
    }
}
