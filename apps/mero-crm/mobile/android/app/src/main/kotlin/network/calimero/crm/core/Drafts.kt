package network.calimero.crm.core

import network.calimero.crm.generated.ContactView
import network.calimero.crm.generated.DealView
import java.time.LocalDate
import java.time.ZoneId

/** What the deal sheets edit. Value is kept as typed (`12k`) and parsed on save. */
data class DealDraft(
    val title: String = "",
    val value: String = "",
    val organization: String = "",
    /** The linked person, or null for none. */
    val contactId: String? = null,
    /** A person to create with the deal (New deal only): name and email. */
    val creatingContact: Boolean = false,
    val newContactName: String = "",
    val newContactEmail: String = "",
    val stageId: String = "",
    /** The owner as stored (an account), or null for unassigned. */
    val owner: String? = null,
    /** The expected close day, or null for none. */
    val expectedClose: LocalDate? = null,
    val source: String = "",
) {
    val parsedValue: ULong? get() = Money.parse(value)

    val isValid: Boolean
        get() =
            title.isNotBlank() &&
                parsedValue != null &&
                stageId.isNotEmpty() &&
                (!creatingContact || newContactName.isNotBlank())

    /** The close date as the contract keeps it: the picked day at local noon. */
    fun closeMs(zone: ZoneId): ULong? = expectedClose?.let { Days.noon(it, zone) }

    companion object {
        /** The fields of an existing deal. */
        fun of(
            deal: DealView,
            zone: ZoneId,
        ): DealDraft =
            DealDraft(
                title = deal.title,
                value = deal.value.toString(),
                organization = deal.organization,
                contactId = deal.contactId,
                stageId = deal.stageId,
                owner = deal.owner?.ifEmpty { null },
                expectedClose = deal.expectedClose?.let { Days.localDate(it, zone) },
                source = deal.source,
            )
    }
}

/** What the person sheet edits. */
data class ContactDraft(
    val name: String = "",
    val organization: String = "",
    val jobTitle: String = "",
    val email: String = "",
    val phone: String = "",
) {
    val isValid: Boolean get() = name.isNotBlank()

    companion object {
        fun of(c: ContactView): ContactDraft = ContactDraft(c.name, c.organization, c.jobTitle, c.email, c.phone)
    }
}

/** What the schedule sheet edits. */
data class ActivityDraft(
    val kind: ActivityKind = ActivityKind.CALL,
    val subject: String = "",
    /** Due, in milliseconds. */
    val due: ULong,
    val dealId: String? = null,
    val note: String = "",
) {
    val isValid: Boolean get() = subject.isNotBlank()
}

/** The one-tap lost reasons (the web's `LostReasonModal`), which keep the report countable. */
object LostReasons {
    val common = listOf("Price", "Chose a competitor", "No budget", "No decision", "Timing", "Bad fit", "Went dark")
}
