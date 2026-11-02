package network.calimero.crm.ui

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.ViewWeek
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.crm.BuildConfig
import network.calimero.crm.app.CrmViewModel

private val points =
    listOf(
        Icons.Outlined.ViewWeek to "A pipeline you move deals through, with the next step on every card.",
        Icons.Outlined.Checklist to "A to-do list that puts overdue follow-ups first.",
        Icons.Outlined.Lock to "Lives on your team's own nodes. No vendor holds your customer list.",
    )

/** Signed out: what the app is, and Calimero sign-in (a Cloud passkey, or a development node). */
@Composable
fun SignInScreen(
    vm: CrmViewModel,
    platform: Platform,
) {
    val restoring by vm.restoring.collectAsState()
    val pending by vm.pendingInvitation.collectAsState()
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
        if (restoring) {
            Row(Modifier.height(50.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("Connecting…", color = Palette.ink2)
            }
        } else {
            CloudSignInPanel(vm, platform)
        }
    }
}

/**
 * Calimero 1.0 sign-in, as on iOS: a Calimero Cloud cluster (by name, or a node URL) and the
 * device's passkey (sign in, or create an account), or a development node (`merod local`, mock
 * attestation allowed, a software passkey kept on the phone).
 */
@Composable
private fun CloudSignInPanel(
    vm: CrmViewModel,
    platform: Platform,
) {
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    var cluster by remember { mutableStateOf(vm.savedCluster) }
    var devNode by remember { mutableStateOf(vm.savedDevNode) }
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var development by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ErrorLine(error)
        if (!development && BuildConfig.CLUSTER.isEmpty()) {
            Field("Cluster", cluster, { cluster = it }, "your-team, or https://node.your-team.calimero.network", keyboard = KeyboardType.Uri, capitalization = KeyboardCapitalization.None)
        }
        if (creating || development) {
            Field("Your name", name, { name = it }, "Ada", capitalization = KeyboardCapitalization.Words)
        }
        when {
            development -> {
                Field("Development node", devNode, { devNode = it }, "http://10.0.2.2:2501", keyboard = KeyboardType.Uri, capitalization = KeyboardCapitalization.None)
                PrimaryButton("Connect", onClick = { vm.signInDev(devNode, name) }, enabled = devNode.isNotBlank(), busy = busy, icon = Icons.Outlined.Dns)
            }
            creating ->
                PrimaryButton(
                    "Create account",
                    onClick = { platform.signIn(cluster, true, name) },
                    enabled = cluster.isNotBlank() && name.isNotBlank(),
                    busy = busy,
                    icon = Icons.Outlined.Key,
                )
            else ->
                PrimaryButton(
                    "Sign in with passkey",
                    onClick = { platform.signIn(cluster, false, "") },
                    enabled = cluster.isNotBlank(),
                    busy = busy,
                    icon = Icons.Outlined.Key,
                )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterHorizontally)) {
            if (!development) LinkButton(if (creating) "I have an account" else "Create an account", onClick = { creating = !creating }, enabled = !busy)
            LinkButton(
                if (development) "Use Calimero Cloud" else "Development node",
                onClick = {
                    development = !development
                    creating = false
                },
                enabled = !busy,
            )
        }
        Text(
            if (development) {
                "For a node from `merod local`: its mock attestation is trusted and a test passkey is kept on this phone."
            } else {
                "Your passkey stays on this device. Calimero verifies the node before anything is sent."
            },
            fontSize = 13.sp,
            color = Palette.ink2,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** The lime rounded square with the pipeline glyph. */
@Composable
fun AppMark(size: Int = 64) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 3.5f).dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.ViewWeek, contentDescription = null, tint = Palette.ink, modifier = Modifier.size((size * 0.5f).dp))
    }
}
