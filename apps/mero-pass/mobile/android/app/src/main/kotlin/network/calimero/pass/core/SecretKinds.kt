package network.calimero.pass.core

import java.net.URI

/** One field a kind of secret carries (the web's `secretKinds.ts` `FIELDS`). (Swift `FieldSpec`.) */
data class FieldSpec(
    val key: String,
    val label: String,
    val multiline: Boolean = false,
    val secret: Boolean = false,
    val generate: Boolean = false,
    val totp: Boolean = false,
)

/** The kinds a secret can be, in the web's order, with their fields and labels. (Swift `SecretKind`.) */
enum class SecretKind(
    val wire: String,
    val label: String,
    val plural: String,
) {
    LOGIN("login", "Login", "Logins"),
    SECURE_NOTE("secure_note", "Secure note", "Secure notes"),
    TOTP("totp", "Authenticator (TOTP)", "Authenticators"),
    SSH_KEY("ssh_key", "SSH key", "SSH keys"),
    PAYMENT_CARD("payment_card", "Payment card", "Payment cards"),
    IDENTITY("identity", "Identity", "Identities"),
    API_KEY("api_key", "API key", "API keys"),
    OAUTH2("oauth2", "OAuth connection", "OAuth connections"),
    ;

    val fields: List<FieldSpec>
        get() =
            when (this) {
                LOGIN ->
                    listOf(
                        FieldSpec("username", "Username"),
                        FieldSpec("password", "Password", secret = true, generate = true),
                        FieldSpec("url", "Website"),
                        FieldSpec("totp", "Authenticator seed or otpauth:// URI", secret = true, totp = true),
                        FieldSpec("notes", "Notes", multiline = true),
                    )
                SECURE_NOTE -> listOf(FieldSpec("notes", "Note", multiline = true, secret = true))
                TOTP ->
                    listOf(
                        FieldSpec("secret", "Seed or otpauth:// URI", secret = true, totp = true),
                        FieldSpec("issuer", "Issuer"),
                        FieldSpec("account", "Account"),
                    )
                SSH_KEY ->
                    listOf(
                        FieldSpec("private_key", "Private key", multiline = true, secret = true),
                        FieldSpec("public_key", "Public key", multiline = true),
                        FieldSpec("passphrase", "Passphrase", secret = true, generate = true),
                    )
                PAYMENT_CARD ->
                    listOf(
                        FieldSpec("cardholder_name", "Cardholder"),
                        FieldSpec("card_number", "Card number", secret = true),
                        FieldSpec("expiry_date", "Expires"),
                        FieldSpec("cvv", "CVV", secret = true),
                        FieldSpec("pin", "PIN", secret = true),
                        FieldSpec("notes", "Notes", multiline = true),
                    )
                IDENTITY ->
                    listOf(
                        FieldSpec("full_name", "Full name"),
                        FieldSpec("email", "Email"),
                        FieldSpec("phone", "Phone"),
                        FieldSpec("document_number", "Passport / ID number", secret = true),
                        FieldSpec("address", "Address", multiline = true),
                        FieldSpec("notes", "Notes", multiline = true),
                    )
                API_KEY ->
                    listOf(
                        FieldSpec("service", "Service"),
                        FieldSpec("base_url", "API base URL"),
                        FieldSpec("api_key", "API key", secret = true),
                        FieldSpec("api_secret", "API secret", secret = true),
                        FieldSpec("access_token", "Access token", secret = true),
                        FieldSpec("access_token_secret", "Access token secret", secret = true),
                        FieldSpec("notes", "Notes", multiline = true),
                    )
                OAUTH2 ->
                    listOf(
                        FieldSpec("provider", "Provider"),
                        FieldSpec("account", "Account"),
                        FieldSpec("client_id", "Client ID"),
                        FieldSpec("client_secret", "Client secret", secret = true),
                        FieldSpec("access_token", "Access token", secret = true),
                        FieldSpec("refresh_token", "Refresh token", secret = true),
                        FieldSpec("expires_at", "Access token expires"),
                        FieldSpec("scopes", "Scopes"),
                        FieldSpec("notes", "Notes", multiline = true),
                    )
            }

    companion object {
        /** The order categories are listed in (the web's `CATEGORIES`). */
        val categoryOrder = listOf(LOGIN, SECURE_NOTE, PAYMENT_CARD, IDENTITY, TOTP, SSH_KEY, API_KEY, OAUTH2)

        fun of(wire: String): SecretKind? = entries.firstOrNull { it.wire == wire }

        fun labelOf(kind: String): String = of(kind)?.label ?: kind.replace('_', ' ')

        private fun spec(
            kind: String,
            field: String,
        ): FieldSpec? = of(kind)?.fields?.firstOrNull { it.key == field }

        /** Whether [field] of a [kind] secret is concealed until revealed. */
        fun isSensitive(
            kind: String,
            field: String,
        ): Boolean {
            spec(kind, field)?.let { return it.secret }
            val lower = field.lowercase()
            return listOf("pass", "secret", "key", "cvv", "pin", "token", "seed", "private").any { lower.contains(it) }
        }

        fun isTotpField(
            kind: String,
            field: String,
        ): Boolean = spec(kind, field)?.totp ?: false

        fun isMultiline(
            kind: String,
            field: String,
        ): Boolean = spec(kind, field)?.multiline ?: false
    }
}

/** How a decrypted secret presents in a list (the web's `itemView.ts`). (Swift `ItemView`.) */
object ItemView {
    private val schemeRe = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")

    /** The host of a stored website, without scheme or `www.`; "" when none. */
    fun hostOf(url: String?): String {
        val raw = url.orEmpty().trim()
        if (raw.isEmpty()) return ""
        val host =
            runCatching { URI(if (schemeRe.containsMatchIn(raw)) raw else "https://$raw").host }.getOrNull()
                ?: return ""
        val lower = host.lowercase()
        return lower.removePrefix("www.")
    }

    /** A stored website as a link to open, or `null`. */
    fun openableUrl(url: String?): String? {
        val raw = url.orEmpty().trim()
        if (raw.isEmpty()) return null
        if (raw.lowercase().startsWith("http://") || raw.lowercase().startsWith("https://")) return raw
        return if (hostOf(raw).isEmpty()) null else "https://$raw"
    }

    /** The line under an item's name. Never a secret value, except a card's last four. */
    fun subtitle(s: Secret): String {
        fun v(key: String) = s.fields[key].orEmpty()

        fun firstNonEmpty(vararg values: String) = values.firstOrNull { it.isNotEmpty() }
        return when (SecretKind.of(s.kind)) {
            SecretKind.LOGIN -> firstNonEmpty(v("username"), hostOf(v("url"))) ?: "Login"
            SecretKind.PAYMENT_CARD -> {
                val digits = v("card_number").filter { it.isDigit() }
                if (digits.length >= 4) "•••• ${digits.takeLast(4)}" else firstNonEmpty(v("cardholder_name")) ?: "Payment card"
            }
            SecretKind.IDENTITY -> firstNonEmpty(v("full_name"), v("email")) ?: "Identity"
            SecretKind.TOTP -> listOf(v("issuer"), v("account")).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Authenticator" }
            SecretKind.SSH_KEY -> "SSH key"
            SecretKind.API_KEY -> firstNonEmpty(v("service"), hostOf(v("base_url"))) ?: "API key"
            SecretKind.OAUTH2 -> listOf(v("provider"), v("account")).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "OAuth" }
            else -> SecretKind.labelOf(s.kind)
        }
    }

    /** The letter on a tile. */
    fun monogram(name: String): String {
        val ch = name.trim().firstOrNull { it.isLetterOrDigit() } ?: return "•"
        return ch.uppercase()
    }

    /** A stable hue (0–359) from a name, the same as the web's `hueOf`. */
    fun hue(name: String): Int {
        var h = 0
        val text = name.trim().lowercase()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            h = (h * 31 + cp) % 360
            i += Character.charCount(cp)
        }
        return h
    }

    /** Search over names, tags, usernames and sites. Never over secret values. */
    fun matches(
        s: Secret,
        query: String,
    ): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return true
        val haystack = listOf(s.name) + s.tags + listOf("username", "url", "email", "issuer", "account", "full_name").mapNotNull { s.fields[it] }
        return haystack.any { it.lowercase().contains(q) }
    }

    /** Alphabetical, ignoring case and accents. */
    val byName: Comparator<Secret> =
        Comparator { a, b ->
            java.text.Collator
                .getInstance()
                .apply { strength = java.text.Collator.PRIMARY }
                .compare(a.name, b.name)
        }

    /** Calimero stamps in nanoseconds; anything that large is not milliseconds. Epoch ms. */
    fun millis(stamp: ULong): Long {
        val v = stamp.toLong()
        return if (v > 1_000_000_000_000L) v / 1_000_000 else v
    }

    /** "you", or a short account id. */
    fun who(
        account: String,
        me: String?,
    ): String = if (account.isNotEmpty() && account == me) "you" else shortAccount(account)

    fun shortAccount(account: String): String {
        val s = account.trim()
        if (s.isEmpty()) return "unknown"
        return if (s.length <= 11) s else "${s.take(6)}…${s.takeLast(4)}"
    }

    data class ShownField(
        val key: String,
        val label: String,
        val value: String,
    )

    /** The fields to show, in the kind's order, then any others; empty ones left out. */
    fun orderedFields(s: Secret): List<ShownField> {
        val spec = SecretKind.of(s.kind)?.fields.orEmpty()
        val known = spec.mapNotNull { f -> s.fields[f.key]?.takeIf { it.isNotEmpty() }?.let { ShownField(f.key, f.label, it) } }
        val extra =
            s.fields.keys
                .sorted()
                .filter { k -> !s.fields[k].isNullOrEmpty() && spec.none { it.key == k } }
                .map { ShownField(it, it.replace('_', ' '), s.fields.getValue(it)) }
        return known + extra
    }
}
