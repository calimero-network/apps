import SwiftUI
import UniformTypeIdentifiers
import VoteCore

/// The t-of-n key ceremony and the tally, from one trustee's seat, plus the
/// creator's "Open voting". Every secret stays on this device: the transport
/// secret (the only thing kept, in the Keychain, with a backup to save), the
/// dealing polynomial (gone once dealt) and the combined key (re-derived when needed).
struct TrusteeCard: View {
    @ObservedObject var model: PollModel
    let label: (String) -> String
    @State private var restoring = false

    var body: some View {
        if let view = model.view {
            content(view)
                .sheet(isPresented: $restoring) { RestoreKeySheet(model: model) }
        }
    }

    private func content(_ view: PollView) -> some View {
        let def = view.definition
        let phase = view.state.phase
        let t = Int(def.threshold)
        let n = def.trustees.count
        return Panel {
            CardHead(
                symbol: "key.fill", accent: phase == .keyCeremony, title: "Trustees",
                meta: n == 1
                    ? "One trustee holds the whole decryption key — fine for a quick poll, not for a secret one."
                    : "Any \(t) of these \(n) can decrypt the totals together; fewer than \(t) learn nothing, and no one ever holds the whole key."
            ) {
                Badge(text: "\(t) of \(n)", strong: false)
            }
            VStack(spacing: 10) {
                ForEach(view.trustees, id: \.account) { x in row(x, phase: phase) }
            }
            if model.amTrustee { trusteeBox(view) }
            if model.isCreator && phase == .keyCeremony {
                VStack(alignment: .leading, spacing: 10) {
                    Rectangle().fill(Palette.hairline).frame(height: 0.5)
                    Text(model.ceremonyStatus).font(.system(size: 14)).foregroundStyle(Palette.muted)
                    Button(model.busy == "open" ? "Opening…" : "Open voting") {
                        Haptics.tap()
                        Task { await model.openVoting() }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!model.canOpenVoting)
                }
            }
            if let election = view.state.election, !election.disqualified.isEmpty {
                Callout(
                    tone: .warning,
                    title: "Left out of the key by proven complaint: \(election.disqualified.map(label).joined(separator: ", ")).")
            }
        }
    }

    private func row(_ x: TrusteeStatus, phase: Phase) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Avatar(label: label(x.account), seed: x.account, size: 30)
                Text(label(x.account) + (x.account == model.account ? " (you)" : ""))
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.ink)
                Spacer()
            }
            StatusLine(label: "Transport key", state: x.transportPublished ? .done("Published") : .waiting)
            dealtLine(x, phase: phase)
            StatusLine(
                label: "Decryption",
                state: x.partialPublished ? .done("Published") : phase == .closed ? .waiting : .none)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.ground))
    }

    @ViewBuilder private func dealtLine(_ x: TrusteeStatus, phase: Phase) -> some View {
        if x.qualified == false || x.complaintsAgainst > 0 {
            HStack {
                Text("Shares dealt").font(.system(size: 13)).foregroundStyle(Palette.muted)
                Spacer()
                if x.qualified == false && x.complaintsAgainst == 0 {
                    Badge(text: "Not in key", strong: false)
                } else {
                    Label(
                        x.qualified == false
                            ? "Disqualified"
                            : "\(x.complaintsAgainst) complaint\(x.complaintsAgainst > 1 ? "s" : "")",
                        systemImage: x.qualified == false ? "xmark" : "exclamationmark.triangle"
                    )
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.danger)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Palette.dangerSoft))
                }
            }
        } else {
            StatusLine(
                label: "Shares dealt",
                state: x.dealingPublished ? .done("Dealt") : phase == .keyCeremony ? .waiting : .none)
        }
    }

    @ViewBuilder private func trusteeBox(_ view: PollView) -> some View {
        let phase = view.state.phase
        let mine = model.mine
        VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(Palette.hairline).frame(height: 0.5)
            if phase == .keyCeremony && mine?.transportPublished != true {
                step(badge: "Step 1 of 2", title: "Publish a transport key",
                     hint: "Publish a transport key so the other trustees can send you your share privately. Its secret stays on this device.")
                Button {
                    Haptics.tap()
                    Task { await model.publishTransportKey() }
                } label: {
                    Label(model.busy == "transport" ? "Publishing…" : "Publish my transport key", systemImage: "key.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.busy != nil)
            }
            if phase == .keyCeremony && mine?.transportPublished == true && mine?.dealingPublished != true {
                step(badge: "Step 2 of 2", title: "Deal key shares",
                     hint: "Deal shares of a fresh random secret to every trustee." + (model.allTransport ? "" : " Waiting for every trustee's transport key."))
                Button(model.busy == "deal" ? "Dealing…" : "Deal my key shares") {
                    Haptics.tap()
                    Task { await model.publishDealing() }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.busy != nil || !model.allTransport || model.ceremony == nil || model.trusteeKey == nil)
            }
            if phase == .keyCeremony && !model.received.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Shares dealt to you").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.muted)
                        .textCase(.uppercase)
                    ForEach(model.received) { r in
                        HStack(spacing: 8) {
                            Image(systemName: r.ok ? "checkmark" : "xmark")
                                .foregroundStyle(r.ok ? Palette.success : Palette.danger)
                            Text("share from \(label(r.dealer))").font(.system(size: 14)).foregroundStyle(Palette.ink)
                                .accessibilityLabel((r.ok ? "Valid: " : "Invalid: ") + "share from \(label(r.dealer))")
                            Spacer()
                            if !r.ok && !r.complained {
                                Button("File complaint") {
                                    Task { await model.complain(about: r.dealer, label: label(r.dealer)) }
                                }
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Palette.danger)
                                .disabled(model.busy != nil)
                            }
                            if r.complained {
                                Text("complaint filed").font(.system(size: 13)).foregroundStyle(Palette.muted)
                            }
                        }
                    }
                }
            }
            if mine?.transportPublished == true && model.trusteeKey == nil && mine?.partialPublished != true {
                Callout(
                    tone: .warning,
                    title: "This device does not hold your trustee key. Restore it from your backup, or you cannot take part in the decryption.")
            }
            if phase == .closed && mine?.partialPublished != true && model.trusteeKey != nil {
                step(badge: nil, title: "Your decryption share is needed",
                     hint: "It decrypts only the per-option totals, never a single ballot.")
                Button {
                    Haptics.tap()
                    Task { await model.publishPartial(label: label) }
                } label: {
                    Label(model.busy == "partial" ? "Decrypting…" : "Publish my decryption share", systemImage: "key.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.busy != nil)
            }
            HStack(spacing: 10) {
                if let key = model.trusteeKey {
                    ShareLink(item: SharedText(text: key.json(), fileName: key.backupFileName), preview: SharePreview("Trustee key backup")) {
                        Label("Save key backup", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
                if mine?.transportPublished == true && mine?.partialPublished != true {
                    Button {
                        restoring = true
                    } label: {
                        Label("Restore key from backup", systemImage: "square.and.arrow.down")
                    }
                    .buttonStyle(SecondaryButtonStyle(compact: true))
                }
            }
        }
    }

    private func step(badge: String?, title: String, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if let badge { Badge(text: badge) }
                Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink)
            }
            Text(hint).font(.system(size: 14)).foregroundStyle(Palette.muted)
        }
    }
}

/// Put a trustee key back: paste the backup's text, or choose the file.
struct RestoreKeySheet: View {
    @ObservedObject var model: PollModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?
    @State private var importing = false

    var body: some View {
        VStack(spacing: 0) {
            SheetBar(
                title: "Restore key", action: "Restore", canAct: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                busy: false, cancel: { dismiss() }, act: restore)
            VStack(alignment: .leading, spacing: 12) {
                TextField("Paste the backup's text", text: $text, axis: .vertical)
                    .font(.system(size: 14, design: .monospaced))
                    .lineLimit(4...8)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Palette.sunken))
                Button {
                    importing = true
                } label: {
                    Label("Choose file", systemImage: "doc")
                }
                .buttonStyle(SecondaryButtonStyle(compact: true))
                Text("The backup is the mero-vote-trustee-….json file you saved, from this app or the web app.")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted)
                if let error { Text(error).font(.system(size: 14)).foregroundStyle(Palette.danger) }
            }
            .padding(20)
            Spacer()
        }
        .background(Palette.surface)
        .presentationDetents([.medium, .large])
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .plainText]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url) { text = String(decoding: data, as: UTF8.self) }
        }
    }

    private func restore() {
        do {
            try model.restoreKey(text)
            Haptics.success()
            dismiss()
        } catch {
            self.error = VoteErrorText.describe(error)
            Haptics.failure()
        }
    }
}
