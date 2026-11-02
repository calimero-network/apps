package network.calimero.chat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import network.calimero.chat.app.ApprovalsModel

/**
 * What waits for the person's approval (an update of Mero Chat, a node release). "Review" first
 * shows the request's confirmation code, then opens the node's consent page in a Custom Tab, which
 * shows the same code. Nothing shows when there is nothing to approve. (Swift `ApprovalsCard`.)
 */
@Composable
fun ApprovalsCard(
    model: ApprovalsModel,
    orgs: List<String>,
) {
    val items by model.items.collectAsStateWithLifecycle()
    val approving by model.approving.collectAsStateWithLifecycle()
    val error by model.error.collectAsStateWithLifecycle()
    val code by model.code.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    if (items.isNotEmpty() || error != null) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Approvals", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            items.forEach { item ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (item.id.startsWith("release")) Icons.Outlined.CheckCircle else Icons.Outlined.Refresh,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(22.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(item.title, style = MaterialTheme.typography.titleSmall)
                            Text(item.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (approving == item.id) {
                            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                        } else {
                            TextButton(onClick = { scope.launch { model.approve(item, orgs) } }, enabled = approving == null) { Text("Review") }
                        }
                    }
                }
            }
        }
    }

    code?.let { shown ->
        AlertDialog(
            onDismissRequest = model::cancelCode,
            icon = { Icon(Icons.Outlined.CheckCircle, contentDescription = null) },
            title = { Text("Check this code") },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        shown,
                        style = MaterialTheme.typography.headlineMedium.copy(fontFamily = FontFamily.Monospace, letterSpacing = 1.sp),
                        modifier = Modifier.testTag("confirmationCode"),
                    )
                    Text(
                        "Your node's approval page opens next and shows a code. Approve only if it is this one.",
                        textAlign = TextAlign.Center,
                    )
                }
            },
            confirmButton = { TextButton(onClick = model::continueToPage) { Text("Open the approval page") } },
            dismissButton = { TextButton(onClick = model::cancelCode) { Text("Cancel") } },
        )
    }
}
