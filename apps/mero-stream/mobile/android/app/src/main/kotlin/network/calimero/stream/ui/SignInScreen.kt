package network.calimero.stream.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.SettingsInputAntenna
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.stream.app.StreamViewModel

/** Signed out: what the app is, and Calimero sign-in. */
@Composable
fun SignInScreen(
    vm: StreamViewModel,
    platform: Platform,
) {
    val restoring by vm.session.isRestoring.collectAsState()
    val pending by vm.session.pendingInvitation.collectAsState()
    val state by vm.session.client.state
        .collectAsState()
    val tap = rememberTap()
    val busy = restoring || state.isLoading
    val points =
        listOf(
            Icons.Outlined.Groups to "Create a stream, invite people, and meet in its rooms.",
            Icons.Outlined.SettingsInputAntenna to "Video rides ephemeral presence, so nothing about a call is stored.",
            Icons.Outlined.Devices to "A phone and a browser can be in the same room.",
        )
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Box(Modifier.size(64.dp).clip(RoundedCornerShape(18.dp)).background(Palette.Lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Videocam, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(32.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mero Stream", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = Palette.Ink)
            Text(
                "Video rooms on your own Calimero nodes. Up to two people share their camera at once; everyone else watches.",
                fontSize = 16.sp,
                color = Palette.InkSoft,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for ((icon, text) in points) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp))
                    Text(text, fontSize = 15.sp, color = Palette.Ink)
                }
            }
        }
        if (pending != null) {
            Card {
                Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Outlined.Drafts, contentDescription = null, tint = Palette.Ink)
                    Text("You're invited to a stream. Sign in to join it.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PrimaryButton(if (busy) "Connecting…" else "Sign in with Calimero", busy = busy, onClick = {
                tap()
                platform.signIn()
            })
            if (!busy) state.error?.let { Text(it, fontSize = 13.sp, color = Palette.Danger) }
        }
    }
}
