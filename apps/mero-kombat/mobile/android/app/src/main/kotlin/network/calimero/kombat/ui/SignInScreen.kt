package network.calimero.kombat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.TrackChanges
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
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
 * Signed out: what the app is, the one button that signs in with a Calimero account, and practice,
 * which needs no account. Two columns: the phone is held sideways. (iOS `SignInView`.)
 */
@Composable
fun SignInScreen(
    auth: MeroAuthState,
    invited: Boolean,
    onSignIn: () -> Unit,
    onCancel: () -> Unit,
    onPractice: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(KombatColors.Ground)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.TopCenter,
    ) {
        Row(
            Modifier.widthIn(max = 900.dp).fillMaxWidth().padding(horizontal = 32.dp, vertical = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(32.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                AppMark(56.dp)
                Text("Mero Kombat", style = Type.heading(34))
                Text(
                    "A one-on-one fighting game where every punch is a transaction. Two fighters, best of three rounds, no game server.",
                    style = Type.body(16, color = KombatColors.Ink2),
                )
                Card {
                    Point(Icons.Outlined.Dns, "No game server")
                    Point(Icons.Filled.Bolt, "Every blow is a transaction")
                    Point(Icons.Outlined.AccountCircle, "Your Calimero account")
                }
            }
            Column(Modifier.widthIn(max = 340.dp).padding(top = 74.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (invited) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(ButtonShape)
                            .background(KombatColors.LimeSoft)
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.Drafts, contentDescription = null, tint = KombatColors.Ink)
                        Text("You've been invited to an arena. Sign in to join it.", style = Type.body(14))
                    }
                }
                auth.error?.let { ErrorBanner(it) {} }
                PrimaryButton(onClick = onSignIn, enabled = !auth.isLoading) {
                    if (auth.isLoading) CircularProgressIndicator(Modifier.size(18.dp), color = KombatColors.Ink, strokeWidth = 2.dp)
                    ButtonLabel(if (auth.isLoading) "Signing in…" else "Sign in with Calimero")
                }
                if (auth.isLoading) {
                    TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Text("Cancel", style = Type.body(14, FontWeight.SemiBold))
                    }
                }
                SecondaryButton(onClick = onPractice) {
                    Icon(Icons.Filled.TrackChanges, contentDescription = null, modifier = Modifier.size(18.dp))
                    ButtonLabel("Practice vs CPU")
                }
                Text(
                    "The Calimero wallet approves this device. Practice needs no account.",
                    style = Type.body(13, color = KombatColors.Muted),
                )
            }
        }
    }
}

@Composable
private fun Point(
    icon: ImageVector,
    text: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = KombatColors.Ink, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(15, FontWeight.Medium))
    }
}
