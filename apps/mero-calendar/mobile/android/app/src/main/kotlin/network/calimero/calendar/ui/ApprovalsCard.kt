package network.calimero.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowCircleUp
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import network.calimero.calendar.app.ApprovalItem
import network.calimero.calendar.app.ApprovalsModel

/**
 * What waits for the person's approval (an update of Mero Calendar, a node release): "Review"
 * shows the confirmation code first, then opens the node's consent page in a Custom Tab, where the
 * same code shows. Nothing shows when there is nothing to approve. (iOS `ApprovalsCard`.)
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
        state.error?.let { ErrorBanner(it) { scope.launch { model.load(orgs) } } }
        state.items.forEach { item ->
            Card {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                    IconTile(icon = icon(item), size = 36.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.title, style = Tokens.heading.copy(fontSize = Tokens.body.fontSize))
                        Text(item.detail, style = Tokens.caption)
                    }
                    Spacer(Modifier.width(8.dp))
                    SecondaryButton(
                        if (state.approving == item.id) "Opening…" else "Review",
                        onClick = { if (state.approving == null) scope.launch { model.approve(item) } },
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
            confirmButton = {
                TextButton(onClick = { model.answerConfirmation(true) }) { Text("Open approval page", color = Tokens.ink) }
            },
            dismissButton = {
                TextButton(onClick = { model.answerConfirmation(false) }) { Text("Cancel", color = Tokens.muted) }
            },
            containerColor = Tokens.surface,
        )
    }
}

private fun icon(item: ApprovalItem) =
    when (item.kind) {
        is ApprovalItem.Kind.Upgrade -> Icons.Filled.ArrowCircleUp
        is ApprovalItem.Kind.Release -> Icons.Filled.VerifiedUser
    }
