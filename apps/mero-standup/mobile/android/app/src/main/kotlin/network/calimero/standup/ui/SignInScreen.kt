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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.standup.app.StandupViewModel

private val points =
    listOf(
        "Lives on your team's own Calimero cluster. Nobody else can read it.",
        "Yesterday's plan becomes today's draft, so posting takes seconds.",
        "Decisions are never edited, only superseded, so the why survives.",
    )

private enum class SignInForm { SIGN_IN, CREATE, DEVELOPMENT }

/**
 * Signed out: what the app is, then sign-in to a Calimero 1.0 cluster (iOS `SignInView`):
 *
 * - Calimero Cloud: the cluster by name (its nodes come from the node directory) or a node URL,
 *   then the device's passkey. "Create an account" registers a new passkey under a name.
 * - Development node: a `merod local` URL with mock attestation allowed; a software passkey is kept
 *   on the device for that node.
 */
@Composable
fun SignInScreen(
    vm: StandupViewModel,
    restoring: Boolean,
) {
    val signingIn by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    val busy = restoring || signingIn
    var form by rememberSaveable { mutableStateOf(SignInForm.SIGN_IN) }
    var cluster by rememberSaveable { mutableStateOf(vm.lastCluster) }
    var devNode by rememberSaveable { mutableStateOf(vm.lastDevNode) }
    var name by rememberSaveable { mutableStateOf("") }
    Column(
        Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
    ) {
        Spacer(Modifier.height(40.dp))
        AppMark()
        Spacer(Modifier.height(20.dp))
        Text("Mero Standup", fontSize = 30.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        Text(
            "Async standups and a decision log for your team. Post what you did, what is next and what is in your way; record what you decided and why.",
            color = Palette.ink2,
            fontSize = 16.sp,
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
        Spacer(Modifier.height(28.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (form == SignInForm.DEVELOPMENT) {
                LabeledField("Development node URL", devNode, { devNode = it }, "http://10.0.2.2:2501", MAX_FIELD, singleLine = true)
                LabeledField("Your name", name, { name = it }, "e.g. Ada", MAX_FIELD, singleLine = true)
                Muted("For a merod local cluster: mock attestation is allowed and a passkey is kept on this device for that node.")
            } else {
                LabeledField("Cluster", cluster, { cluster = it }, "Cluster name or node URL", MAX_FIELD, singleLine = true)
                Muted("Your cluster's name from Calimero Cloud, or one of its node URLs.")
                if (form == SignInForm.CREATE) LabeledField("Your name", name, { name = it }, "e.g. Ada Lovelace", MAX_FIELD, singleLine = true)
            }
            val canSubmit =
                when (form) {
                    SignInForm.SIGN_IN -> cluster.isNotBlank()
                    SignInForm.CREATE -> cluster.isNotBlank() && name.isNotBlank()
                    SignInForm.DEVELOPMENT -> devNode.isNotBlank()
                }
            if (busy) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(if (restoring) "Restoring your session…" else "Connecting…", color = Palette.ink2)
                }
            } else {
                PrimaryButton(
                    when (form) {
                        SignInForm.SIGN_IN -> "Sign in with passkey"
                        SignInForm.CREATE -> "Create account"
                        SignInForm.DEVELOPMENT -> "Connect"
                    },
                    onClick = {
                        when (form) {
                            SignInForm.SIGN_IN -> vm.signInCloud(cluster, false, name)
                            SignInForm.CREATE -> vm.signInCloud(cluster, true, name)
                            SignInForm.DEVELOPMENT -> vm.signInDevelopment(devNode, name)
                        }
                    },
                    enabled = canSubmit,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            ErrorLine(error)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                when (form) {
                    SignInForm.SIGN_IN -> LinkButton("Create an account", onClick = { form = SignInForm.CREATE })
                    SignInForm.CREATE -> LinkButton("I have an account", onClick = { form = SignInForm.SIGN_IN })
                    SignInForm.DEVELOPMENT -> LinkButton("Use Calimero Cloud", onClick = { form = SignInForm.SIGN_IN })
                }
                Spacer(Modifier.weight(1f))
                if (form != SignInForm.DEVELOPMENT) LinkButton("Development node", onClick = { form = SignInForm.DEVELOPMENT })
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

private const val MAX_FIELD = 200

/** The lime rounded square with the sun. */
@Composable
fun AppMark(size: Int = 64) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 4).dp)).background(Palette.lime), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.WbSunny, contentDescription = null, tint = Palette.ink, modifier = Modifier.size((size / 2).dp))
    }
}
