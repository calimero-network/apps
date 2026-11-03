package network.calimero.models.core

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Where the sign-in screen connects: a Calimero Cloud cluster by its name (`eu-shared-1`, its
 * nodes read from the node directory), or one of its nodes by URL. A bare host
 * (`node.example.com`) is read as https. (Swift `ClusterTarget`.)
 */
sealed interface ClusterTarget {
    data class Name(
        val name: String,
    ) : ClusterTarget

    data class Url(
        val url: String,
    ) : ClusterTarget

    /** What the screen says it signs in to. */
    val label: String
        get() =
            when (this) {
                is Name -> name
                is Url -> url.toHttpUrlOrNull()?.host ?: url
            }

    companion object {
        private val NAME = Regex("^[a-z0-9_-]+$")

        /** What the person typed, or null when it is neither a name nor an address. */
        @Suppress("ReturnCount")
        fun parse(input: String): ClusterTarget? {
            val trimmed = input.trim()
            if (trimmed.isEmpty() || trimmed.contains(' ')) return null
            if (trimmed.contains("://")) {
                val url = trimmed.toHttpUrlOrNull() ?: return null
                if (url.host.isEmpty()) return null
                return Url(trimmed.trimEnd('/'))
            }
            if (trimmed.contains('.') || trimmed.contains(':')) return parse("https://$trimmed")
            val lower = trimmed.lowercase()
            return if (NAME.matches(lower)) Name(lower) else null
        }
    }
}
