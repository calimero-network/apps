package network.calimero.pass.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.automirrored.outlined.Notes
import androidx.compose.material.icons.outlined.AddLink
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.VpnKey
import androidx.compose.ui.graphics.vector.ImageVector
import network.calimero.pass.core.SecretKind

/**
 * The icon for each kind of item, the Material twin of iOS `KindIcon` (SF Symbols):
 * person.badge.key → Person, note.text → Notes, clock.badge.checkmark → Timer,
 * terminal → Terminal, creditcard → CreditCard, person.text.rectangle → Badge,
 * key.horizontal → VpnKey, link.badge.plus → AddLink.
 */
object KindIcon {
    fun of(kind: String): ImageVector =
        when (SecretKind.of(kind)) {
            SecretKind.LOGIN -> Icons.Outlined.Person
            SecretKind.SECURE_NOTE -> Icons.AutoMirrored.Outlined.Notes
            SecretKind.TOTP -> Icons.Outlined.Timer
            SecretKind.SSH_KEY -> Icons.Outlined.Terminal
            SecretKind.PAYMENT_CARD -> Icons.Outlined.CreditCard
            SecretKind.IDENTITY -> Icons.Outlined.Badge
            SecretKind.API_KEY -> Icons.Outlined.VpnKey
            SecretKind.OAUTH2 -> Icons.Outlined.AddLink
            null -> Icons.Outlined.Key
        }

    val tag: ImageVector get() = Icons.AutoMirrored.Outlined.Label

    /** iOS: doc.text (recovery), cpu (agent), iphone. */
    fun device(kind: String): ImageVector =
        when (kind) {
            "recovery" -> Icons.Outlined.Description
            "agent" -> Icons.Outlined.Memory
            else -> Icons.Outlined.PhoneAndroid
        }
}
