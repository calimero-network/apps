import MeroKitUI
import SwiftUI

/// Sign-in. Cloud only: one "Continue with Calimero" button that opens the
/// Calimero wallet in the system auth sheet, like "Sign in with Google". The
/// person approves this device with their passkey on the wallet's own page and
/// comes straight back; the app never sees a password or a node URL.
struct WelcomeView: View {
    @EnvironmentObject private var app: AppState
    @EnvironmentObject private var client: MeroClient

    var body: some View {
        ZStack {
            ScreenBackground()

            ScrollView {
                VStack(spacing: 0) {
                    hero
                        .padding(.top, 72)
                        .padding(.bottom, 32)

                    Card(padding: 24) {
                        VStack(alignment: .leading, spacing: 18) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Sign in to start")
                                    .font(.system(size: 20, weight: .bold))
                                    .tracking(-0.2)
                                    .foregroundStyle(Theme.ink)
                                    .accessibilityIdentifier("loginTitle")
                                Text(
                                    "You'll approve this device with your passkey on the Calimero wallet, "
                                        + "then come straight back. Your account key never leaves the wallet."
                                )
                                .font(.system(size: 14))
                                .foregroundStyle(Theme.textDim)
                                .fixedSize(horizontal: false, vertical: true)
                            }

                            if let error = client.errorMessage {
                                Callout(tone: .danger, title: "Couldn't sign in", message: error)
                                    .accessibilityIdentifier("loginError")
                            }

                            Button {
                                Haptics.tap()
                                Task { await app.signIn() }
                            } label: {
                                ButtonLabel(
                                    title: "Continue with Calimero", icon: "person.badge.key",
                                    isLoading: client.isLoading)
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(client.isLoading)
                            .accessibilityIdentifier("cloudSignInButton")

                            HStack(spacing: 6) {
                                Image(systemName: "lock")
                                    .font(.system(size: 11, weight: .medium))
                                Text("Uses the system sign-in sheet. Nothing to paste in.")
                            }
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.textFaint)
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .frame(maxWidth: 480)

                    features
                        .padding(.top, 28)
                        .frame(maxWidth: 480)
                }
                .padding(.horizontal, Theme.gutter)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var hero: some View {
        VStack(spacing: 14) {
            BrandMark(size: 64)
            Text("Mero AR")
                .font(.system(size: 30, weight: .bold))
                .tracking(-0.6)
                .foregroundStyle(Theme.ink)
            Text("Scan a room. Build in it together,\nin shared 3D space.")
                .font(.system(size: 15))
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.textDim)
        }
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 14) {
            feature("viewfinder", "Place objects where they belong", "Cubes, spheres and markers anchored to real surfaces.")
            feature("person.2", "Everyone sees the same room", "Edits sync peer to peer, live, on every device.")
            feature("square.stack.3d.up", "Share the scan", "Publish your room map so others line up with you.")
        }
        .padding(.horizontal, 4)
    }

    private func feature(_ icon: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            IconTile(systemName: icon, accent: true, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
