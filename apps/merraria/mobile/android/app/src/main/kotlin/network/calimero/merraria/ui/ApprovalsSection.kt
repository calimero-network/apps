package network.calimero.merraria.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import network.calimero.merraria.app.ApprovalItem
import network.calimero.merraria.app.ApprovalsModel

/**
 * Decisions that wait for this account (a node release, an app upgrade), each approved on the node's
 * consent page. The confirmation code shows first, so the person can check the page is the one the
 * app asked for. Nothing shows when none wait. (iOS `ApprovalsSection`.)
 */
@Composable
fun ApprovalsSection(model: ApprovalsModel) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    if (state.items.isEmpty() && state.message == null) return

    Card {
        Text("Needs your approval", style = Type.body(13, FontWeight.SemiBold, MerrariaColors.Muted))
        state.items.forEach { item ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(MerrariaColors.LimeSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (item is ApprovalItem.Release) Icons.Outlined.VerifiedUser else Icons.Outlined.ArrowCircleUp,
                        contentDescription = null,
                        tint = MerrariaColors.Ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(item.title, style = Type.body(15, FontWeight.SemiBold))
                    Text(item.detail, style = Type.body(13, color = MerrariaColors.Muted))
                }
                if (state.busy == item.id) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
                } else {
                    TextButton(onClick = { scope.launch { model.approve(item) } }, enabled = state.busy == null) {
                        Text("Review", style = Type.body(14, FontWeight.SemiBold))
                    }
                }
            }
        }
        state.message?.let { Text(it, style = Type.body(13, color = MerrariaColors.Muted)) }
    }

    state.confirmationCode?.let { code ->
        AlertDialog(
            onDismissRequest = { model.answerConfirmation(false) },
            title = { Text("Check the code") },
            text = {
                Text(
                    if (code.isEmpty()) {
                        "Your cluster's approval page opens next. Approve there with your passkey."
                    } else {
                        "The approval page will show the code $code. Continue only if it matches, then approve with your passkey."
                    },
                )
            },
            confirmButton = { TextButton(onClick = { model.answerConfirmation(true) }) { Text("Continue", color = MerrariaColors.Ink) } },
            dismissButton = { TextButton(onClick = { model.answerConfirmation(false) }) { Text("Cancel", color = MerrariaColors.Ink) } },
            containerColor = MerrariaColors.Surface,
        )
    }
}
