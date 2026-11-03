package network.calimero.pixart.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import network.calimero.pixart.core.ApprovalItem
import network.calimero.pixart.core.ApprovalsModel

/**
 * Decisions that wait for this account (a node release, an app upgrade), each approved on the
 * node's consent page. Nothing shows when none wait. (Swift `ApprovalsSection`.)
 */
fun LazyListScope.approvalsSection(model: ApprovalsModel) {
    item(key = "approvals") { ApprovalsBlock(model) }
}

@Composable
private fun ApprovalsBlock(model: ApprovalsModel) {
    val items by model.items.collectAsState()
    val busy by model.busy.collectAsState()
    val message by model.message.collectAsState()
    val scope = rememberCoroutineScope()
    if (items.isEmpty() && message == null) return
    Column {
        SectionLabel("Needs your approval")
        items.forEach { item ->
            Row(Modifier.padding(vertical = 6.dp).fillMaxWidth().card(14.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(36.dp).background(PixartTheme.lime, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                    Icon(
                        if (item is ApprovalItem.Release) Icons.Outlined.VerifiedUser else Icons.Outlined.ArrowCircleUp,
                        contentDescription = null,
                        tint = PixartTheme.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(item.title, style = PixartTheme.body(15, FontWeight.Medium))
                    Text(item.detail, style = PixartTheme.body(13, color = PixartTheme.muted))
                }
                Spacer(Modifier.width(8.dp))
                if (busy == item.id) {
                    CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
                } else {
                    TextButton(onClick = { scope.launch { model.approve(item) } }, enabled = busy == null) {
                        Text("Review", style = PixartTheme.body(14, FontWeight.SemiBold))
                    }
                }
            }
        }
        message?.let { Text(it, style = PixartTheme.body(13, color = PixartTheme.muted), modifier = Modifier.padding(vertical = 4.dp)) }
    }
}

/** The request's confirmation code, shown before the consent page opens; the page shows the same one. */
@Composable
fun ApprovalCodeDialog(model: ApprovalsModel) {
    val code by model.confirmationCode.collectAsState()
    val current = code ?: return
    AlertDialog(
        onDismissRequest = { model.answerCode(false) },
        title = { Text("Check the code") },
        text = { Text("Your node’s approval page will show the code $current. Continue only if it matches.") },
        confirmButton = { TextButton(onClick = { model.answerCode(true) }) { Text("Continue", fontWeight = FontWeight.SemiBold) } },
        dismissButton = { TextButton(onClick = { model.answerCode(false) }) { Text("Cancel") } },
    )
}
