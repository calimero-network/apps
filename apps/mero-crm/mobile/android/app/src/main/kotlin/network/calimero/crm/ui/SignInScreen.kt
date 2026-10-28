package network.calimero.crm.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.ViewWeek
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.crm.app.CrmViewModel

private val points =
    listOf(
        Icons.Outlined.ViewWeek to "A pipeline you move deals through, with the next step on every card.",
        Icons.Outlined.Checklist to "A to-do list that puts overdue follow-ups first.",
        Icons.Outlined.Lock to "Lives on your team's own nodes. No vendor holds your customer list.",
    )

/** Signed out: what the app is, and Sign in with Calimero. */
@Composable
fun SignInScreen(
    vm: CrmViewModel,
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
        AppMark()
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Mero CRM", fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Text(
                "A simple, private sales CRM: deals, the people behind them, and what to do next.",
                color = Palette.ink2,
                fontSize = 17.sp,
            )
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
            CrmCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Drafts, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("You're invited to a workspace. Sign in to join it.", fontSize = 15.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (busy) {
                Row(Modifier.height(50.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("Connecting…", color = Palette.ink2)
                }
            } else {
                PrimaryButton("Sign in with Calimero", onClick = platform.signIn)
            }
            if (!busy) ErrorLine(state.error)
        }
    }
}

/** The lime rounded square with the pipeline glyph. */
@Composable
fun AppMark(size: Int = 64) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 3.5f).dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.ViewWeek, contentDescription = null, tint = Palette.ink, modifier = Modifier.size((size * 0.5f).dp))
    }
}
