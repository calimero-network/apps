import SignCore
import SwiftUI

/// One document: where it stands, who signs it, your part, and its file.
struct DocumentScreen: View {
    @StateObject private var model: DocumentModel
    @State private var viewer: ViewerMode?

    init(model: @autoclosure @escaping () -> DocumentModel) {
        _model = StateObject(wrappedValue: model())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch model.phase {
                case .loading where model.entry == nil:
                    ProgressView().tint(Palette.ink).frame(maxWidth: .infinity).padding(.top, 60)
                case .failed(let message) where model.entry == nil:
                    ErrorState(message: message) { Task { await model.load() } }
                default:
                    if let entry = model.entry { loaded(entry) }
                }
            }
            .padding(16)
        }
        .background(Palette.ground.ignoresSafeArea())
        .refreshable { await model.load() }
        .task {
            await model.load()
            await model.loadPDF()
        }
        .signNavigation("Document")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let entry = model.entry, let url = shareURL(entry) {
                    ShareLink(item: url) { Image(systemName: "square.and.arrow.up").foregroundStyle(Palette.ink) }
                        .accessibilityLabel("Share the document")
                }
            }
        }
        .safeAreaInset(edge: .top) {
            if let error = model.error, viewer == nil { NoticeBanner(text: error) { model.error = nil } }
        }
        .fullScreenCover(item: $viewer) { mode in
            DocumentViewerScreen(model: model, startSigning: mode == .sign)
        }
    }

    @ViewBuilder private func loaded(_ entry: DocumentEntry) -> some View {
        summary(entry)
        if let warning = model.integrityWarning {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.shield.fill").foregroundStyle(Palette.danger)
                Text(warning).font(.system(size: 14)).foregroundStyle(Palette.ink)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.dangerSoft))
        }
        yourPart(entry)
        signersCard(entry)
        Card {
            DetailsDisclosure(rows: [
                ("Document", entry.document.id),
                ("Fingerprint (SHA-256)", entry.document.hash),
                ("File", SignIds.blobHex(entry.document.pdfBlobId)),
                ("Size", SignFormat.size(entry.document.size)),
                ("Uploaded by", SignIds.hex(entry.document.uploadedBy)),
                ("Agreement context", entry.agreement.contextId),
            ])
            .padding(.horizontal, 14)
        }
    }

    private func summary(_ entry: DocumentEntry) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: entry.isComplete ? "doc.text.fill" : "doc.text")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(entry.isComplete ? Palette.good : Palette.ink)
                        .frame(width: 54, height: 64)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(entry.isComplete ? Palette.goodSoft : Palette.sunken))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.document.name).font(Typeface.display(20)).foregroundStyle(Palette.ink)
                        Text("\(entry.agreement.name) · \(SignFormat.when(nanos: entry.document.uploadedAt))")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted)
                        StatusPill(entry: entry)
                    }
                }
                let progress = entry.progress
                if progress.required > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: Double(progress.signed), total: Double(progress.required))
                            .tint(entry.isComplete ? Palette.good : Palette.ink)
                        Text(SignFormat.progress(entry)).font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Palette.inkSoft)
                    }
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder private func yourPart(_ entry: DocumentEntry) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: partSymbol(entry))
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(entry.canSign ? Palette.lime : Palette.sunken))
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Your part").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
                        Text(partText(entry)).font(.system(size: 15)).foregroundStyle(Palette.ink)
                    }
                }
                if entry.canSign {
                    Button {
                        Haptics.tap()
                        viewer = .sign
                    } label: {
                        Label("Review and sign", systemImage: "signature")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                Button {
                    viewer = .read
                } label: {
                    Label(entry.isComplete ? "View signed document" : "View document", systemImage: "doc.viewfinder")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .padding(16)
        }
    }

    private func signersCard(_ entry: DocumentEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Signers", trailing: SignFormat.progress(entry))
            Card {
                VStack(spacing: 0) {
                    if model.signers.isEmpty {
                        Text("Nobody was asked to sign this document.")
                            .font(.system(size: 14)).foregroundStyle(Palette.muted)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                    }
                    ForEach(Array(model.signers.enumerated()), id: \.element.id) { index, signer in
                        HStack(spacing: 12) {
                            Avatar(label: signer.name ?? "", seed: signer.account, size: 38)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(signer.displayName).font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Palette.ink)
                                    if signer.isMe { Text("(you)").font(.system(size: 14)).foregroundStyle(Palette.muted) }
                                }
                                if let signedAt = signer.signedAt {
                                    Text("Signed \(SignFormat.when(nanos: signedAt))").font(.system(size: 13))
                                        .foregroundStyle(Palette.muted)
                                } else {
                                    Text(entry.isComplete ? "Not required" : "Hasn't signed yet").font(.system(size: 13))
                                        .foregroundStyle(Palette.muted)
                                }
                            }
                            Spacer()
                            Image(systemName: signer.signedAt != nil ? "checkmark.circle.fill" : "clock")
                                .font(.system(size: 18))
                                .foregroundStyle(signer.signedAt != nil ? Palette.good : Palette.wait)
                                .accessibilityLabel(signer.signedAt != nil ? "Signed" : "Waiting")
                        }
                        .padding(14)
                        if index < model.signers.count - 1 { Divider().overlay(Palette.hairline).padding(.leading, 64) }
                    }
                }
            }
        }
    }

    private func partSymbol(_ entry: DocumentEntry) -> String {
        if entry.canSign { return "signature" }
        if entry.isComplete { return "checkmark.seal" }
        if entry.iSigned { return "checkmark" }
        return "eye"
    }

    private func partText(_ entry: DocumentEntry) -> String {
        if entry.isComplete { return "Everyone has signed. The version below carries every signature." }
        if entry.iSigned {
            let left = entry.progress.required - entry.progress.signed
            return left > 0
                ? "You signed. Waiting on \(left) more \(left == 1 ? "signer" : "signers")."
                : "You signed. Waiting on the others."
        }
        if entry.canSign { return "This document is waiting on your signature." }
        if entry.myLevel == .read { return "You can read this document. Viewers aren't asked to sign." }
        return "You're not a signer of this agreement."
    }

    /// The current version, written where the share sheet can read it.
    private func shareURL(_ entry: DocumentEntry) -> URL? {
        guard let pdf = model.pdf else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(SignFormat.fileName(entry.document.name, signed: !entry.signatures.isEmpty))
        try? pdf.write(to: url, options: .atomic)
        return url
    }
}

enum ViewerMode: String, Identifiable {
    case read, sign
    var id: String { rawValue }
}
