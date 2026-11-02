package network.calimero.stream.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.stream.app.ApprovalItem
import network.calimero.stream.app.ConsentConfirmation

/**
 * Decisions that wait for this account (a node release, an app upgrade), each approved on the
 * node's consent page. Nothing shows when none wait. (Identical to the iOS `ApprovalsSection`.)
 */
fun LazyListScope.approvalsSection(
    items: List<ApprovalItem>,
    busy: String?,
    message: String?,
    onReview: (ApprovalItem) -> Unit,
) {
    if (items.isEmpty() && message == null) return
    item { SectionLabel("Needs your approval") }
    items(items, key = { it.id }) { item ->
        Card {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                RowIcon(if (item is ApprovalItem.Release) Icons.Outlined.VerifiedUser else Icons.Outlined.ArrowCircleUp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(item.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                    Text(item.detail, fontSize = 13.sp, color = Palette.Muted)
                }
                if (busy == item.id) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = Palette.Ink, strokeWidth = 2.dp)
                } else {
                    SecondaryButton("Review", onClick = { if (busy == null) onReview(item) }, compact = true)
                }
            }
        }
    }
    message?.let { item { Text(it, fontSize = 13.sp, color = Palette.Muted) } }
}

/**
 * The consent request's confirmation code, shown before the node's consent page opens: the page
 * shows the same code, so the person can check it is the request this app made.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsentCodeSheet(
    confirmation: ConsentConfirmation,
    onAnswer: (Boolean) -> Unit,
) {
    val tap = rememberTap()
    ModalBottomSheet(
        onDismissRequest = { onAnswer(false) },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.Surface,
    ) {
        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            RowIcon(Icons.Outlined.VerifiedUser)
            Text("Check the code", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Palette.Ink)
            Text(
                "${confirmation.title}. Your cluster's approval page opens next and shows this code. Approve only if they match.",
                fontSize = 16.sp,
                color = Palette.InkSoft,
            )
            Text(
                confirmation.code,
                fontSize = 34.sp,
                fontWeight = FontWeight.SemiBold,
                fontFamily = FontFamily.Monospace,
                color = Palette.Ink,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Palette.Sunken)
                        .padding(vertical = 18.dp),
            )
            PrimaryButton("Open the approval page", icon = Icons.AutoMirrored.Outlined.OpenInNew, onClick = {
                tap()
                onAnswer(true)
            })
            SecondaryButton("Not now", onClick = { onAnswer(false) })
        }
    }
}
