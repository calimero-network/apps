// Mero Pass's vault types on Calimero 1.0 (the component ABI, `logic/res/abi.json`), kept by hand
// in step with the web app's `app/src/lib/meroPass.ts` / `vaultApi.ts` and iOS `Records.swift`. The
// calls are the generated [network.calimero.pass.generated.client.PassClient]
// (`scripts/mobile-codegen.sh` at the repo root); until the logic derives `AbiType` the ABI names
// these types without their shape, so the client takes and answers their JSON and [toPass] reads it.
//
// - methods, arguments and answer fields are camelCase (`addSecret`, `publicKey`, `createdAt`);
// - every u64 in an answer (`addedAt`, `createdAt`, `updatedAt`, `trashedAt`, `replacedAt`,
//   `timestamp`) is a decimal string, read back into a number here ([PassWireDecoding]);
// - `init` takes no arguments: a new vault is named with `renameVault` right after it is created;
// - `getSecret` answers `null` for an unknown id;
// - a refusal is `422 APP_ERROR {code: Forbidden|NotFound|Invalid|Conflict, fields: {message}}`.

package network.calimero.pass.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer

/**
 * One line of the activity trail. Who wrote it is the slot's owner stamp,
 * not a field: an author can claim anything in their own entry.
 */
@Serializable
data class AuditLogEntry(
    val action: String,
    /**
     * The object acted on: a secret id, an account, a device fingerprint.
     * Never a secret's name — names are ciphertext, and a trail that echoed
     * them in the clear would undo the encryption.
     */
    val target: String,
    /** The author's node device, as the author's node reported it. */
    val device: String,
    val timestamp: ULong,
)

@Serializable
data class AuditView(
    val action: String,
    val target: String,
    val account: String,
    val device: String,
    val timestamp: ULong,
    /**
     * True when the author blanked this entry. The slot stays, so a redaction
     * is itself visible in the trail.
     */
    val redacted: Boolean,
)

/**
 * A device public key the vault key may be wrapped to.
 *
 * Stored in an [`AuthoredMap`], so only the account that registered it can
 * remove it. Its account is the entry's owner stamp, which every node
 * verifies — never a field in the value, which a modified node could fill
 * with anyone's account to be handed the vault key in their name.
 *
 * Keys are per owner (core rc.57): two accounts registering one fingerprint
 * hold two entries, each read with its own account (`entries_with_owners`).
 * A key-only `owner_of` would only ever name the caller.
 */
@Serializable
data class DeviceKey(
    /** Base64 of the raw (uncompressed) P-256 ECDH public key. */
    val publicKey: String,
    val label: String,
    /**
     * `browser` for a browser's device key; `recovery` for an account's
     * offline recovery key, whose private half exists only on paper; `agent`
     * for the key of software acting for its account, admitted by an admin.
     */
    val kind: String,
    val nodeDevice: String,
    val addedAt: ULong,
)

@Serializable
data class DeviceView(
    val fingerprint: String,
    val publicKey: String,
    val label: String,
    val kind: String,
    val account: String,
    val addedAt: ULong,
    val revoked: Boolean,
)

@Serializable
data class Event_SecretChanged(
    val secretId: String,
)

/**
 * The vault key, wrapped to one device key by one wrapper.
 *
 * Keyed by `recipient:key_id:nonce` in an authored map: the random nonce
 * means nobody can occupy the key a genuine wrap will be written under, and the owner stamp says who wrapped
 * it. A forged wrap is detectable anyway — the recipient checks that the
 * unwrapped key hashes to `key_id` — but it must not be able to displace a
 * genuine one, nor make a device look approved (see `wrapped_pairs`).
 */
@Serializable
data class KeyWrap(
    val keyId: String,
    val recipient: String,
    val wrapper: String,
    /** ECIES envelope: ephemeral public key, IV and ciphertext, base64 JSON. */
    val envelope: String,
    val wrappedAt: ULong,
)

@Serializable
data class KeyWrapInput(
    val keyId: String,
    val recipient: String,
    val wrapper: String,
    val envelope: String,
)

@Serializable
data class KeyWrapView(
    val keyId: String,
    val recipient: String,
    val wrapper: String,
    val envelope: String,
    val wrappedBy: String,
)

@Serializable
data class MemberView(
    val account: String,
    /**
     * `admin`, `editor` or `viewer`; `pending` for an account that has
     * registered a device but was never given a role; `removed` for one an
     * admin removed, which clients must not auto-admit.
     */
    val role: String,
    val devices: UInt,
)

@Serializable
data class MeroPassApp(
    /**
     * The vault's human name as created, readable by every member on every
     * node. The frontend also writes it to the subgroup's metadata, for
     * members who have not entered the vault yet; this copy (or a rename in
     * `settings`) is the authoritative one.
     */
    val vaultName: String,
    val roles: Map<String, Boolean>,
    val secrets: Map<String, Secret>,
    /**
     * `secret_id/rev_id` → superseded value, so a secret's history is one
     * prefix read.
     */
    val history: Map<String, Revision>,
    /** Admin-only settings: `default_role`, `current_key`, `revoked:<fp>`. */
    val admin: Map<String, String>,
    /** Editor-writable settings: the vault's name after a rename. */
    val settings: Map<String, String>,
    /** Device fingerprint → public key. Any member may register their own. */
    val devices: Map<String, DeviceKey>,
    /** `recipient:key_id:nonce` → wrapped vault key. */
    val keyWraps: Map<String, KeyWrap>,
    /**
     * Append-only. Entries can be blanked only by their own author, and a
     * blanked slot stays visible as a redaction.
     */
    val audit: List<AuditLogEntry>,
)

/** A superseded field value. Written once, never edited. */
@Serializable
data class Revision(
    /** The field that changed; `name` and `tags` use those reserved names. */
    val field: String,
    /**
     * The value it held before, still encrypted (under whichever vault key it
     * was written with — the envelope names its key).
     */
    val previous: String,
    val replacedAt: ULong,
    val replacedBy: String,
)

@Serializable
data class RevisionView(
    val field: String,
    val previous: String,
    val replacedAt: ULong,
    val replacedBy: String,
)

/**
 * One secret, as independent registers rather than one record.
 *
 * Field-level registers are the point: Alice fixing the URL while Bob rotates
 * the password are writes to two different registers, so BOTH survive the
 * merge. A single last-writer-wins record would keep one edit and silently
 * discard the other. Within one field, last writer wins by HLC — there is no
 * meaningful way to merge two different passwords.
 */
@Serializable
data class Secret(
    /** Cleartext kind — `login`, `totp`, … — so the UI can pick an icon. */
    val kind: String,
    /** Encrypted display name. */
    val name: String,
    /** Encrypted tag list (one envelope over a JSON array). */
    val tags: String,
    /** Field name (`password`, `url`, …) → encrypted value. */
    val fields: Map<String, String>,
    val createdAt: ULong,
    val createdBy: String,
    val updatedAt: ULong,
    val updatedBy: String,
    /**
     * Tombstone. Trashing is a flag rather than a `remove`, because the map is
     * add-wins: a hard remove loses to a concurrent edit and the secret comes
     * back. The flag resolves edit-vs-trash by HLC instead.
     */
    val trashed: Boolean,
    val trashedAt: ULong,
)

@Serializable
data class SecretView(
    val id: String,
    val kind: String,
    val name: String,
    val tags: String,
    val fields: Map<String, String>,
    val createdAt: ULong,
    val createdBy: String,
    val updatedAt: ULong,
    val updatedBy: String,
    val trashed: Boolean,
    val trashedAt: ULong,
)

@Serializable
data class VaultInfo(
    val name: String,
    val currentKey: String,
    val defaultRole: String,
    val myAccount: String,
    val myRole: String,
)

/**
 * Reads the contract's answers: each u64 field arrives as a decimal string and is turned back into
 * a number before decoding, as the web adapter's `num` does. (Swift `PassWireDecoding`.)
 */
object PassWireDecoding {
    /** Every 64-bit field the contract answers, in any answer. */
    val U64_FIELDS: Set<String> = setOf("addedAt", "createdAt", "updatedAt", "trashedAt", "replacedAt", "timestamp", "wrappedAt")

    private val json = Json { ignoreUnknownKeys = true }

    fun <T> decode(
        serializer: KSerializer<T>,
        response: String,
    ): T = decode(serializer, json.parseToJsonElement(response))

    /** An answer of the generated client as the app type [serializer] reads. */
    fun <T> decode(
        serializer: KSerializer<T>,
        answer: JsonElement,
    ): T = json.decodeFromJsonElement(serializer, normalized(answer))

    /** [value] as the JSON the generated client takes. */
    fun <T> encode(
        serializer: KSerializer<T>,
        value: T,
    ): JsonElement = json.encodeToJsonElement(serializer, value)

    /** [element] with every u64 field's decimal string as a JSON number. */
    fun normalized(
        element: JsonElement,
        key: String? = null,
    ): JsonElement =
        when (element) {
            is JsonArray -> JsonArray(element.map { normalized(it) })
            is JsonObject -> JsonObject(element.mapValues { (k, v) -> normalized(v, k) })
            is JsonPrimitive ->
                // Timestamps in milliseconds: far below Long.MAX_VALUE.
                if (key in U64_FIELDS && element.isString && element.content.toLongOrNull()?.let { it >= 0 } == true) {
                    JsonPrimitive(element.content.toLong())
                } else {
                    element
                }
            else -> element
        }
}

/** An answer of the generated client as the vault type [T], its u64 fields read from their decimal strings. */
inline fun <reified T> JsonElement.toPass(): T = PassWireDecoding.decode(serializer<T>(), this)
