package network.calimero.standup.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.standup.app.StandupViewModel

private val points =
    listOf(
        "Lives on your team's own nodes. No server, nobody else can read it.",
        "Yesterday's plan becomes today's draft, so posting takes seconds.",
        "Decisions are never edited, only superseded, so the why survives.",
    )

/** Signed out: what the app is, and Sign in with Calimero. */
@Composable
fun SignInScreen(
    vm: StandupViewModel,
    platform: Platform,
) {
    val state by vm.session.client.state
        .collectAsState()
    val restoring by vm.session.isRestoring.collectAsState()
    val busy = restoring || state.isLoading
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AppMark()
        Spacer(Modifier.height(20.dp))
        Text("Mero Standup", fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Text(
            "Async standups and a decision log for your team. Post what you did, what is next and what is in your way; record what you decided and why.",
            color = Palette.ink2,
            fontSize = 16.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (point in points) {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text(point, fontSize = 15.sp)
                }
            }
        }
        Spacer(Modifier.height(32.dp))
        if (busy) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("Connecting…", color = Palette.ink2)
            }
        } else {
            PrimaryButton("Sign in with Calimero", onClick = platform.signIn, modifier = Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(12.dp))
        ErrorLine(state.error)
    }
}

/** The lime rounded square with the sun. */
@Composable
fun AppMark(size: Int = 64) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 4).dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.WbSunny, contentDescription = null, tint = Palette.ink, modifier = Modifier.size((size / 2).dp))
    }
}
