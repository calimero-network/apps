package network.calimero.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

@Composable
fun SignInScreen(
    busy: Boolean,
    error: String?,
    onSignIn: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.ground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 24.dp),
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(72.dp))
            IconTile(size = 64.dp)
            Spacer(Modifier.height(20.dp))
            Text("Mero Calendar", style = Tokens.title)
            Spacer(Modifier.height(8.dp))
            Text(
                "Shared team calendars and truly private events.",
                style = Tokens.body.copy(color = Tokens.muted),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(36.dp))
            Card {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Feature(Icons.Filled.Groups, "Teams share calendars", "Everyone in a team sees the same calendars, synced peer to peer.")
                    Feature(Icons.Filled.Lock, "Private events stay private", "A private event never leaves this device.")
                    Feature(Icons.Filled.Sync, "Live on every device", "Changes show up for your team as they happen.")
                }
            }
        }
        PrimaryButton("Continue with Calimero", onClick = onSignIn, busy = busy, modifier = Modifier.fillMaxWidth())
        if (busy) {
            TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Cancel", color = Tokens.muted)
            }
        }
        if (error != null) {
            Spacer(Modifier.height(10.dp))
            Text(error, style = Tokens.caption.copy(color = Tokens.danger), textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun Feature(
    icon: ImageVector,
    title: String,
    body: String,
) {
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.sunken),
            contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = Tokens.ink, modifier = Modifier.size(20.dp)) }
        Spacer(Modifier.width(14.dp))
        Column {
            Text(title, style = Tokens.heading.copy(fontSize = Tokens.body.fontSize))
            Spacer(Modifier.height(2.dp))
            Text(body, style = Tokens.caption)
        }
    }
}

/** A full-screen spinner with a line of text, and an optional action under it. */
@Composable
fun StatusScreen(
    text: String,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.ground),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        IconTile(size = 48.dp)
        Loading(text)
        action?.invoke()
    }
}
