package network.calimero.models.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import network.calimero.models.core.ApprovalItem
import network.calimero.models.core.ApprovalsModel

/**
 * Decisions that wait for this account (a node release, an app upgrade), each approved on the
 * node's consent page. Nothing shows when none wait. "Review" first shows the request's
 * confirmation code ([ApprovalCodeDialog]), which the page shows too, then opens the page in a
 * Custom Tab. (Swift `ApprovalsSection`.)
 */
fun LazyListScope.approvalsSection(
    model: ApprovalsModel,
    scope: CoroutineScope,
) {
    item(key = "approvals") {
        val items by model.items.collectAsState()
        val busy by model.busy.collectAsState()
        val message by model.message.collectAsState()
        if (items.isEmpty() && message == null) return@item
        Column {
            SectionLabel("Needs your approval")
            items.forEach { item -> ApprovalRow(item, busy) { scope.launch { model.approve(item) } } }
            message?.let { Text(it, style = ModelsTheme.body(13, color = ModelsTheme.muted), modifier = Modifier.padding(vertical = 6.dp)) }
        }
    }
}

@Composable
private fun ApprovalRow(
    item: ApprovalItem,
    busy: String?,
    onReview: () -> Unit,
) {
    Row(Modifier.padding(vertical = 6.dp).fillMaxWidth().card(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).background(ModelsTheme.lime, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(
                if (item is ApprovalItem.Release) Icons.Outlined.VerifiedUser else Icons.Outlined.ArrowCircleUp,
                contentDescription = null,
                tint = ModelsTheme.ink,
                modifier = Modifier.size(18.dp),
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.title, style = ModelsTheme.body(15, FontWeight.Medium))
            Text(item.detail, style = ModelsTheme.body(13, color = ModelsTheme.muted))
        }
        Spacer(Modifier.width(8.dp))
        if (busy == item.id) {
            CircularProgressIndicator(color = ModelsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
            TextButton(onClick = onReview, enabled = busy == null) {
                Text("Review", style = ModelsTheme.body(14, FontWeight.SemiBold))
            }
        }
    }
}

/** The request's confirmation code, before the consent page opens. The page shows the same code. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalCodeDialog(model: ApprovalsModel) {
    val code by model.code.collectAsState()
    val shown = code ?: return
    ModalBottomSheet(onDismissRequest = model::cancelCode, containerColor = ModelsTheme.ground) {
        Column(
            Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(60.dp).background(ModelsTheme.lime, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(26.dp))
            }
            Text("Check this code", style = ModelsTheme.heading(20))
            Text(
                shown,
                style = ModelsTheme.body(34, FontWeight.SemiBold).copy(fontFamily = FontFamily.Monospace, letterSpacing = 1.sp),
                modifier = Modifier.testTag("confirmationCode"),
            )
            Text(
                "Your node's approval page opens next and shows a code. Approve only if it is this one.",
                style = ModelsTheme.body(15, color = ModelsTheme.muted),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(8.dp))
            PrimaryButton(onClick = model::continueToPage) {
                Text("Open the approval page", style = ModelsTheme.body(16, FontWeight.SemiBold, ModelsTheme.ink))
            }
            SecondaryButton(onClick = model::cancelCode) { Text("Cancel") }
        }
    }
}
