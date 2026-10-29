import MeroKit
import MeroKitUI
import PassCore
import SwiftUI

/// How this phone guards its key, how you get back in if you lose it, and
/// your account (the web's `SecurityPage`).
struct SecurityScreen: View {
    let backend: any MeroAppBackend
    @EnvironmentObject private var session: MeroAppSession
    @EnvironmentObject private var services: AppServices
    @EnvironmentObject private var keeper: DeviceKeeper
    @StateObject private var model = SecurityModel(preferences: DefaultsPreferences())
    @State private var restoreCode = ""
    @State private var confirmSignOut = false
    @State private var confirmReplace = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("THIS PHONE").font(.system(size: 12, weight: .semibold)).tracking(0.8).foregroundStyle(Palette.muted)
                    Text("Security").font(Typeface.display(28)).foregroundStyle(Palette.ink)
                    Text("How this phone guards its key, how you get back in if you lose it, and your account.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted)
                }
                .listRowBackground(Color.clear)
                if let error = model.error {
                    Banner(tone: .danger, symbol: "exclamationmark.circle.fill", title: nil, text: error) { model.error = nil }
                        .listRowBackground(Color.clear)
                }
                if let status = model.status {
                    Banner(tone: .info, symbol: model.busy ? "hourglass" : "checkmark.shield", title: nil, text: status)
                        .listRowBackground(Color.clear)
                }
            }
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))

            Section {
                Label {
                    Text("Its key is kept in the Keychain on this device only, never backed up or synced, and opened with \(LockScreen.biometryName).")
                        .font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
                } icon: {
                    Image(systemName: LockScreen.biometrySymbol).foregroundStyle(Palette.ink)
                }
                Picker("Lock after", selection: $model.autoLockMinutes) {
                    ForEach(PassConstants.autoLockChoices, id: \.self) { minutes in
                        Text(minutes == 60 ? "1 hour" : "\(minutes) minute\(minutes == 1 ? "" : "s")").tag(minutes)
                    }
                }
                Button {
                    keeper.lock()
                } label: {
                    Label("Lock now", systemImage: "lock")
                }
                .foregroundStyle(Palette.ink)
                DetailsDisclosure(rows: [("Device key", keeper.fingerprint ?? "")])
            } header: {
                SectionLabel(text: "This phone")
            } footer: {
                Text("Leaving the app for longer than this clears every vault key from memory. Copied passwords leave the clipboard after \(PassConstants.clipboardSeconds) seconds regardless.")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted)
            }

            Section {
                Text(
                    "A code that opens every vault it was given, from a phone or browser that has nothing else. Write it down or keep it in another password manager: whoever reads it can do the same."
                )
                .font(.system(size: 14)).foregroundStyle(Palette.inkSoft)
                if let code = model.shownCode {
                    VStack(alignment: .leading, spacing: 12) {
                        Banner(tone: .warn, symbol: "eye", title: "Shown once.", text: "Store it now; it is not kept anywhere.")
                        Text(code)
                            .font(.system(size: 17, weight: .semibold, design: .monospaced))
                            .foregroundStyle(Palette.ink)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.limeSoft))
                            .textSelection(.enabled)
                        HStack(spacing: 10) {
                            Button {
                                services.copySecret(code, what: "Recovery code")
                            } label: {
                                Label("Copy", systemImage: "doc.on.doc")
                            }
                            .buttonStyle(SecondaryButtonStyle(compact: true))
                            Button("I have stored it") { model.dismissCode() }.buttonStyle(PrimaryButtonStyle(compact: true))
                        }
                    }
                    .padding(.vertical, 6)
                } else {
                    Text(
                        model.recovery.map {
                            "One is set up (\($0.fingerprint.prefix(12))…); vaults you open here get it automatically. Creating a new one replaces it in every vault."
                        } ?? "None is set up from this phone."
                    )
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                    Button {
                        if model.recovery == nil { createRecovery() } else { confirmReplace = true }
                    } label: {
                        Label(model.recovery == nil ? "Create recovery key" : "Replace recovery key", systemImage: "key.viewfinder")
                    }
                    .foregroundStyle(Palette.ink)
                    .disabled(model.busy)
                }
            } header: {
                SectionLabel(text: "Recovery key")
            }

            Section {
                InputField(label: "Recovery code", text: $restoreCode, placeholder: "XXXX-XXXX-…", monospaced: true)
                Button {
                    restore()
                } label: {
                    Label("Restore my vaults", systemImage: "arrow.counterclockwise")
                }
                .foregroundStyle(Palette.ink)
                .disabled(restoreCode.trimmingCharacters(in: .whitespaces).isEmpty || model.busy)
            } header: {
                SectionLabel(text: "Restore this phone")
            } footer: {
                Text("Lost every other device? Your recovery code hands this phone the keys of every vault it was given.")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted)
            }

            Section {
                Button(role: .destructive) {
                    confirmSignOut = true
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
                DetailsDisclosure(rows: [("Account", backend.account), ("Relay", backend.hasRelay ? "Connected" : "None yet")])
            } header: {
                SectionLabel(text: "Account")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .passNavigation("Security")
        .confirmationDialog("Replace your recovery key?", isPresented: $confirmReplace, titleVisibility: .visible) {
            Button("Replace in every vault", role: .destructive) { createRecovery() }
        } message: {
            Text("The old code stops opening your vaults.")
        }
        .confirmationDialog("Sign out of Mero Pass?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out") {
                keeper.lock()
                Task { await session.signOut() }
            }
            Button("Sign out and forget this phone", role: .destructive) {
                try? keeper.reset()
                Task { await session.signOut(forgetDevice: true) }
            }
        } message: {
            Text("Forgetting this phone deletes its device key: next time it has to be approved again, or restored with your recovery key.")
        }
    }

    private var directory: VaultDirectory { VaultDirectory(backend: backend) }

    private func createRecovery() {
        guard let device = keeper.device else { return }
        Task {
            await model.createRecoveryKey(directory: directory, device: device, label: services.deviceLabel)
            if model.shownCode != nil { Haptics.success() } else { Haptics.failure() }
        }
    }

    private func restore() {
        guard let device = keeper.device else { return }
        Task {
            let n = await model.restore(code: restoreCode, directory: directory, device: device, label: services.deviceLabel)
            if n > 0 {
                restoreCode = ""
                Haptics.success()
            } else {
                Haptics.failure()
            }
        }
    }
}
