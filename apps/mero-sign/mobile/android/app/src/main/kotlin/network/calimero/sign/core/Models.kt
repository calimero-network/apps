package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import network.calimero.sign.generated.PermissionLevel

/**
 * Every document in every agreement the account is in, sorted into To sign, Waiting and
 * Completed; agreements it can see but has not opened yet are listed beside it. (Swift `InboxModel`.)
 */
class InboxModel(
    val directory: AgreementDirectory,
) {
    private val _entries = MutableStateFlow<List<DocumentEntry>>(emptyList())
    val entries: StateFlow<List<DocumentEntry>> = _entries.asStateFlow()
    private val _unopened = MutableStateFlow<List<AgreementRef>>(emptyList())
    val unopened: StateFlow<List<AgreementRef>> = _unopened.asStateFlow()
    private val _syncing = MutableStateFlow<List<AgreementRef>>(emptyList())
    val syncing: StateFlow<List<AgreementRef>> = _syncing.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    val bucket = MutableStateFlow(InboxBucket.TO_SIGN)
    private val _opening = MutableStateFlow<String?>(null)
    val opening: StateFlow<String?> = _opening.asStateFlow()
    val notice = MutableStateFlow<String?>(null)

    val hasRelay: Boolean get() = directory.backend.hasRelay

    fun entries(bucket: InboxBucket): List<DocumentEntry> = _entries.value.filter { it.bucket == bucket }.sortedByDescending { it.document.uploadedAt }

    fun count(bucket: InboxBucket): Int = _entries.value.count { it.bucket == bucket }

    suspend fun load() {
        if (_entries.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt { directory.allAgreements() }
            .onFailure {
                if (_entries.value.isEmpty()) _phase.value = LoadPhase.Failed(SignErrorText.describe(it)) else _phase.value = LoadPhase.Loaded
            }.onSuccess { agreements ->
                val backend = directory.backend
                val (joined, notJoined) = agreements.partition { attempt { backend.isMember(it.contextId) }.getOrDefault(false) }
                val results =
                    coroutineScope {
                        joined.map { agreement -> async { agreement to attempt { directory.snapshot(agreement) } } }.awaitAll()
                    }
                val loaded =
                    results.flatMap {
                        it.second
                            .getOrNull()
                            ?.documents
                            .orEmpty()
                    }
                val failures = results.filter { it.second.isFailure }
                val stillSyncing = failures.filter { SignErrorText.isSyncing(it.second.exceptionOrNull()!!) }.map { it.first }
                val firstError = failures.firstOrNull { !SignErrorText.isSyncing(it.second.exceptionOrNull()!!) }?.second?.exceptionOrNull()
                _entries.value = loaded
                _unopened.value = notJoined.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
                _syncing.value = stillSyncing
                _phase.value =
                    if (loaded.isEmpty() && firstError != null && stillSyncing.isEmpty()) {
                        LoadPhase.Failed(SignErrorText.describe(firstError))
                    } else {
                        LoadPhase.Loaded
                    }
            }
    }

    /** Enter an agreement you can see but haven't opened, as the invitation flow does, then reload. */
    suspend fun open(agreement: AgreementRef) {
        _opening.value = agreement.contextId
        try {
            attempt {
                directory.enter(agreement.contextId)
                directory.settle(agreement.contextId, agreement.name)
            }.onFailure { notice.value = SignErrorText.describe(it) }
            load()
        } finally {
            _opening.value = null
        }
    }
}

/** A workspace and its agreements, for the Agreements tab. */
data class WorkspaceSection(
    val workspace: AppNamespace,
    val agreements: List<AgreementRow>,
) {
    val name: String get() = AgreementDirectory.nameOf(workspace)
}

data class AgreementRow(
    val agreement: AgreementRef,
    /** Whether the account has entered it. */
    val joined: Boolean,
)

/** The Agreements tab: every workspace and the agreements in it. (Swift `AgreementsModel`.) */
class AgreementsModel(
    val directory: AgreementDirectory,
) {
    private val _sections = MutableStateFlow<List<WorkspaceSection>>(emptyList())
    val sections: StateFlow<List<WorkspaceSection>> = _sections.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _opening = MutableStateFlow<String?>(null)
    val opening: StateFlow<String?> = _opening.asStateFlow()
    val notice = MutableStateFlow<String?>(null)

    val hasRelay: Boolean get() = directory.backend.hasRelay

    suspend fun load() {
        if (_sections.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt {
            directory.workspaces().map { workspace ->
                val rows =
                    attempt { directory.agreements(workspace) }.getOrDefault(emptyList()).map {
                        AgreementRow(it, attempt { directory.backend.isMember(it.contextId) }.getOrDefault(false))
                    }
                WorkspaceSection(workspace, rows)
            }
        }.onSuccess {
            _sections.value = it
            _phase.value = LoadPhase.Loaded
        }.onFailure {
            _phase.value = if (_sections.value.isEmpty()) LoadPhase.Failed(SignErrorText.describe(it)) else LoadPhase.Loaded
        }
    }

    /** Make sure the account is in the agreement before it is shown. True when it can open. */
    suspend fun prepare(row: AgreementRow): Boolean {
        if (row.joined) return true
        _opening.value = row.agreement.contextId
        try {
            return attempt {
                directory.enter(row.agreement.contextId)
                directory.settle(row.agreement.contextId, row.agreement.name)
                load()
                true
            }.getOrElse {
                notice.value = SignErrorText.describe(it)
                false
            }
        } finally {
            _opening.value = null
        }
    }
}

/** A participant of an agreement. */
data class PersonRow(
    val account: String,
    val name: String?,
    val level: PermissionLevel,
    val isMe: Boolean,
) {
    val displayName: String get() = name ?: SignIds.short(account)
}

/** One agreement: its documents and its people. (Swift `AgreementModel`.) */
class AgreementModel(
    val directory: AgreementDirectory,
    val names: NameDirectory,
    agreement: AgreementRef,
) {
    private val _agreement = MutableStateFlow(agreement)
    val agreement: StateFlow<AgreementRef> = _agreement.asStateFlow()
    private val _snapshot = MutableStateFlow<AgreementSnapshot?>(null)
    val snapshot: StateFlow<AgreementSnapshot?> = _snapshot.asStateFlow()
    private val _people = MutableStateFlow<List<PersonRow>>(emptyList())
    val people: StateFlow<List<PersonRow>> = _people.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isSyncing = MutableStateFlow(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()
    private var settled = false

    val documents: List<DocumentEntry> get() =
        _snapshot.value
            ?.documents
            .orEmpty()
            .sortedByDescending { it.document.uploadedAt }

    suspend fun load() {
        if (_snapshot.value == null) _phase.value = LoadPhase.Loading
        val current = _agreement.value
        attempt {
            var loaded = directory.snapshot(current)
            // Entered but never registered: settle in once, as the invitation flow would have.
            if (!loaded.isParticipant && !settled) {
                settled = true
                directory.settle(current.contextId, current.name)
                loaded = directory.snapshot(current)
            }
            loaded
        }.onSuccess { loaded ->
            _agreement.value = loaded.agreement
            _snapshot.value = loaded
            _isSyncing.value = false
            _phase.value = LoadPhase.Loaded
            _people.value =
                loaded.details.participants
                    .map {
                        PersonRow(SignIds.hex(it.userId), names.name(it.userId.hex, current.namespaceId), it.permissionLevel, SignIds.same(it.userId, loaded.me))
                    }.sortedWith(compareBy<PersonRow> { !it.isMe }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName })
        }.onFailure {
            if (SignErrorText.isSyncing(it)) {
                _isSyncing.value = true
                _phase.value = if (_snapshot.value == null) LoadPhase.Loading else LoadPhase.Loaded
            } else {
                _phase.value = if (_snapshot.value == null) LoadPhase.Failed(SignErrorText.describe(it)) else LoadPhase.Loaded
            }
        }
    }
}

/** The signature library (the web's `SignaturesPage`). (Swift `SignaturesModel`.) */
class SignaturesModel(
    val store: PrivateStore,
) {
    private val _signatures = MutableStateFlow<List<SavedSignature>>(emptyList())
    val signatures: StateFlow<List<SavedSignature>> = _signatures.asStateFlow()
    private val _phase = MutableStateFlow<LoadPhase>(LoadPhase.Loading)
    val phase: StateFlow<LoadPhase> = _phase.asStateFlow()
    private val _isSaving = MutableStateFlow(false)
    val isSaving: StateFlow<Boolean> = _isSaving.asStateFlow()
    val notice = MutableStateFlow<String?>(null)

    suspend fun load() {
        if (_signatures.value.isEmpty()) _phase.value = LoadPhase.Loading
        attempt { store.signatures() }
            .onSuccess {
                _signatures.value = it
                _phase.value = LoadPhase.Loaded
            }.onFailure {
                _phase.value = if (_signatures.value.isEmpty()) LoadPhase.Failed(SignErrorText.describe(it)) else LoadPhase.Loaded
            }
    }

    /** Save a drawn signature as "Signature N", as the web names them. */
    suspend fun save(png: ByteArray) {
        _isSaving.value = true
        try {
            attempt { store.saveSignature(png, "Signature ${_signatures.value.size + 1}") }
                .onSuccess {
                    _signatures.value = listOf(it) + _signatures.value
                    load()
                }.onFailure { notice.value = SignErrorText.describe(it) }
        } finally {
            _isSaving.value = false
        }
    }

    suspend fun delete(signature: SavedSignature) {
        val before = _signatures.value
        _signatures.value = before.filterNot { it.id == signature.id }
        attempt { store.deleteSignature(signature.id) }.onFailure {
            _signatures.value = before
            notice.value = SignErrorText.describe(it)
        }
    }
}
