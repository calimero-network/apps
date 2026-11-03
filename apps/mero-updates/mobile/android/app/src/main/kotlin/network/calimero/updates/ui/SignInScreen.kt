package network.calimero.updates.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.updates.app.SignInMode
import network.calimero.updates.app.UpdatesViewModel

private val points: List<Pair<ImageVector, String>> =
    listOf(
        Icons.AutoMirrored.Outlined.Article to "Structured updates: TL;DR, KPIs with the change since last time, and asks.",
        Icons.Outlined.PanTool to "Investors react, reply and offer help on an ask in one tap.",
        Icons.Outlined.Lock to "No SaaS database. Updates live on the company's and its investors' own nodes.",
    )

private enum class SignInForm { SIGN_IN, CREATE, DEVELOPMENT }

/**
 * Signed out: what the app is, then sign-in to a Calimero 1.0 cluster.
 *
 * - Calimero Cloud: the cluster's name (its nodes come from the node directory) or one of its node
 *   URLs, then the device's passkey: sign in, or create an account.
 * - Development node: a `merod local` URL with mock attestation allowed; a software passkey is
 *   kept on the device for that node.
 */
@Composable
fun SignInScreen(
    vm: UpdatesViewModel,
    platform: Platform,
) {
    val restoring by vm.restoring.collectAsState()
    val signingIn by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    val pending by vm.pendingInvitation.collectAsState()
    val busy = restoring || signingIn
    var form by rememberSaveable { mutableStateOf(if (vm.savedMode == SignInMode.DEV) SignInForm.DEVELOPMENT else SignInForm.SIGN_IN) }
    var cluster by rememberSaveable { mutableStateOf(vm.savedCluster) }
    var devNode by rememberSaveable { mutableStateOf(vm.savedDevNode) }
    var name by rememberSaveable { mutableStateOf("") }
    val canSubmit =
        when (form) {
            SignInForm.SIGN_IN -> cluster.isNotBlank()
            SignInForm.CREATE -> cluster.isNotBlank() && name.isNotBlank()
            SignInForm.DEVELOPMENT -> devNode.isNotBlank()
        }
    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
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
            if (!busy) ErrorLine(error)
            if (form == SignInForm.DEVELOPMENT) {
                Labeled("Development node") { InputField(devNode, { devNode = it }, "http://10.0.2.2:2501") }
                Labeled("Your name") { InputField(name, { name = it }, "Ada") }
            } else {
                Labeled("Cluster") { InputField(cluster, { cluster = it }, "Cluster name or node URL") }
                if (form == SignInForm.CREATE) Labeled("Your name") { InputField(name, { name = it }, "Ada") }
            }
            PrimaryButton(
                when {
                    busy -> "Waiting for your passkey…"
                    form == SignInForm.SIGN_IN -> "Sign in with passkey"
                    form == SignInForm.CREATE -> "Create account"
                    else -> "Connect"
                },
                onClick = {
                    when (form) {
                        SignInForm.SIGN_IN -> platform.signInCloud(cluster, false, name)
                        SignInForm.CREATE -> platform.signInCloud(cluster, true, name)
                        SignInForm.DEVELOPMENT -> vm.signInDev(devNode, name)
                    }
                },
                icon = if (form == SignInForm.DEVELOPMENT) Icons.Outlined.Dns else Icons.Outlined.Key,
                enabled = canSubmit,
                busy = busy,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                if (form != SignInForm.DEVELOPMENT) {
                    LinkButton(
                        if (form == SignInForm.CREATE) "I have an account" else "Create an account",
                        onClick = { form = if (form == SignInForm.CREATE) SignInForm.SIGN_IN else SignInForm.CREATE },
                        color = Palette.ink,
                        enabled = !busy,
                    )
                    Spacer(Modifier.width(18.dp))
                }
                LinkButton(
                    if (form == SignInForm.DEVELOPMENT) "Use Calimero Cloud" else "Development node",
                    onClick = { form = if (form == SignInForm.DEVELOPMENT) SignInForm.SIGN_IN else SignInForm.DEVELOPMENT },
                    color = Palette.ink,
                    enabled = !busy,
                )
            }
            Text(
                if (form == SignInForm.DEVELOPMENT) {
                    "For a node from merod local: its mock attestation is trusted and a test passkey is kept on this phone."
                } else {
                    "Your passkey stays on this device. Calimero verifies the node before anything is sent."
                },
                color = Palette.ink2,
                fontSize = 13.sp,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun Labeled(
    title: String,
    field: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = Palette.ink2, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        field()
    }
}
