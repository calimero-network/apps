package network.calimero.blocks.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.calimero.mero.compose.MeroAuthState

/** Signed out: what the app is, and the one button that signs in with a Calimero account. (iOS `SignInView`.) */
@Composable
fun SignInScreen(
    auth: MeroAuthState,
    invited: Boolean,
    onSignIn: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(BlocksColors.Ground)
                .systemBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Column(Modifier.padding(top = 48.dp)) { AppMark(64.dp) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mero Blocks", style = Type.heading(34))
            Text(
                "Build together in real time. The world is a Calimero context: every block you place is shared state, with no game server anywhere.",
                style = Type.body(16, color = BlocksColors.Ink2),
            )
        }
        Card {
            Point(Icons.Outlined.Dns, "No game server")
            Point(Icons.Outlined.Group, "Play with friends from a link")
            Point(Icons.Outlined.AccountCircle, "Your Calimero account")
        }
        if (invited) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(ButtonShape)
                    .background(BlocksColors.LimeSoft)
                    .padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Drafts, contentDescription = null, tint = BlocksColors.Ink)
                Text("You've been invited to a world. Sign in to join it.", style = Type.body(14))
            }
        }
        auth.error?.let { ErrorBanner(it) {} }
        PrimaryButton(onClick = onSignIn, enabled = !auth.isLoading) {
            if (auth.isLoading) CircularProgressIndicator(Modifier.size(18.dp), color = BlocksColors.Ink, strokeWidth = 2.dp)
            ButtonLabel(if (auth.isLoading) "Signing in…" else "Sign in with Calimero")
        }
        if (auth.isLoading) {
            TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Cancel", style = Type.body(14, FontWeight.SemiBold))
            }
        }
        Text(
            "The Calimero wallet approves this device. Nothing runs on the phone but the app.",
            style = Type.body(13, color = BlocksColors.Muted),
        )
    }
}

@Composable
private fun Point(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(15, FontWeight.Medium))
    }
}
