package network.calimero.updates.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Paid
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material.icons.outlined.Work
import androidx.compose.ui.graphics.vector.ImageVector

/** Material icons for the things the web draws with its own (the iOS app's `Symbols`). */
object Glyphs {
    fun askKind(kind: String): ImageVector =
        when (kind) {
            "intro" -> Icons.Outlined.Link
            "hire" -> Icons.Outlined.Work
            "customer" -> Icons.Outlined.ShoppingCart
            "advice" -> Icons.Outlined.Lightbulb
            "fundraising" -> Icons.Outlined.Paid
            else -> Icons.Outlined.AutoAwesome
        }
}
