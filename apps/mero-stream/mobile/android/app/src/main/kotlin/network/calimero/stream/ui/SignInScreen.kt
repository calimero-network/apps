package network.calimero.stream.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Devices
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.SettingsInputAntenna
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.stream.app.ClusterChoice
import network.calimero.stream.app.StreamViewModel

/**
 * Signed out: what the app is, and a passkey on the cluster. The cluster is a Calimero Cloud
 * cluster (by name or a node's URL) or a development node (`merod local`, mock attestation).
 * (Identical to the iOS `SignInView`.)
 */
@Composable
fun SignInScreen(
    vm: StreamViewModel,
    platform: Platform,
) {
    val restoring by vm.restoring.collectAsState()
    val signing by vm.busy.collectAsState()
    val choice by vm.choice.collectAsState()
    val session by vm.sessionFlow.collectAsState()
    val error by vm.signInError.collectAsState()
    val waiting by vm.waitingLink.collectAsState()
    val pending = session?.pendingInvitation?.collectAsState()?.value ?: waiting
    val tap = rememberTap()
    val busy = restoring || signing
    var choosing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    val points =
        listOf(
            Icons.Outlined.Groups to "Create a stream, invite people, and meet in its rooms.",
            Icons.Outlined.SettingsInputAntenna to "Video rides the room's presence, so nothing about a call is stored.",
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
                "Video rooms on your attested Calimero cluster. Up to two people share their camera at once; everyone else watches.",
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
            val current = choice
            if (current == null || session == null) {
                PrimaryButton("Choose your cluster", busy = busy, icon = Icons.Outlined.Dns, onClick = { choosing = true })
            } else {
                PrimaryButton(
                    if (busy) "Waiting for your passkey…" else "Sign in with a passkey",
                    busy = busy,
                    icon = Icons.Outlined.Key,
                    onClick = {
                        tap()
                        platform.signIn()
                    },
                )
                SecondaryButton("Create an account", onClick = { if (!busy) creating = true })
            }
            if (!busy) error?.let { Text(it, fontSize = 13.sp, color = Palette.Danger) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(clusterLine(current), fontSize = 13.sp, color = Palette.Muted, maxLines = 2, modifier = Modifier.weight(1f))
                if (current != null) {
                    Text(
                        "Change",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Palette.Ink,
                        modifier = Modifier.clickable { choosing = true }.padding(6.dp),
                    )
                }
            }
        }
    }
    if (creating) {
        NameSheet(
            title = "Create an account",
            action = "Create",
            placeholder = "Your name",
            icon = Icons.Outlined.Person,
            hint = "Your name is what people in a call see. A new passkey on this phone signs you in from now on.",
            busy = false,
            onDismiss = { creating = false },
        ) { name ->
            creating = false
            platform.signUp(name)
        }
    }
    if (choosing) {
        ClusterSheet(vm, current = choice, onDismiss = { choosing = false })
    }
}

private fun clusterLine(choice: ClusterChoice?): String =
    when (choice) {
        null -> "Choose the cluster your streams run on to sign in."
        is ClusterChoice.Development -> "Development node at ${host(choice.value)}."
        is ClusterChoice.Cloud ->
            if (ClusterChoice.isUrl(choice.value)) "Calimero Cloud, node ${host(choice.value)}." else "Calimero Cloud, cluster ${choice.value}."
    }

private fun host(url: String): String = url.substringAfter("://").substringBefore('/')

/** Where to sign in: a Calimero Cloud cluster (by name or a node's URL), or a development node. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ClusterSheet(
    vm: StreamViewModel,
    current: ClusterChoice?,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var development by remember { mutableStateOf(current is ClusterChoice.Development) }
    var cloud by remember { mutableStateOf((current as? ClusterChoice.Cloud)?.value.orEmpty()) }
    var local by remember { mutableStateOf((current as? ClusterChoice.Development)?.value ?: StreamViewModel.DEFAULT_DEV_NODE) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val value = (if (development) local else cloud).trim()
    val canUse = if (development) ClusterChoice.isUrl(value) else value.isNotEmpty()
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        Column(Modifier.navigationBarsPadding().imePadding()) {
            SheetBar("Your cluster", "Use", canAct = canUse, busy = busy, onCancel = onDismiss, onAct = {
                busy = true
                error = null
                scope.launch {
                    val failure = vm.choose(if (development) ClusterChoice.Development(value) else ClusterChoice.Cloud(value))
                    busy = false
                    if (failure == null) onDismiss() else error = failure
                }
            })
            Column(Modifier.padding(16.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(selected = !development, onClick = { development = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                        Text("Calimero Cloud")
                    }
                    SegmentedButton(selected = development, onClick = { development = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                        Text("Development node")
                    }
                }
                if (development) {
                    Text(
                        "A node you run with `merod local`. Its attestation is a mock, so use this only for development.",
                        fontSize = 15.sp,
                        color = Palette.Muted,
                    )
                    Field(local, { local = it }, StreamViewModel.DEFAULT_DEV_NODE, Icons.Outlined.Terminal, capitalize = false)
                } else {
                    Text(
                        "Your cluster's name from Calimero Cloud, or the address of one of its nodes. The app checks each node's attestation before it sends anything.",
                        fontSize = 15.sp,
                        color = Palette.Muted,
                    )
                    Field(cloud, { cloud = it }, "eu-shared-1", Icons.Outlined.Cloud, capitalize = false)
                }
                error?.let { Text(it, fontSize = 13.sp, color = Palette.Danger) }
                Spacer(Modifier.size(12.dp))
            }
        }
    }
}
