package network.calimero.updates.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.updates.app.UpdatesViewModel

private val points: List<Pair<ImageVector, String>> =
    listOf(
        Icons.AutoMirrored.Outlined.Article to "Structured updates: TL;DR, KPIs with the change since last time, and asks.",
        Icons.Outlined.PanTool to "Investors react, reply and offer help on an ask in one tap.",
        Icons.Outlined.Lock to "No SaaS database. Updates live on the company's and its investors' own nodes.",
    )

/** Signed out: what the app is, and Sign in with Calimero. */
@Composable
fun SignInScreen(
    vm: UpdatesViewModel,
    platform: Platform,
) {
    val state by vm.session.client.state
        .collectAsState()
    val restoring by vm.session.isRestoring.collectAsState()
    val pending by vm.session.pendingInvitation.collectAsState()
    val busy = restoring || state.isLoading
    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        IconTile(Icons.Outlined.Inbox, accent = true, size = 64.dp)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mero Updates", style = displayStyle(34.sp))
            Text("Investor updates and investor relations, peer to peer.", color = Palette.ink2, fontSize = 17.sp)
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            for ((icon, point) in points) {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(point, fontSize = 15.sp)
                }
            }
        }
        if (pending != null) {
            UpdatesCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Drafts, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("You're invited to a company. Sign in to join it.", fontWeight = FontWeight.Medium, fontSize = 15.sp)
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PrimaryButton(
                if (busy) "Connecting…" else "Sign in with Calimero",
                onClick = platform.signIn,
                busy = busy,
                modifier = Modifier.fillMaxWidth(),
            )
            if (!busy) ErrorLine(state.error)
        }
    }
}
