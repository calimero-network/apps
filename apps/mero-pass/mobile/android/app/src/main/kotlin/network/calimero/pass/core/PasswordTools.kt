package network.calimero.pass.core

/**
 * Password strength, the generator and the vault health check: the web's `app/src/lib/health.ts`,
 * computed on the phone over decrypted secrets. (Swift `PasswordTools`.)
 */
object PasswordTools {
    const val GENERATOR_MIN = 12
    const val GENERATOR_MAX = 64
    const val GENERATOR_DEFAULT = 20

    private val common =
        setOf(
            "password",
            "123456",
            "12345678",
            "qwerty",
            "letmein",
            "admin",
            "welcome",
            "iloveyou",
            "monkey",
            "dragon",
            "hunter2",
            "password1",
            "abc123",
        )

    val strengthLabels = listOf("Very weak", "Weak", "Fair", "Strong", "Very strong")

    /** 0–4 from length, character classes and a common-word check. */
    fun strength(pw: String): Int {
        if (pw.isEmpty()) return 0
        if (pw.lowercase() in common) return 0
        val classes =
            listOf(
                pw.any { it in 'a'..'z' },
                pw.any { it in 'A'..'Z' },
                pw.any { it in '0'..'9' },
                pw.any { it !in 'a'..'z' && it !in 'A'..'Z' && it !in '0'..'9' },
            ).count { it }
        if (pw.length > 1 && pw.all { it == pw[0] }) return 0
        var score = 0
        if (pw.length >= 8) score += 1
        if (pw.length >= 12) score += 1
        if (pw.length >= 16) score += 1
        if (classes >= 3) score += 1
        if (pw.length < 8) score = minOf(score, 1)
        return minOf(score, 4)
    }

    /** A strong random password from a URL- and shell-safe alphabet. */
    fun generate(length: Int = GENERATOR_DEFAULT): String {
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+"
        val limit = 256 - (256 % alphabet.length)
        val out = StringBuilder()
        while (out.length < length) {
            for (b in Bytes.random(length * 2)) {
                val v = b.toInt() and 0xFF
                if (v < limit && out.length < length) out.append(alphabet[v % alphabet.length])
            }
        }
        return out.toString()
    }

    enum class Issue(
        val label: String,
    ) {
        WEAK("Weak"),
        REUSED("Reused"),
        OLD("Over a year old"),
    }

    data class HealthRow(
        val id: String,
        val name: String,
        val issues: List<Issue>,
        val strength: Int,
    )

    /** Weak, reused and year-old passwords among live, readable logins. */
    fun analyse(
        secrets: List<Secret>,
        nowMs: Long = System.currentTimeMillis(),
    ): List<HealthRow> {
        val live = secrets.filter { !it.trashed && !it.unreadable && !it.fields["password"].isNullOrEmpty() }
        val count = live.groupingBy { it.fields.getValue("password") }.eachCount()
        val yearMs = 365L * 24 * 60 * 60 * 1000
        return live
            .map { s ->
                val pw = s.fields.getValue("password")
                val score = strength(pw)
                val issues = mutableListOf<Issue>()
                if (score <= 1) issues += Issue.WEAK
                if ((count[pw] ?: 0) > 1) issues += Issue.REUSED
                val updated = s.updatedAt.toLong()
                val updatedMs = if (updated > 100_000_000_000_000L) updated / 1_000_000 else updated
                if (updatedMs > 0 && nowMs - updatedMs > yearMs) issues += Issue.OLD
                HealthRow(s.id, s.name, issues, score)
            }.sortedWith(compareByDescending<HealthRow> { it.issues.size }.thenBy { it.strength })
    }
}
