package network.calimero.merraria.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
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

/**
 * Signed out: what the game is, and the one button that signs in with a Calimero account. Laid out
 * for landscape: the pitch on the left, signing in on the right. (iOS `SignInView`.)
 */
@Composable
fun SignInScreen(
    auth: MeroAuthState,
    invited: Boolean,
    onSignIn: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MerrariaColors.Ground)
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 32.dp, vertical = 28.dp),
        horizontalArrangement = Arrangement.spacedBy(32.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AppMark(60.dp)
            Text("Merraria", style = Type.heading(34))
            Text(
                "Mine and build together in a 2D world with no game server. Every dig is shared state between the players' own devices.",
                style = Type.body(16, color = MerrariaColors.Ink2),
            )
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Point(Icons.Outlined.Dns, "No game server")
                Point(Icons.Outlined.Group, "Play with friends by invitation")
                Point(Icons.Outlined.AccountCircle, "Your Calimero account")
            }
        }
        Card(Modifier.widthIn(max = 380.dp), padding = 20.dp) {
            if (invited) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(ButtonShape)
                        .background(MerrariaColors.LimeSoft)
                        .padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Drafts, contentDescription = null, tint = MerrariaColors.Ink)
                    Text("You've been invited to a world. Sign in to join it.", style = Type.body(14))
                }
            }
            auth.error?.let { ErrorBanner(it) {} }
            PrimaryButton(onClick = onSignIn, enabled = !auth.isLoading) {
                if (auth.isLoading) CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
                ButtonLabel(if (auth.isLoading) "Signing in…" else "Sign in with Calimero")
            }
            if (auth.isLoading) {
                TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("Cancel", style = Type.body(14, FontWeight.SemiBold))
                }
            }
            Text(
                "The Calimero wallet approves this device. Nothing runs on the phone but the app.",
                style = Type.body(13, color = MerrariaColors.Muted),
            )
        }
    }
}

@Composable
private fun Point(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MerrariaColors.Ink, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(15, FontWeight.Medium))
    }
}
