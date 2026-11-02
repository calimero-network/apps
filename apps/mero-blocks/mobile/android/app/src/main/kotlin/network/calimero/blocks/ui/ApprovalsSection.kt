package network.calimero.blocks.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.blocks.app.ApprovalItem
import network.calimero.blocks.app.ConsentConfirmation

/**
 * Decisions that wait for this account (a node release, an app upgrade), each approved on the
 * node's consent page. Nothing shows when none wait. (iOS `ApprovalsSection`.)
 */
fun LazyListScope.approvalsSection(
    items: List<ApprovalItem>,
    busy: String?,
    message: String?,
    onReview: (ApprovalItem) -> Unit,
) {
    if (items.isEmpty() && message == null) return
    item { Text("Needs your approval", style = Type.body(13, FontWeight.SemiBold, BlocksColors.Muted)) }
    items(items, key = { it.id }) { item ->
        Card(padding = 14.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Badge(if (item is ApprovalItem.Release) Icons.Outlined.VerifiedUser else Icons.Outlined.ArrowCircleUp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(item.title, style = Type.body(15, FontWeight.SemiBold))
                    Text(item.detail, style = Type.body(13, color = BlocksColors.Muted))
                }
                if (busy == item.id) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
                } else {
                    TextButton(onClick = { onReview(item) }, enabled = busy == null) {
                        Text("Review", style = Type.body(14, FontWeight.SemiBold))
                    }
                }
            }
        }
    }
    message?.let { item { Text(it, style = Type.body(13, color = BlocksColors.Muted)) } }
}

@Composable
private fun Badge(icon: ImageVector) {
    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(BlocksColors.LimeSoft), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(20.dp))
    }
}

/**
 * The consent request's confirmation code, shown before the node's consent page opens: the page
 * shows the same code, so the person can check it is the request this app made. (iOS `ConsentCodeSheet`.)
 */
@Composable
fun ConsentCodeSheet(
    confirmation: ConsentConfirmation,
    onAnswer: (Boolean) -> Unit,
) {
    BlocksSheet("Check the code", onDismiss = { onAnswer(false) }) {
        Badge(Icons.Outlined.VerifiedUser)
        Text(
            "${confirmation.title}. Your cluster's approval page opens next and shows this code. Approve only if they match.",
            style = Type.body(15, color = BlocksColors.Ink2),
        )
        Text(
            confirmation.code,
            fontSize = 34.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = BlocksColors.Ink,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(BlocksColors.Sunken)
                    .padding(vertical = 18.dp),
        )
        PrimaryButton(onClick = { onAnswer(true) }) {
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
            ButtonLabel("Open the approval page")
        }
        SecondaryButton(onClick = { onAnswer(false) }) { ButtonLabel("Not now") }
    }
}
