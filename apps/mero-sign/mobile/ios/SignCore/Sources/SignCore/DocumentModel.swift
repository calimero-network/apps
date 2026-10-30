import Foundation
import MeroKit

/// Someone whose signature a document waits for, or who signed it.
public struct SignerRow: Identifiable, Equatable, Sendable {
    public let account: String
    public let name: String?
    public let isMe: Bool
    /// Nanoseconds, when they signed.
    public let signedAt: UInt64?
    /// Whether the document waited on them when it was uploaded.
    public let required: Bool

    public var id: String { account }
    public var displayName: String { name ?? SignIds.short(account) }
}

/// Where signing stands, step by step: consent, pick a signature, place it, send.
public enum SigningStep: Equatable, Sendable {
    case idle
    /// Asking the contract who you are and whether you consented.
    case checking
    /// You have not consented to sign this document electronically yet.
    case consent
    /// Draw a signature or pick a saved one.
    case choose
    /// Put it on the page.
    case placing
    /// Stamping, uploading and recording.
    case submitting
    case done
}

/// One document: who signs it, its PDF, and signing it.
///
/// Signing does what the web's viewer does, in order (`PDFViewer`,
/// `ConsentModal`, `DocumentService.signDocument`):
///
/// 1. `whoami` for your ACCOUNT, then `has_consented(account, document)`.
/// 2. If not, the consent disclosure; accepting calls `set_consent(document)`
///    (no user argument: the contract records it for the caller).
/// 3. Draw a signature, or pick one from the library in the private context.
/// 4. Place it; the PNG is drawn onto that page of the version you opened.
/// 5. Upload the signed PDF as a blob into the agreement's context, hash it
///    (SHA-256, hex), and `sign_document(document, base_hash, blob, size,
///    new_hash)` where `base_hash` is the version you opened — the contract
///    refuses a stale one rather than erase somebody's signature.
/// 6. `mark_participant_signed(document)`.
@MainActor
public final class DocumentModel: ObservableObject {
    @Published public private(set) var entry: DocumentEntry?
    @Published public private(set) var signers: [SignerRow] = []
    @Published public private(set) var phase: LoadPhase = .loading

    @Published public private(set) var pdf: Data?
    @Published public private(set) var pdfHash: String?
    @Published public private(set) var pdfError: String?
    @Published public private(set) var integrityWarning: String?
    @Published public private(set) var isLoadingPDF = false

    @Published public private(set) var step: SigningStep = .idle
    @Published public private(set) var savedSignatures: [SavedSignature] = []
    @Published public private(set) var libraryLoading = false
    /// The PNG chosen in step 3, and whether it was drawn just now.
    @Published public private(set) var chosenSignature: Data?
    @Published public private(set) var chosenIsNew = false
    @Published public var error: String?

    public let directory: AgreementDirectory
    public let names: NameDirectory
    public let agreement: AgreementRef
    public let documentId: String
    private let stamper: any PDFStamping

    public init(
        directory: AgreementDirectory, names: NameDirectory, agreement: AgreementRef, documentId: String,
        stamper: any PDFStamping = PDFStamper(), initial: DocumentEntry? = nil
    ) {
        self.directory = directory
        self.names = names
        self.agreement = agreement
        self.documentId = documentId
        self.stamper = stamper
        self.entry = initial
    }

    private var client: SignClient { directory.client(agreement.contextId) }
    private var admin: any SignAdmin { directory.store.admin }

    // MARK: Loading

    public func load() async {
        if entry == nil { phase = .loading }
        do {
            let snapshot = try await directory.snapshot(agreement, signaturesForCompleted: true)
            guard let found = snapshot.documents.first(where: { $0.document.id == documentId }) else {
                phase = .failed("This document isn't in the agreement any more.")
                return
            }
            entry = found
            phase = .loaded
            await loadSigners(found)
        } catch {
            phase = entry == nil ? .failed(SignErrorText.describe(error)) : .loaded
            if entry != nil { self.error = SignErrorText.describe(error) }
        }
    }

    private func loadSigners(_ entry: DocumentEntry) async {
        var accounts: [String] = entry.document.requiredSigners.map(\.hex)
        for signature in entry.signatures where !accounts.contains(where: { SignIds.same(signature.signer, $0) }) {
            accounts.append(SignIds.hex(signature.signer))
        }
        var rows: [SignerRow] = []
        for account in accounts {
            let signed = entry.signatures.first { SignIds.same($0.signer, account) }
            rows.append(
                SignerRow(
                    account: account, name: await names.name(of: account, in: agreement.namespaceId),
                    isMe: SignIds.same(account, entry.me), signedAt: signed?.signedAt,
                    required: entry.document.requiredSigners.contains { SignIds.same($0, account) }))
        }
        signers = rows
    }

    /// The current version's PDF, read through the agreement's context and
    /// checked against the hash the agreement recorded for it.
    public func loadPDF(force: Bool = false) async {
        guard let entry else { return }
        if !force, pdf != nil, pdfHash == entry.document.hash { return }
        isLoadingPDF = true
        pdfError = nil
        defer { isLoadingPDF = false }
        let blobId = SignIds.blobHex(entry.document.pdfBlobId)
        guard !blobId.isEmpty else {
            pdfError = "This document has no readable file recorded against it."
            return
        }
        do {
            let bytes = try await admin.getBlob(blobId, contextId: agreement.contextId)
            integrityWarning = DocumentHash.integrityWarning(bytes: bytes, recordedHash: entry.document.hash)
            pdf = bytes
            pdfHash = entry.document.hash
        } catch {
            pdfError = SignErrorText.describe(error)
        }
    }

    // MARK: Signing

    /// Step 1: who you are, and whether you consented to this document.
    public func beginSigning() async {
        guard let entry, entry.canSign else { return }
        error = nil
        step = .checking
        do {
            let me = SignIds.hex(try await client.whoami())
            let consented = try await client.hasConsented(userIdStr: me, documentId: documentId)
            step = consented ? .choose : .consent
            if consented { await loadLibrary() }
        } catch {
            step = .idle
            self.error = SignErrorText.describe(error)
        }
    }

    /// Step 2: record your consent (`set_consent`), then go on to choose.
    public func giveConsent() async {
        error = nil
        do {
            try await client.setConsent(documentId: documentId)
            step = .choose
            await loadLibrary()
        } catch {
            self.error = SignErrorText.describe(error)
        }
    }

    /// The saved signatures, for step 3.
    public func loadLibrary() async {
        libraryLoading = true
        defer { libraryLoading = false }
        savedSignatures = (try? await directory.store.signatures()) ?? []
    }

    /// Step 3: a signature, drawn now (`isNew`) or from the library.
    public func choose(png: Data, isNew: Bool) {
        chosenSignature = png
        chosenIsNew = isNew
        step = .placing
    }

    /// Back from placing to choosing.
    public func backToChoose() {
        step = .choose
    }

    public func cancelSigning() {
        step = .idle
        chosenSignature = nil
        chosenIsNew = false
    }

    /// Steps 4–6. `saveToLibrary` also keeps a newly drawn signature in your
    /// private library, after the document is signed.
    public func submit(placement: SignaturePlacement, saveToLibrary: Bool) async {
        guard let entry, let png = chosenSignature else { return }
        guard let original = pdf, pdfHash == entry.document.hash else {
            error = "The document is still loading. Try again in a moment."
            return
        }
        error = nil
        step = .submitting
        do {
            let signed = try stamper.stamp(pdf: original, signaturePNG: png, at: placement)
            let newHash = DocumentHash.sha256Hex(signed)
            let blobId = SignIds.blobHex(try await admin.uploadBlob(signed, contextId: agreement.contextId))
            guard !blobId.isEmpty else {
                throw SignModelError.message("Your cluster returned a blob id this app can't use.")
            }
            try await client.signDocument(
                documentId: documentId, baseHash: entry.document.hash, pdfBlobIdStr: blobId,
                fileSize: UInt64(signed.count), newHash: newHash)
            try await client.markParticipantSigned(documentId: documentId)
            if saveToLibrary, chosenIsNew {
                let name = "Signature \(savedSignatures.count + 1)"
                _ = try? await directory.store.saveSignature(png: png, name: name)
            }
            chosenSignature = nil
            step = .done
            await load()
            await loadPDF(force: true)
        } catch {
            step = .placing
            let text = SignErrorText.describe(error)
            if text.localizedCaseInsensitiveContains("changed while you were signing") {
                self.error = "Someone signed this document while you were placing your signature. "
                    + "It has been reloaded — sign again on the new version."
                step = .idle
                await load()
                await loadPDF(force: true)
            } else {
                self.error = text
            }
        }
    }

    public func finish() {
        step = .idle
        chosenIsNew = false
    }
}
