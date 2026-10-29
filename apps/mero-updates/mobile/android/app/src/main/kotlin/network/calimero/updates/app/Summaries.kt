package network.calimero.updates.app

import kotlinx.serialization.Serializable

/** A company: one namespace founded for this app. Its audiences are subgroups. */
data class CompanySummary(
    val id: String,
    val name: String,
    val memberCount: Int = 0,
) {
    /** The name, else "Company 1a2b3c" as the web shows an unnamed one. */
    val title: String get() = name.trim().ifEmpty { "Company ${id.take(6)}" }
}

/** An audience: a subgroup of a company and the one context in it, which is where the updates live. */
@Serializable
data class AudienceSummary(
    val companyId: String,
    val audienceId: String,
    /** Null while the audience's context has not reached the relay yet. */
    val contextId: String?,
    val name: String,
    val companyName: String,
) {
    val id: String get() = audienceId
    val title: String get() = name.trim().ifEmpty { "Audience ${audienceId.take(6)}" }
}

/** Where a redeemed invitation lands: one audience, or a company's audience list. */
sealed interface InvitationLanding {
    data class Audience(
        val audience: AudienceSummary,
    ) : InvitationLanding

    data class Company(
        val company: CompanySummary,
    ) : InvitationLanding
}

/** A company on the navigation stack, and whether it was just joined (its audiences may not have synced yet). */
data class CompanyRoute(
    val company: CompanySummary,
    val justJoined: Boolean = false,
)
