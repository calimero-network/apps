package network.calimero.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Dark ink on lime: every primary action. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    busy: Boolean = false,
    icon: ImageVector? = null,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !busy,
        modifier = modifier.height(50.dp),
        shape = RoundedCornerShape(Tokens.fieldRadius),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Tokens.lime,
                contentColor = Tokens.ink,
                disabledContainerColor = Tokens.lime.copy(alpha = 0.45f),
                disabledContentColor = Tokens.ink.copy(alpha = 0.5f),
            ),
        contentPadding = PaddingValues(horizontal = 20.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(16.dp), color = Tokens.ink, strokeWidth = 2.dp)
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = 16.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold)
    }
}

/** White with a hairline: the secondary action. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(50.dp),
        shape = RoundedCornerShape(Tokens.fieldRadius),
        border = BorderStroke(Tokens.hairline, Tokens.line),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = Tokens.surface, contentColor = Tokens.ink),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = 16.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)
    }
}

/** A white card with a hairline border. */
@Composable
fun Card(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Tokens.cardRadius))
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        shape = RoundedCornerShape(Tokens.cardRadius),
        color = Tokens.surface,
        border = BorderStroke(Tokens.hairline, Tokens.line),
    ) { content() }
}

/** The app mark: a calendar on a lime tile. */
@Composable
fun IconTile(
    icon: ImageVector = Icons.Filled.CalendarMonth,
    size: Dp = 40.dp,
) {
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(Tokens.lime),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Tokens.ink, modifier = Modifier.size(size * 0.5f))
    }
}

@Composable
fun TextInput(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    singleLine: Boolean = true,
    minLines: Int = 1,
    readOnly: Boolean = false,
) {
    Column(modifier) {
        if (label != null) {
            Text(label, style = Tokens.label)
            Spacer(Modifier.height(6.dp))
        }
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(placeholder, color = Tokens.faint) },
            singleLine = singleLine,
            minLines = minLines,
            readOnly = readOnly,
            shape = RoundedCornerShape(Tokens.fieldRadius),
            modifier = Modifier.fillMaxWidth(),
            colors =
                OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Tokens.ink,
                    unfocusedBorderColor = Tokens.line,
                    focusedContainerColor = Tokens.surface,
                    unfocusedContainerColor = Tokens.surface,
                    cursorColor = Tokens.ink,
                ),
        )
    }
}

@Composable
fun Loading(text: String? = null) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Tokens.ink, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
        if (text != null) {
            Spacer(Modifier.height(12.dp))
            Text(text, style = Tokens.caption)
        }
    }
}

/** An empty state: an icon, a title, a line of text, and actions. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    body: String,
    actions: @Composable () -> Unit = {},
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(Tokens.sunken),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(26.dp)) }
        Text(title, style = Tokens.heading, textAlign = TextAlign.Center)
        Text(body, style = Tokens.caption, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        actions()
    }
}

/** An error line with a retry. */
@Composable
fun ErrorBanner(
    text: String,
    onRetry: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tokens.fieldRadius))
            .background(Tokens.danger.copy(alpha = 0.08f))
            .border(Tokens.hairline, Tokens.danger.copy(alpha = 0.25f), RoundedCornerShape(Tokens.fieldRadius))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = Tokens.caption.copy(color = Tokens.danger), modifier = Modifier.weight(1f))
        if (onRetry != null) {
            Text(
                "Try again",
                style = Tokens.caption.copy(color = Tokens.ink, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                modifier =
                    Modifier
                        .clickable(onClick = onRetry)
                        .padding(start = 12.dp),
            )
        }
    }
}

/** Technical details (ids) behind a disclosure. */
@Composable
fun DetailsDisclosure(rows: List<Pair<String, String>>) {
    var open by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Tokens.fieldRadius))
                .clickable { open = !open }
                .padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Info, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(6.dp))
            Text("Details", style = Tokens.caption, modifier = Modifier.weight(1f))
            Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = null, tint = Tokens.muted)
        }
        if (open) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Tokens.fieldRadius))
                    .background(Tokens.sunken)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                rows.forEach { (label, value) ->
                    Text(label.uppercase(), style = Tokens.label)
                    Text(value, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Tokens.ink)
                }
            }
        }
    }
}

/** A member's avatar: their initial on a lime tint. */
@Composable
fun Avatar(
    name: String,
    size: Dp = 36.dp,
) {
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(Tokens.lime.copy(alpha = 0.35f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().firstOrNull()?.uppercase() ?: "?",
            color = Tokens.ink,
            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
            fontSize = (size.value * 0.42f).sp,
            maxLines = 1,
            overflow = TextOverflow.Clip,
        )
    }
}
