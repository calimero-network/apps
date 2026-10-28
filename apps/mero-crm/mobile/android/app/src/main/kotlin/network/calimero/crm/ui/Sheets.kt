package network.calimero.crm.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import network.calimero.crm.app.Notice

/**
 * The body every create/edit sheet shares: a title row with Cancel, scrolling fields, and the
 * primary action at the bottom. Keyboard-safe.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CrmSheet(
    title: String,
    onDismiss: () -> Unit,
    action: String? = null,
    busy: Boolean = false,
    enabled: Boolean = true,
    error: String? = null,
    onAction: () -> Unit = {},
    cancelLabel: String = "Cancel",
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.background,
        dragHandle = null,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .imePadding()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.fillMaxWidth()) {
                LinkButton(cancelLabel, onClick = onDismiss, modifier = Modifier.align(Alignment.CenterStart))
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.Center))
            }
            content()
            ErrorLine(error)
            if (action != null) PrimaryButton(if (busy) "Saving…" else action, onClick = onAction, enabled = enabled, busy = busy)
        }
    }
}

/** A label above a single-line (or growing) field, for the sheets. */
@Composable
fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    singleLine: Boolean = true,
    minLines: Int = 1,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
        TextBox(value, onChange, placeholder, keyboard = keyboard, capitalization = capitalization, singleLine = singleLine, minLines = minLines)
    }
}

/** A white text field with a hairline border. */
@Composable
fun TextBox(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    singleLine: Boolean = true,
    minLines: Int = 1,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(placeholder, color = Palette.ink3) },
        singleLine = singleLine,
        minLines = minLines,
        shape = RoundedCornerShape(10.dp),
        keyboardOptions = KeyboardOptions(capitalization = capitalization, keyboardType = keyboard),
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Palette.surface,
                unfocusedContainerColor = Palette.surface,
                focusedBorderColor = Palette.ink,
                unfocusedBorderColor = Palette.hairline,
                cursorColor = Palette.ink,
            ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** One choice in a [PickerField]. */
data class Choice(
    val label: String,
    val onPick: () -> Unit,
)

/** A labelled row that opens a menu of choices. */
@Composable
fun PickerField(
    label: String,
    value: String,
    choices: List<Choice>,
) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
        Box {
            Surface(
                onClick = { open = true },
                shape = RoundedCornerShape(10.dp),
                color = Palette.surface,
                border = BorderStroke(1.dp, Palette.hairline),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(value, fontSize = 16.sp, maxLines = 1, modifier = Modifier.weight(1f))
                    Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Palette.ink3, modifier = Modifier.size(18.dp))
                }
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                for (c in choices) {
                    DropdownMenuItem(text = { Text(c.label) }, onClick = {
                        open = false
                        c.onPick()
                    })
                }
            }
        }
    }
}

/** The toast a pipeline's notice shows, at the top, for a couple of seconds. */
@Composable
fun BoxScope.NoticeToast(
    notice: Notice?,
    onDone: () -> Unit,
) {
    LaunchedEffect(notice?.id) {
        if (notice != null) {
            delay(if (notice.isError) 4_000 else 2_200)
            onDone()
        }
    }
    AnimatedVisibility(
        visible = notice != null,
        enter = slideInVertically { -it } + fadeIn(),
        exit = slideOutVertically { -it } + fadeOut(),
        modifier = Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 8.dp, start = 20.dp, end = 20.dp),
    ) {
        val shown = notice ?: return@AnimatedVisibility
        Surface(
            onClick = onDone,
            shape = RoundedCornerShape(999.dp),
            color = Palette.surface,
            border = BorderStroke(1.dp, Palette.hairline),
            shadowElevation = 6.dp,
        ) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (shown.isError) Icons.Filled.Error else Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = if (shown.isError) Palette.danger else Palette.good,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(shown.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 3)
            }
        }
    }
}
