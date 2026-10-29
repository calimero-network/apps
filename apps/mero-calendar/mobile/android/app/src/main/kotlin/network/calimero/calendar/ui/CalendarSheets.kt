package network.calimero.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.calendar.data.CalMember
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.shortId

/** Everyone who set a name in this calendar (`get_members`). */
@Composable
fun MembersSheet(
    members: List<CalMember>,
    account: String,
    onDismiss: () -> Unit,
) {
    AppSheet("Members", onDismiss) {
        if (members.isEmpty()) {
            Text("No one has set a name yet.", style = Tokens.caption)
        } else {
            Card {
                Column {
                    members.forEachIndexed { i, m ->
                        if (i > 0) HorizontalDivider(color = Tokens.line)
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.name.ifEmpty { m.id })
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(m.name.ifEmpty { shortId(m.id) }, style = Tokens.body.copy(fontWeight = FontWeight.Medium))
                                Text(shortId(m.id), style = Tokens.caption.copy(fontSize = 12.sp))
                            }
                            if (m.id.equals(account, ignoreCase = true)) {
                                Text(
                                    "You",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Tokens.ink,
                                    modifier =
                                        Modifier
                                            .clip(RoundedCornerShape(999.dp))
                                            .background(Tokens.lime)
                                            .padding(horizontal = 10.dp, vertical = 3.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "Your name": what teammates see on your events. */
@Composable
fun NameSheet(
    initial: String,
    onSave: suspend (String) -> Unit,
    onSkip: () -> Unit,
) {
    var name by remember { mutableStateOf(initial) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    AppSheet("Your name", onDismiss = onSkip) {
        Text("What should your teammates call you?", style = Tokens.caption)
        TextInput(name, { name = it }, "e.g. Alice")
        error?.let { Text(it, style = Tokens.caption.copy(color = Tokens.danger)) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryButton("Skip", onClick = onSkip, modifier = Modifier.weight(1f))
            PrimaryButton(
                "Save",
                enabled = name.isNotBlank(),
                busy = busy,
                modifier = Modifier.weight(1f),
                onClick = {
                    busy = true
                    scope.launch {
                        try {
                            onSave(name)
                        } catch (e: Exception) {
                            error = ErrorText.of(e, "save your name")
                        }
                        busy = false
                    }
                },
            )
        }
    }
}

/** Ids, shown as label + monospace value. */
@Composable
fun DetailsRows(rows: List<Pair<String, String>>) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Tokens.fieldRadius))
            .background(Tokens.sunken)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        rows.forEach { (label, value) ->
            Text(label.uppercase(), style = Tokens.label)
            Text(value, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Tokens.ink)
        }
    }
}
