import MeroKitUI
import SwiftUI

/// Sign in with the Calimero account: the wallet (in the system auth sheet)
/// certifies a key this device keeps in its Keychain. No node, no password.
struct SignInView: View {
    @ObservedObject var session: SessionModel
    @ObservedObject var client: MeroClient

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            VStack(spacing: 8) {
                Text("Mero Chat")
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier("signInTitle")
                Text("Peer-to-peer chat. Your phone signs with a key your Calimero account certifies; a relay runs it.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal)

            if let error = client.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
                    .accessibilityIdentifier("signInError")
            }

            Button {
                Task { await session.signIn() }
            } label: {
                HStack {
                    if client.isLoading { ProgressView().tint(.white) }
                    Text("Continue with Calimero")
                        .bold()
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .disabled(client.isLoading)
            .padding(.horizontal, 32)
            .accessibilityIdentifier("signInButton")

            Spacer()
            Text("Approve this device with your passkey in the Calimero wallet.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.bottom)
        }
    }
}
