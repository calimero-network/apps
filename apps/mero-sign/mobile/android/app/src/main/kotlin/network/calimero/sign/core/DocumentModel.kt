package network.calimero.sign.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Someone whose signature a document waits for, or who signed it. (Swift `SignerRow`.) */
data class SignerRow(
    val account: String,
    val name: String?,
    val isMe: Boolean,
    /** Nanoseconds, when they signed. */
    val signedAt: ULong?,
    val required: Boolean,
) {
    val displayName: String get() = name ?: SignIds.short(account)
}

/** Where signing stands: consent, pick a signature, place it, send. (Swift `SigningStep`.) */
enum class SigningStep { IDLE, CHECKING, CONSENT, CHOOSE, PLACING, SUBMITTING, DONE }

/**
 * One document: who signs it, its PDF, and signing it, in the web viewer's order — `whoami`,
 * `has_consented`, `set_consent`, choose, place, upload the signed PDF into the agreement's context,
 * `sign_document(document, base_hash, blob, size, new_hash)`, `mark_participant_signed`.
 * (Swift `DocumentModel`.)
 */
class DocumentModel(
    val directory: AgreementDirectory,
    val names: NameDirectory,
    val agreement: AgreementRef,
    val documentId: String,
    private val stamper: PdfStamping,
    initial: DocumentEntry? = null,
) {
    private val _entry = MutableStateFlow(initial)
    val entry: StateFlow<DocumentEntry?> = _entry.asStateFlow()
    private val _signers = MutableStateFlow<List<SignerRow>>(emptyList())
    val signers: StateFlow<List<SignerRow>> = _signers.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()

    private val _pdf = MutableStateFlow<ByteArray?>(null)
    val pdf: StateFlow<ByteArray?> = _pdf.asStateFlow()
    private var pdfHash: String? = null
    private val _pdfError = MutableStateFlow<String?>(null)
    val pdfError: StateFlow<String?> = _pdfError.asStateFlow()
    private val _integrityWarning = MutableStateFlow<String?>(null)
    val integrityWarning: StateFlow<String?> = _integrityWarning.asStateFlow()

    private val _step = MutableStateFlow(SigningStep.IDLE)
    val step: StateFlow<SigningStep> = _step.asStateFlow()
    private val _savedSignatures = MutableStateFlow<List<SavedSignature>>(emptyList())
    val savedSignatures: StateFlow<List<SavedSignature>> = _savedSignatures.asStateFlow()
    private val _libraryLoading = MutableStateFlow(false)
    val libraryLoading: StateFlow<Boolean> = _libraryLoading.asStateFlow()
    private val _chosenSignature = MutableStateFlow<ByteArray?>(null)
    val chosenSignature: StateFlow<ByteArray?> = _chosenSignature.asStateFlow()
    private val _chosenIsNew = MutableStateFlow(false)
    val chosenIsNew: StateFlow<Boolean> = _chosenIsNew.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    private val client get() = directory.client(agreement.contextId)
    private val admin get() = directory.store.admin

    suspend fun load() {
        if (_entry.value == null) _phase.value = LoadPhase.Loading
        attempt { directory.snapshot(agreement, signaturesForCompleted = true) }
            .onSuccess { snapshot ->
                val found = snapshot.documents.firstOrNull { it.document.id == documentId }
                if (found == null) {
                    _phase.value = LoadPhase.Failed("This document isn't in the agreement any more.")
                    return
                }
                _entry.value = found
                _phase.value = LoadPhase.Loaded
                loadSigners(found)
            }.onFailure {
                if (_entry.value == null) {
                    _phase.value = LoadPhase.Failed(SignErrorText.describe(it))
                } else {
                    _phase.value = LoadPhase.Loaded
                    error.value = SignErrorText.describe(it)
                }
            }
    }

    private suspend fun loadSigners(entry: DocumentEntry) {
        val accounts =
            entry.document.requiredSigners
                .map { it.hex }
                .toMutableList()
        entry.signatures.forEach { s -> if (accounts.none { SignIds.same(s.signer, it) }) accounts += SignIds.hex(s.signer) }
        _signers.value =
            accounts.map { account ->
                SignerRow(
                    account = account,
                    name = names.name(account, agreement.namespaceId),
                    isMe = SignIds.same(account, entry.me),
                    signedAt = entry.signatures.firstOrNull { SignIds.same(it.signer, account) }?.signedAt,
                    required = entry.document.requiredSigners.any { SignIds.same(it, account) },
                )
            }
    }

    /** The current version's PDF, read through the agreement's context and checked against its hash. */
    suspend fun loadPdf(force: Boolean = false) {
        val entry = _entry.value ?: return
        if (!force && _pdf.value != null && pdfHash == entry.document.hash) return
        _pdfError.value = null
        val blobId = SignIds.blobHex(entry.document.pdfBlobId)
        if (blobId.isEmpty()) {
            _pdfError.value = "This document has no readable file recorded against it."
            return
        }
        attempt { admin.getBlob(blobId, agreement.contextId) }
            .onSuccess { bytes ->
                _integrityWarning.value = DocumentHash.integrityWarning(bytes, entry.document.hash)
                pdfHash = entry.document.hash
                _pdf.value = bytes
            }.onFailure { _pdfError.value = SignErrorText.describe(it) }
    }

    /** Step 1: who you are, and whether you consented to this document. */
    suspend fun beginSigning() {
        val entry = _entry.value ?: return
        if (!entry.canSign) return
        error.value = null
        _step.value = SigningStep.CHECKING
        attempt {
            val me = SignIds.hex(client.whoami())
            client.hasConsented(me, documentId)
        }.onSuccess { consented ->
            _step.value = if (consented) SigningStep.CHOOSE else SigningStep.CONSENT
            if (consented) loadLibrary()
        }.onFailure {
            _step.value = SigningStep.IDLE
            error.value = SignErrorText.describe(it)
        }
    }

    /** Step 2: record your consent (`set_consent`), then choose. */
    suspend fun giveConsent() {
        error.value = null
        attempt { client.setConsent(documentId) }
            .onSuccess {
                _step.value = SigningStep.CHOOSE
                loadLibrary()
            }.onFailure { error.value = SignErrorText.describe(it) }
    }

    suspend fun loadLibrary() {
        _libraryLoading.value = true
        _savedSignatures.value = attempt { directory.store.signatures() }.getOrDefault(emptyList())
        _libraryLoading.value = false
    }

    /** Step 3: a signature, drawn now ([isNew]) or from the library. */
    fun choose(
        png: ByteArray,
        isNew: Boolean,
    ) {
        _chosenSignature.value = png
        _chosenIsNew.value = isNew
        _step.value = SigningStep.PLACING
    }

    fun backToChoose() {
        _step.value = SigningStep.CHOOSE
    }

    fun cancelSigning() {
        _step.value = SigningStep.IDLE
        _chosenSignature.value = null
        _chosenIsNew.value = false
    }

    /** Steps 4–6. [saveToLibrary] also keeps a newly drawn signature, after the document is signed. */
    suspend fun submit(
        placement: SignaturePlacement,
        saveToLibrary: Boolean,
    ) {
        val entry = _entry.value ?: return
        val png = _chosenSignature.value ?: return
        val original = _pdf.value
        if (original == null || pdfHash != entry.document.hash) {
            error.value = "The document is still loading. Try again in a moment."
            return
        }
        error.value = null
        _step.value = SigningStep.SUBMITTING
        attempt {
            val signed = stamper.stamp(original, png, placement)
            val newHash = DocumentHash.sha256Hex(signed)
            val blobId = SignIds.blobHex(admin.uploadBlob(signed, agreement.contextId))
            if (blobId.isEmpty()) throw SignModelException("Your relay returned a blob id this app can't use.")
            client.signDocument(documentId, entry.document.hash, blobId, signed.size.toULong(), newHash)
            client.markParticipantSigned(documentId)
            if (saveToLibrary && _chosenIsNew.value) {
                attempt { directory.store.saveSignature(png, "Signature ${_savedSignatures.value.size + 1}") }
            }
        }.onSuccess {
            _chosenSignature.value = null
            _step.value = SigningStep.DONE
            load()
            loadPdf(force = true)
        }.onFailure {
            val text = SignErrorText.describe(it)
            if (text.contains("changed while you were signing", ignoreCase = true)) {
                error.value = "Someone signed this document while you were placing your signature. " +
                    "It has been reloaded — sign again on the new version."
                _step.value = SigningStep.IDLE
                load()
                loadPdf(force = true)
            } else {
                _step.value = SigningStep.PLACING
                error.value = text
            }
        }
    }

    fun finish() {
        _step.value = SigningStep.IDLE
        _chosenIsNew.value = false
    }
}
