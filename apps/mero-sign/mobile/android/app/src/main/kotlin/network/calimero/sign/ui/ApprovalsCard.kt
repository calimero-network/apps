package network.calimero.sign.ui

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.sign.core.ApprovalItem
import network.calimero.sign.core.ApprovalsModel

/**
 * Decisions that wait for this account (a node release, an app upgrade), each approved on the node's
 * consent page after the confirmation code is shown. Nothing shows when none wait. (iOS `ApprovalsCard`.)
 */
@Composable
fun ApprovalsCard(model: ApprovalsModel) {
    val items by model.items.collectAsState()
    val busy by model.busy.collectAsState()
    val message by model.message.collectAsState()
    val code by model.confirmationCode.collectAsState()
    val scope = rememberCoroutineScope()
    if (items.isEmpty() && message == null && code == null) return
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("Needs your approval")
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Surface)) {
            items.forEachIndexed { index, item ->
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(Palette.LimeSoft), contentAlignment = Alignment.Center) {
                        Icon(
                            if (item is ApprovalItem.Release) Icons.Outlined.VerifiedUser else Icons.Outlined.ArrowCircleUp,
                            contentDescription = null,
                            tint = Palette.Ink,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(item.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                        Text(item.detail, fontSize = 13.sp, color = Palette.Muted)
                    }
                    if (busy == item.id) {
                        CircularProgressIndicator(Modifier.size(20.dp), color = Palette.Ink, strokeWidth = 2.dp)
                    } else {
                        SecondaryButton("Review", { if (busy == null) scope.launch { model.approve(item) } }, compact = true)
                    }
                }
                if (index < items.lastIndex) HorizontalDivider(color = Palette.Hairline, modifier = Modifier.padding(start = 66.dp))
            }
            code?.let {
                Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Confirmation code", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted)
                    Text(it, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, color = Palette.Ink)
                    Text("The approval page will show this code. Approve only if it shows the same code.", fontSize = 13.sp, color = Palette.Muted)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PrimaryButton("Open the page", { model.answerCode(true) }, Modifier.weight(1f), compact = true)
                        SecondaryButton("Cancel", { model.answerCode(false) }, Modifier.weight(1f), compact = true)
                    }
                }
            }
            message?.let { Text(it, fontSize = 13.sp, color = Palette.Muted, modifier = Modifier.fillMaxWidth().padding(14.dp)) }
        }
    }
}
