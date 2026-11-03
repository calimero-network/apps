package network.calimero.standup.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.standup.app.ApprovalItem
import network.calimero.standup.app.ApprovalsModel

/**
 * What waits for the person's approval (an update of Mero Standup, a node release): "Review" shows
 * the confirmation code first, then opens the node's consent page in a Custom Tab, where the same
 * code shows. Nothing shows when there is nothing to approve. (iOS `ApprovalsCard`.)
 */
@Composable
fun ApprovalsCard(
    model: ApprovalsModel,
    orgs: List<String>,
) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    if (state.items.isEmpty() && state.error == null) return
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        state.error?.let {
            StandupCard {
                ErrorLine(it)
                LinkButton("Try again", onClick = { scope.launch { model.load(orgs) } })
            }
        }
        state.items.forEach { item ->
            StandupCard(padding = 14.dp) {
                Row(verticalAlignment = Alignment.Top) {
                    Box(
                        Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)).background(Palette.lime.copy(alpha = 0.35f)),
                        contentAlignment = Alignment.Center,
                    ) { Icon(icon(item), contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp)) }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                        Text(item.detail, fontSize = 13.sp, color = Palette.ink2)
                    }
                    Spacer(Modifier.width(8.dp))
                    PrimaryButton(
                        "Review",
                        busy = state.approving == item.id,
                        enabled = state.approving == null,
                        onClick = { scope.launch { model.approve(item) } },
                    )
                }
            }
        }
    }
    state.confirmationCode?.let { code ->
        AlertDialog(
            onDismissRequest = { model.answerConfirmation(false) },
            title = { Text("Check the code") },
            text = { Text("The approval page will show $code. Approve only if it shows the same code.") },
            confirmButton = { PrimaryButton("Open approval page", onClick = { model.answerConfirmation(true) }) },
            dismissButton = { LinkButton("Cancel", onClick = { model.answerConfirmation(false) }) },
            containerColor = Palette.surface,
        )
    }
}

private fun icon(item: ApprovalItem) =
    when (item.kind) {
        is ApprovalItem.Kind.Upgrade -> Icons.Outlined.ArrowCircleUp
        is ApprovalItem.Kind.Release -> Icons.Outlined.VerifiedUser
    }
