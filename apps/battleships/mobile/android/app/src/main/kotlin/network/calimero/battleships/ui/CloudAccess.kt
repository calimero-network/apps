package network.calimero.battleships.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.ConsentRequest
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.battleships.BattleshipsViewModel
import network.calimero.battleships.core.ErrorText

// Calimero 1.0 sign-in and approvals. (iOS `CloudAccess.swift`.)
//
// - Cloud: the person's cluster by name (looked up in the Calimero directory) or a node URL of it,
//   then the device's passkey: sign in, or create an account.
// - Development: a `merod local` node (mock attestation allowed) and a software passkey the app
//   keeps for that node.
// - Approvals: releases and upgrades waiting for the person's decision, approved on the node's own
//   consent page in a Custom Tab, after the app shows the confirmation code the page will show.

/** Sign in with a passkey, create an account, or connect to a development node. */
@Composable
fun CloudSignInPanel(
    vm: BattleshipsViewModel,
    activity: Context,
) {
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    var cluster by remember { mutableStateOf(vm.defaultCluster) }
    var devNode by remember { mutableStateOf(vm.defaultDevNode) }
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var development by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger, textAlign = TextAlign.Center) }
        if (!development) {
            Field("Cluster", cluster, { cluster = it }, "your-cluster, or https://node.example", KeyboardType.Uri)
        }
        if (creating || development) Field("Your name", name, { name = it }, "Ada")
        when {
            development -> {
                Field("Development node", devNode, { devNode = it }, "http://10.0.2.2:2501", KeyboardType.Uri)
                PrimaryButton("Connect", { vm.signInDev(devNode, name) }, enabled = devNode.isNotBlank(), busy = busy, icon = Icons.Outlined.Dns)
            }
            creating ->
                PrimaryButton(
                    "Create account",
                    { vm.signInCloud(activity, cluster, create = true, name = name) },
                    enabled = cluster.isNotBlank() && name.isNotBlank(),
                    busy = busy,
                    icon = Icons.Outlined.Key,
                )
            else ->
                PrimaryButton(
                    "Sign in with passkey",
                    { vm.signInCloud(activity, cluster, create = false, name = "") },
                    enabled = cluster.isNotBlank(),
                    busy = busy,
                    icon = Icons.Outlined.Key,
                )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!development) {
                TextButton(onClick = { creating = !creating }, enabled = !busy) {
                    Text(if (creating) "I have an account" else "Create an account", color = Palette.Ink, fontSize = 15.sp)
                }
            }
            TextButton(onClick = {
                development = !development
                creating = false
            }, enabled = !busy) {
                Text(if (development) "Use Calimero Cloud" else "Development node", color = Palette.Ink, fontSize = 15.sp)
            }
        }
        Text(
            if (development) {
                "For a node from `merod local`: its mock attestation is trusted and a test passkey is kept on this phone."
            } else {
                "Your passkey stays on this device. Calimero verifies the node before anything is sent."
            },
            fontSize = 13.sp,
            color = Palette.Muted,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Field(
    title: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardType = KeyboardType.Text,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(placeholder) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = false),
            shape = RoundedCornerShape(12.dp),
            colors = fieldColors(),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** One section of the approvals sheet: the person's own apps, or one lobby's organization. */
private data class ApprovalSection(
    val id: String,
    val title: String,
    val scope: ReportScope,
    val approvals: PendingApprovals,
)

/**
 * Releases and upgrades waiting for the person, per lobby (organization) and for their own apps,
 * each approved on the node's consent page after the confirmation code is shown.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsSheet(
    vm: BattleshipsViewModel,
    activity: Context,
    orgs: List<Pair<String, String>>,
    close: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var sections by remember { mutableStateOf<List<ApprovalSection>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var deciding by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf<Pair<String, CompletableDeferred<Boolean>>?>(null) }

    suspend fun load() {
        try {
            val next = mutableListOf(ApprovalSection("account", "Your apps", ReportScope.Account, vm.pendingApprovals()))
            for ((id, title) in orgs) next += ApprovalSection(id, title, ReportScope.org(id), vm.pendingApprovals(id))
            sections = next
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            error = ErrorText.describe(e)
        }
    }

    fun review(
        key: String,
        request: ConsentRequest,
    ) = scope.launch {
        deciding = key
        try {
            vm.requestConsent(activity, request) { started ->
                val shown = started.code
                if (shown.isNullOrEmpty()) {
                    true
                } else {
                    val answer = CompletableDeferred<Boolean>()
                    code = shown to answer
                    answer.await()
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            error = ErrorText.describe(e)
        } finally {
            deciding = null
        }
        load()
    }

    LaunchedEffect(Unit) { load() }

    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        SheetBar("Approvals", action = null, canAct = false, busy = false, cancel = close)
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val loaded = sections
            when {
                error != null -> Text(error.orEmpty(), color = Palette.Danger, fontSize = 15.sp)
                loaded == null ->
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Palette.Ink)
                    }
                loaded.all { it.approvals.releases.isEmpty() && it.approvals.upgrades.isEmpty() } ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.height(10.dp))
                        Text("Nothing is waiting for you.", color = Palette.Muted, fontSize = 15.sp)
                    }
                else ->
                    loaded.filter { it.approvals.releases.isNotEmpty() || it.approvals.upgrades.isNotEmpty() }.forEach { section ->
                        SectionLabel(section.title)
                        section.approvals.releases.forEach { release ->
                            val key = "${section.id}/r/${release.version}"
                            ApprovalRow(
                                Icons.Outlined.Shield,
                                "Node release ${release.version}",
                                release.deadline?.let { "Approve before ${it.after}" }
                                    ?: "Runs on ${release.nodes} node${if (release.nodes == 1L) "" else "s"}",
                                release.actionable,
                                deciding == key,
                                deciding != null,
                            ) { review(key, releaseConsent(section.scope, release.version, vm.consentCallback)) }
                        }
                        section.approvals.upgrades.forEach { upgrade ->
                            val key = "${section.id}/u/${upgrade.app}"
                            ApprovalRow(
                                Icons.Outlined.ArrowCircleUp,
                                "Update ${upgrade.name ?: upgrade.`package`}",
                                "${upgrade.from} → ${upgrade.to}",
                                upgrade.actionable,
                                deciding == key,
                                deciding != null,
                            ) { review(key, upgradeConsent(upgrade.app, upgrade.to, vm.consentCallback)) }
                        }
                    }
            }
        }
    }

    code?.let { (shown, answer) ->
        AlertDialog(
            onDismissRequest = {
                code = null
                answer.complete(false)
            },
            title = { Text("Check the code") },
            text = { Text("The approval page will show $shown. Continue only if it shows this code.") },
            confirmButton = {
                TextButton(onClick = {
                    code = null
                    answer.complete(true)
                }) { Text("Continue", color = Palette.Ink) }
            },
            dismissButton = {
                TextButton(onClick = {
                    code = null
                    answer.complete(false)
                }) { Text("Cancel", color = Palette.Ink) }
            },
            containerColor = Palette.Surface,
        )
    }
}

@Suppress("LongParameterList")
@Composable
private fun ApprovalRow(
    icon: ImageVector,
    title: String,
    detail: String,
    actionable: Boolean,
    deciding: Boolean,
    anyDeciding: Boolean,
    review: () -> Unit,
) {
    Card(padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                Text(if (actionable) detail else "Your cluster's operator approves this.", fontSize = 13.sp, color = Palette.Muted)
            }
            if (actionable) {
                if (deciding) {
                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    SecondaryButton("Review", review, compact = true, enabled = !anyDeciding)
                }
            }
        }
    }
}
