package network.calimero.sheets.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.sheets.app.SheetsAppViewModel
import network.calimero.sheets.core.GridPos
import network.calimero.sheets.core.SheetsFormat
import network.calimero.sheets.core.SheetsInvitation
import network.calimero.sheets.core.SpreadsheetItem
import network.calimero.sheets.core.SpreadsheetModel
import network.calimero.sheets.core.WorkspaceModel
import kotlin.coroutines.cancellation.CancellationException

/** Sheet chrome: title bar with Cancel, a scrolling body, a pinned primary button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SheetScaffold(
    title: String,
    action: String,
    canSubmit: Boolean,
    busy: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    submit: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy })
    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }, sheetState = state, containerColor = Palette.ground) {
        Column(Modifier.imePadding()) {
            Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                TextButton(onClick = onDismiss, enabled = !busy, modifier = Modifier.align(Alignment.CenterStart)) { Text("Cancel", color = Palette.ink) }
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.align(Alignment.Center))
            }
            Column(
                Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(Palette.gutter),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                content()
                ErrorLine(error)
            }
            Box(Modifier.padding(horizontal = Palette.gutter, vertical = 10.dp).navigationBarsPadding()) {
                PrimaryButton(action, submit, enabled = canSubmit, busy = busy)
            }
        }
    }
}

@Composable
fun NameSheet(
    title: String,
    message: String,
    field: String,
    placeholder: String,
    action: String,
    onDismiss: () -> Unit,
    initial: String = "",
    allowsEmpty: Boolean = false,
    url: Boolean = false,
    submit: suspend (String) -> Unit,
) {
    var text by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    SheetScaffold(title, action, allowsEmpty || text.isNotBlank(), busy, error, onDismiss, submit = {
        busy = true
        error = null
        scope.launch {
            try {
                submit(text)
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = SheetsFormat.errorText(e)
            }
            busy = false
        }
    }) {
        Text(message, fontSize = 15.sp, color = Palette.text2)
        LabeledField(field, text, { text = it }, placeholder, if (url) KeyboardType.Uri else KeyboardType.Text)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteSheet(
    workspace: WorkspaceModel,
    spreadsheet: SpreadsheetItem?,
    onShare: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var link by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.ground) {
        Column(Modifier.padding(Palette.gutter).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Box(Modifier.fillMaxWidth()) {
                Text("Invite to workspace", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.align(Alignment.Center))
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Done", color = Palette.ink) }
            }
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(Palette.lime.copy(alpha = 0.4f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PersonAdd, contentDescription = null, tint = Palette.ink)
            }
            Text(
                "Generate an invite link and share it with anyone you want to join this workspace. They get every spreadsheet in it.",
                fontSize = 15.sp,
                color = Palette.text2,
            )
            val current = link
            if (current != null) {
                Text(current, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Palette.text2, maxLines = 4, modifier = Modifier.card(12.dp))
                PrimaryButton("Share invite link", { onShare(current) }, icon = Icons.Outlined.Share)
                SecondaryButton(if (copied) "Copied" else "Copy invite link", {
                    clipboard.setText(AnnotatedString(current))
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    copied = true
                }, icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy)
                Text(
                    spreadsheet?.let { "Whoever opens the link is asked to join this workspace, then lands in ${it.name}." }
                        ?: "Whoever opens the link is asked to join this workspace.",
                    fontSize = 13.sp,
                    color = Palette.text3,
                )
            } else {
                PrimaryButton("Generate invite link", {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            link = workspace.inviteLink(spreadsheet)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = SheetsFormat.errorText(e)
                        }
                        busy = false
                    }
                }, busy = busy)
            }
            ErrorLine(error)
        }
    }
}

/** An invitation link arrived: say which workspace, and join on confirmation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinInvitationSheet(
    link: String,
    vm: SheetsAppViewModel,
) {
    val invitation = remember(link) { SheetsInvitation.parse(link) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy })
    ModalBottomSheet(onDismissRequest = { if (!busy) vm.session.dismissPendingInvitation() }, sheetState = state, containerColor = Palette.ground) {
        Column(
            Modifier.padding(Palette.gutter).navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Box(Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Group, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(28.dp))
            }
            if (invitation != null) {
                Text(
                    "Join ${invitation.workspaceName ?: "this workspace"}?",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.ink,
                    textAlign = TextAlign.Center,
                )
                Text(
                    invitation.spreadsheetName?.let {
                        "You were invited to a workspace on Mero Sheets, to open $it. Joining lets you see and edit its spreadsheets."
                    } ?: "You were invited to a workspace on Mero Sheets. Joining lets you see and edit its spreadsheets.",
                    fontSize = 15.sp,
                    color = Palette.text2,
                    textAlign = TextAlign.Center,
                )
            } else {
                Text("This invitation cannot be read", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                Text("Ask for a new invite link.", fontSize = 15.sp, color = Palette.text2)
            }
            error?.let { Text(it, fontSize = 14.sp, color = Palette.danger, textAlign = TextAlign.Center) }
            if (invitation != null) {
                PrimaryButton(if (busy) "Joining…" else "Join workspace", {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    busy = true
                    error = null
                    scope.launch {
                        try {
                            vm.join(invitation)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = SheetsFormat.errorText(e)
                        }
                        busy = false
                    }
                }, busy = busy)
            }
            SecondaryButton("Not now", { vm.session.dismissPendingInvitation() }, enabled = !busy)
        }
    }
}

/** Change one cell's plain value. Formulas stay on the web; the node computes. */
@Composable
fun EditValueSheet(
    model: SpreadsheetModel,
    pos: GridPos,
    onDismiss: () -> Unit,
) {
    var text by remember { mutableStateOf(model.cellAt(pos)?.raw.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    SheetScaffold("Edit ${pos.label}", "Save", !busy, busy, error, onDismiss, submit = {
        busy = true
        error = null
        scope.launch {
            try {
                model.setValue(text, pos)
                onDismiss()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = SheetsFormat.errorText(e)
            }
            busy = false
        }
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text("Value", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.text2)
            Field(text, { text = it }, "Empty", singleLine = false, mono = true, textSize = 17)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.text3, modifier = Modifier.size(16.dp))
            Text(
                "Type a number, a date or text. Leave it empty to clear the cell. Formulas are written in the web app.",
                fontSize = 13.sp,
                color = Palette.text3,
            )
        }
    }
}
