import BlocksCore
import SwiftUI

/// Settings: the name other players see, look sensitivity, and the account.
struct SettingsScreen: View {
    @ObservedObject var settings: PlayerSettings
    let account: String
    let onSignOut: () -> Void
    @State private var confirming = false

    var body: some View {
        Form {
            Section {
                TextField(BlocksConstants.defaultPlayerName, text: $settings.name)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onChange(of: settings.name) { value in
                        if value.count > BlocksConstants.playerNameMax {
                            settings.name = String(value.prefix(BlocksConstants.playerNameMax))
                        }
                    }
            } header: {
                Text("Player name")
            } footer: {
                Text("Shown above your head to everyone in the world.")
            }
            Section {
                SensitivitySlider(value: $settings.sensitivity)
            } header: {
                Text("Controls")
            } footer: {
                Text("Left thumb moves, drag on the right to look. Jump, break and place sit under your right thumb.")
            }
            Section {
                HStack(spacing: 14) {
                    AppMark(size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Signed in").font(Theme.heading(17))
                        Text("with your Calimero account").font(Theme.body(13)).foregroundStyle(Theme.muted)
                    }
                }
                DisclosureGroup("Details") {
                    DetailRow(label: "Account", value: account)
                }
                .tint(Theme.ink)
                Button(role: .destructive) {
                    confirming = true
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
            } header: {
                Text("Account")
            }
            Section {
                Text("3D engine: three.js, © 2010–2026 three.js authors, MIT License.")
                    .font(Theme.body(13)).foregroundStyle(Theme.muted)
            } header: {
                Text("Acknowledgements")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Sign out of Mero Blocks?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { onSignOut() }
        }
    }
}

/// Look sensitivity, 0.3× to 3×.
struct SensitivitySlider: View {
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Look sensitivity", systemImage: "hand.draw")
                Spacer()
                Text(String(format: "%.1f×", value)).font(Theme.mono).foregroundStyle(Theme.muted)
            }
            Slider(
                value: $value,
                in: BlocksConstants.sensitivityRange.lowerBound...BlocksConstants.sensitivityRange.upperBound, step: 0.1)
        }
    }
}
