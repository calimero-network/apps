package network.calimero.pass.ui

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentScope
import com.calimero.mero.PendingApprovals
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.pass.BuildConfig
import network.calimero.pass.PassViewModel
import network.calimero.pass.core.PassErrorText

// Calimero 1.0 sign-in and approvals (iOS `CloudAccess.swift` is the same screens):
//
// - Cloud: the person's cluster, by name (`eu-shared-1`, its nodes read from the Calimero Cloud
//   directory) or by a node's URL (prefilled from `-PmeroNodeUrl`), then the device's passkey: sign
//   in, or create an account.
// - Development: a `merod local` node (`-PmeroDevNodeUrl`, `http://10.0.2.2:2501` by default) with
//   mock attestation allowed and a software passkey kept on this device for that node.
// - Approvals: releases and upgrades waiting for the person's decision, approved on the node's
//   own consent page in a Custom Tab (an app's session cannot approve anything itself). The page's
//   confirmation code is shown here first, so the person can match it there.

/** Sign in with a passkey, create an account, or connect to a development node. */
@Composable
fun CloudSignInPanel(
    vm: PassViewModel,
    activity: Context,
) {
    val preset = BuildConfig.MERO_NODE_URL.trim()
    var cluster by remember { mutableStateOf(vm.target.takeIf { vm.mode == network.calimero.pass.SignInMode.CLOUD }.orEmpty()) }
    var devNode by remember { mutableStateOf(BuildConfig.MERO_DEV_NODE_URL) }
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var development by remember { mutableStateOf(false) }
    val target = preset.ifEmpty { cluster.trim() }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        vm.error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger, textAlign = TextAlign.Center) }
        if (preset.isEmpty() && !development) {
            LabeledField("Cluster", cluster, { cluster = it }, "Cluster name or node URL")
        }
        if (creating || development) {
            LabeledField("Your name", name, { name = it }, "Ada")
        }
        when {
            development -> {
                LabeledField("Development node", devNode, { devNode = it }, "http://10.0.2.2:2501")
                PrimaryButton(
                    "Connect",
                    { vm.signInDev(devNode, name) },
                    enabled = devNode.isNotBlank(),
                    busy = vm.busy,
                    icon = Icons.Outlined.Dns,
                )
            }
            creating ->
                PrimaryButton(
                    "Create account",
                    { vm.signInCloud(activity, target, create = true, name = name) },
                    enabled = target.isNotEmpty() && name.isNotBlank(),
                    busy = vm.busy,
                    icon = Icons.Outlined.Key,
                )
            else ->
                PrimaryButton(
                    "Sign in with passkey",
                    { vm.signInCloud(activity, target, create = false, name = "") },
                    enabled = target.isNotEmpty(),
                    busy = vm.busy,
                    icon = Icons.Outlined.Key,
                )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (!development) {
                TextButton(onClick = { creating = !creating }, enabled = !vm.busy) {
                    Text(if (creating) "I have an account" else "Create an account", color = Palette.Ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                }
            }
            TextButton(onClick = {
                development = !development
                creating = false
            }, enabled = !vm.busy) {
                Text(if (development) "Use Calimero Cloud" else "Development node", color = Palette.Ink, fontSize = 15.sp, fontWeight = FontWeight.Medium)
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
private fun LabeledField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
) {
    InputField(label, value, onChange, placeholder)
}

/** One scope's waiting releases and upgrades. */
private data class ApprovalSection(
    val id: String,
    val title: String,
    val scope: ConsentScope,
    val approvals: PendingApprovals,
)

/** The node's confirmation code, waiting for the person to continue. */
private class PendingCode(
    val code: String,
    val answer: CompletableDeferred<Boolean>,
)

/**
 * Releases and upgrades waiting for the person, for their own apps and every team, each
 * approved on the node's consent page in a Custom Tab.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsSheet(
    vm: PassViewModel,
    activity: Context,
    dismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var sections by remember { mutableStateOf<List<ApprovalSection>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var deciding by remember { mutableStateOf<String?>(null) }
    var pending by remember { mutableStateOf<PendingCode?>(null) }

    suspend fun load() {
        loading = sections.isEmpty()
        try {
            val next = mutableListOf(ApprovalSection("account", "Your apps", ConsentScope.Account, vm.pendingApprovals()))
            vm.backend.value?.listNamespaces()?.forEach { org ->
                next += ApprovalSection(org.id, org.name ?: "Team", ConsentScope(org.id), vm.pendingApprovals(org.id))
            }
            sections = next
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            error = PassErrorText.describe(e)
        } finally {
            loading = false
        }
    }

    fun review(
        key: String,
        request: ConsentRequest,
    ) {
        deciding = key
        scope.launch {
            try {
                vm.requestConsent(activity, request) { started ->
                    if (started.code.isEmpty()) {
                        true
                    } else {
                        val answer = CompletableDeferred<Boolean>()
                        pending = PendingCode(started.code, answer)
                        answer.await()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = PassErrorText.describe(e)
            } finally {
                deciding = null
            }
            load()
        }
    }

    LaunchedEffect(Unit) { load() }

    pending?.let { code ->
        fun answer(go: Boolean) {
            pending = null
            code.answer.complete(go)
        }
        AlertDialog(
            onDismissRequest = { answer(false) },
            title = { Text("Confirmation code") },
            text = { Text("Check that your cluster's approval page shows ${code.code} before you approve.") },
            confirmButton = { TextButton(onClick = { answer(true) }) { Text("Continue", color = Palette.Ink) } },
            dismissButton = { TextButton(onClick = { answer(false) }) { Text("Cancel", color = Palette.Ink) } },
            containerColor = Palette.Surface,
        )
    }

    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Approvals", fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink)
            val empty = sections.all { it.approvals.releases.isEmpty() && it.approvals.upgrades.isEmpty() }
            when {
                loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.Ink) }
                error != null -> Text(error.orEmpty(), fontSize = 15.sp, color = Palette.Danger)
                empty ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.Verified, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.padding(4.dp))
                        Text("Nothing is waiting for you.", fontSize = 15.sp, color = Palette.Muted)
                    }
                else ->
                    sections.filter { it.approvals.releases.isNotEmpty() || it.approvals.upgrades.isNotEmpty() }.forEach { section ->
                        Text(section.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted)
                        section.approvals.releases.forEach { release ->
                            val key = "${section.id}/r/${release.version}"
                            ApprovalRow(
                                Icons.Outlined.Shield,
                                "Node release ${release.version}",
                                release.deadline?.let { "Approve before ${it.after}" }
                                    ?: "Runs on ${release.nodes} node${if (release.nodes == 1L) "" else "s"}",
                                release.actionable,
                                busy = deciding == key,
                                enabled = deciding == null,
                            ) { review(key, ConsentRequest.Release(section.scope, release.version, BuildConfig.CONSENT_CALLBACK_URL)) }
                        }
                        section.approvals.upgrades.forEach { upgrade ->
                            val key = "${section.id}/u/${upgrade.app}"
                            ApprovalRow(
                                Icons.Outlined.ArrowCircleUp,
                                "Update ${upgrade.name ?: upgrade.`package`}",
                                "${upgrade.from} → ${upgrade.to}",
                                upgrade.actionable,
                                busy = deciding == key,
                                enabled = deciding == null,
                            ) { review(key, ConsentRequest.Upgrade(upgrade.app, upgrade.to, BuildConfig.CONSENT_CALLBACK_URL)) }
                        }
                    }
            }
            SecondaryButton("Done", dismiss)
        }
    }
}

@Composable
private fun ApprovalRow(
    icon: ImageVector,
    title: String,
    detail: String,
    actionable: Boolean,
    busy: Boolean,
    enabled: Boolean,
    review: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
            Text(if (actionable) detail else "Your cluster's operator approves this.", fontSize = 13.sp, color = Palette.Muted)
        }
        if (actionable) {
            if (busy) {
                CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            } else if (enabled) {
                SecondaryButton("Review", review, compact = true)
            }
        }
    }
}
