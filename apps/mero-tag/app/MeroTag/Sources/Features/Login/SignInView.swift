import SwiftUI

/// Cloud-only sign-in: one "Continue with Calimero" button that opens the
/// Calimero wallet in the system auth sheet. There is no node URL and no
/// password — the person approves this device with their passkey on the
/// wallet's own page, and the app comes back holding a device certificate.
struct SignInView: View {
    @EnvironmentObject private var app: AppState

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 48)

                VStack(spacing: 14) {
                    BrandMark(size: 56)
                    Text("Mero Tag")
                        .font(Cal.Typeface.pageTitle)
                        .tracking(-0.4)
                        .foregroundStyle(Cal.ink)
                        .accessibilityIdentifier("appTitle")
                    Text("Live location for the people you choose, shared through your own Calimero account.")
                        .font(Cal.Typeface.body)
                        .foregroundStyle(Cal.textDim)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 28)

                Card {
                    VStack(alignment: .leading, spacing: 18) {
                        FeatureRow(
                            systemImage: "person.badge.key",
                            title: "Your account, this device",
                            message: "Approve this phone once with your passkey. No password to remember.")
                        FeatureRow(
                            systemImage: "dot.radiowaves.left.and.right",
                            title: "Live, not stored on a server",
                            message: "Positions travel through your account's relay to the space you share.")
                        FeatureRow(
                            systemImage: "eye",
                            title: "You decide who sees",
                            message: "Each tracker is visible only to the members you share it with.")
                    }
                }

                VStack(spacing: 12) {
                    if let notice = app.sessionNotice, app.client.errorMessage == nil {
                        Callout(tone: .warning, title: "Signed out", message: notice)
                            .accessibilityIdentifier("sessionNotice")
                    }
                    if let error = app.client.errorMessage {
                        Callout(tone: .danger, title: "Couldn't sign in", message: error)
                            .accessibilityIdentifier("signInError")
                    }

                    LoadingButton(
                        title: "Continue with Calimero",
                        systemImage: "key.fill",
                        isLoading: app.client.isLoading
                    ) {
                        Task { await app.signIn() }
                    }
                    .accessibilityIdentifier("cloudSignInButton")

                    Text("Opens the Calimero wallet in a secure sheet. Approve this device, then you're right back here.")
                        .font(.system(size: 12))
                        .foregroundStyle(Cal.textFaint)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 20)
                .animation(.easeOut(duration: 0.2), value: app.client.errorMessage)

                Spacer(minLength: 32)
            }
            .frame(maxWidth: 480)
            .padding(.horizontal, Cal.Space.gutter)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Cal.bg.ignoresSafeArea())
    }
}

private struct FeatureRow: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(systemImage: systemImage, accent: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Cal.Typeface.section).foregroundStyle(Cal.ink)
                Text(message)
                    .font(Cal.Typeface.bodySmall)
                    .foregroundStyle(Cal.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
