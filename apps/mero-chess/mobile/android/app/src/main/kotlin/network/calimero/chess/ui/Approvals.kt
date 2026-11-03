package network.calimero.chess.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.chess.app.ApprovalsModel

/**
 * What waits for the person's approval (an update of Mero Chess, a node release): "Review" shows
 * the confirmation code, then opens the node's consent page in a Custom Tab. Nothing shows when
 * there is nothing to approve. (iOS `ApprovalsCard`.)
 */
@Composable
fun ApprovalsCard(model: ApprovalsModel) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    if (state.items.isEmpty() && state.error == null) return
    Column(Modifier.testTag("approvals.card"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        state.error?.let { ErrorBanner(it, model::dismissError) }
        state.items.forEach { item ->
            Card(padding = 14.dp) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                    Box(
                        Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(ChessColors.LimeSoft),
                        contentAlignment = Alignment.Center,
                    ) {
                        val icon = if (item.kind is ApprovalsModel.Item.Kind.Upgrade) Icons.Outlined.ArrowCircleUp else Icons.Outlined.VerifiedUser
                        Icon(icon, contentDescription = null, tint = ChessColors.Ink, modifier = Modifier.size(20.dp))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(item.title, style = Type.body(15, FontWeight.SemiBold))
                        Text(item.detail, style = Type.body(13, color = ChessColors.Muted))
                    }
                    SecondaryButton(
                        onClick = { scope.launch { model.approve(item) } },
                        enabled = state.approving == null,
                        fullWidth = false,
                    ) {
                        if (state.approving == item.id) {
                            CircularProgressIndicator(Modifier.size(16.dp), color = ChessColors.Ink, strokeWidth = 2.dp)
                        } else {
                            ButtonLabel("Review")
                        }
                    }
                }
            }
        }
    }
}

/**
 * Before the node's consent page opens: the confirmation code it will show too, so the person can
 * check the page is the request the app made. "Continue" opens the page. (iOS `ConsentCodeSheet`.)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConsentCodeSheet(model: ApprovalsModel) {
    val state by model.state.collectAsState()
    val confirmation = state.confirmation ?: return
    ModalBottomSheet(
        onDismissRequest = { model.answer(false) },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = ChessColors.Ground,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Box(
                Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(ChessColors.LimeSoft),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = ChessColors.Ink)
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Check the code", style = Type.heading(22))
                Text(confirmation.title, style = Type.body(15, FontWeight.SemiBold, ChessColors.Ink2))
            }
            val code = confirmation.code
            if (code != null) {
                Text(
                    code,
                    style = Type.body(32, FontWeight.SemiBold).copy(fontFamily = FontFamily.Monospace, fontSize = 32.sp),
                    textAlign = TextAlign.Center,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(ButtonShape)
                            .background(ChessColors.Surface)
                            .border(Hairline, ChessColors.Line, ButtonShape)
                            .padding(vertical = 16.dp)
                            .testTag("consent.code"),
                )
                Text(
                    "Your node's approval page opens next and shows this same code. Approve only if they match.",
                    style = Type.body(14, color = ChessColors.Muted),
                )
            } else {
                Text(
                    "Your node's approval page opens next. Approve there with your passkey.",
                    style = Type.body(14, color = ChessColors.Muted),
                )
            }
            PrimaryButton(onClick = { model.answer(true) }, modifier = Modifier.testTag("consent.continue")) {
                ButtonLabel("Continue")
            }
            SecondaryButton(onClick = { model.answer(false) }) { ButtonLabel("Cancel") }
        }
    }
}
