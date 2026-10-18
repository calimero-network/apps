package network.calimero.chat.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
fun MeroChatTheme(content: @Composable () -> Unit) {
    val scheme =
        if (isSystemInDarkTheme()) {
            darkColorScheme(primary = Color(0xFFA5FF11), onPrimary = Color(0xFF14180B))
        } else {
            lightColorScheme(primary = Color(0xFF3E5F00), onPrimary = Color.White)
        }
    MaterialTheme(colorScheme = scheme, content = content)
}

/** A thin strip under the top bar: progress, an error, or a notice. Tapping it dismisses it. */
@Composable
fun StatusStrip(
    busy: String?,
    error: String?,
    notice: String?,
    onDismiss: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        if (busy != null) {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text(busy, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        val message = error ?: notice
        if (message != null) {
            Surface(
                color = if (error != null) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer,
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (error != null) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

/** A centred message for an empty or failed list. */
@Composable
fun EmptyState(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.padding(4.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (action != null) {
            Spacer(Modifier.padding(8.dp))
            action()
        }
    }
}

/** A dialog asking for one line of text (a name, a link). */
@Composable
fun TextInputDialog(
    title: String,
    label: String,
    confirm: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
    initial: String = "",
    help: String? = null,
) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                if (help != null) {
                    Text(help, style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.padding(4.dp))
                }
                OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text(label) }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(text) }, enabled = text.isNotBlank()) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** The create-channel dialog: a name and whether the whole workspace can join. */
@Composable
fun CreateChannelDialog(
    onCreate: (name: String, public: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var public by remember { mutableStateOf(true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New channel") },
        text = {
            Column {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true)
                Spacer(Modifier.padding(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = public, onCheckedChange = { public = it })
                    Spacer(Modifier.width(12.dp))
                    Text(if (public) "Public: everyone in the workspace can join" else "Private: members are added by an admin")
                }
            }
        },
        confirmButton = { TextButton(onClick = { onCreate(name, public) }, enabled = name.isNotBlank()) { Text("Create") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
