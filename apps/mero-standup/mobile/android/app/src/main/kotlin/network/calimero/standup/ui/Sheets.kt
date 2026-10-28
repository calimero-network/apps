package network.calimero.standup.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A create/edit sheet: title, scrollable content, keyboard-safe. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StandupSheet(
    title: String,
    onDismiss: () -> Unit,
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
                .padding(horizontal = 16.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

/** A labelled text field on white, with the contract's limit. */
@Composable
fun LabeledField(
    label: String?,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    maxLength: Int,
    modifier: Modifier = Modifier,
    singleLine: Boolean = false,
    minLines: Int = 1,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(it.take(maxLength)) },
            placeholder = { Text(placeholder, color = Palette.ink3) },
            singleLine = singleLine,
            minLines = minLines,
            shape = RoundedCornerShape(10.dp),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            colors =
                OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Palette.surface,
                    unfocusedContainerColor = Palette.surface,
                    focusedBorderColor = Palette.ink,
                    unfocusedBorderColor = Palette.hairline,
                    cursorColor = Palette.ink,
                ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
