package network.calimero.sheets.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.HighlightOff
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.calimero.mero.ConsentRequest
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.sheets.app.CloudErrorText
import network.calimero.sheets.app.SheetsAppViewModel

// Calimero 1.0 sign-in and approvals, the same in every native app (iOS: CloudAccess.swift).
//
// - Cloud: the person's cluster, by name (`eu-shared-1`, its nodes read from the node directory)
//   or by a node URL (from the cloud.calimero.network console; prefilled from `meroNodeUrl`), then
//   the device's passkey: sign in, or create an account.
// - Development: a `merod local` node (`meroDevNodeUrl`) with mock attestation allowed and a
//   software passkey kept on the device for that node.
// - Approvals: releases and upgrades waiting for the person's decision, approved on the node's own
//   consent page in a Custom Tab (an app's session cannot approve anything itself). The app shows
//   the request's confirmation code first; the page shows the same code.

/** Sign in with a passkey, create an account, or connect to a development node. */
@Composable
fun CloudSignInPanel(vm: SheetsAppViewModel) {
    val context = LocalContext.current
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var cluster by remember { mutableStateOf(vm.clusterDefault) }
    var devNode by remember { mutableStateOf(vm.devNodeDefault) }
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var development by remember { mutableStateOf(false) }
    val canUseCluster = cluster.isNotBlank()

    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        error?.let { Text(it, fontSize = 14.sp, color = Palette.danger, textAlign = TextAlign.Center) }
        if (!vm.clusterFixed && !development) {
            LabeledField("Cluster", cluster, { cluster = it }, "Cluster name or node URL", KeyboardType.Uri)
        }
        if (creating || development) {
            LabeledField("Your name", name, { name = it }, "Ada")
        }
        when {
            development -> {
                LabeledField("Development node", devNode, { devNode = it }, SheetsAppViewModel.DEFAULT_DEV_NODE, KeyboardType.Uri)
                PrimaryButton("Connect", { vm.signInDev(devNode, name) }, enabled = devNode.isNotBlank(), busy = busy, icon = Icons.Outlined.Dns)
            }
            creating ->
                PrimaryButton(
                    "Create account",
                    { vm.signInCloud(context, cluster, create = true, name = name) },
                    enabled = canUseCluster && name.isNotBlank(),
                    busy = busy,
                    icon = Icons.Outlined.Key,
                )
            else ->
                PrimaryButton(
                    "Sign in with passkey",
                    { vm.signInCloud(context, cluster, create = false, name = "") },
                    enabled = canUseCluster,
                    busy = busy,
                    icon = Icons.Outlined.Key,
                )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            if (!development) {
                TextButton(onClick = {
                    creating = !creating
                    vm.clearError()
                }, enabled = !busy) { Text(if (creating) "I have an account" else "Create an account", color = Palette.ink) }
            }
            TextButton(onClick = {
                development = !development
                creating = false
                vm.clearError()
            }, enabled = !busy) { Text(if (development) "Use Calimero Cloud" else "Development node", color = Palette.ink) }
        }
        Text(
            if (development) {
                "For a node from `merod local`: its mock attestation is trusted and a test passkey is kept on this phone."
            } else {
                "Your passkey stays on this device. Calimero verifies the node before anything is sent."
            },
            fontSize = 13.sp,
            color = Palette.text2,
            textAlign = TextAlign.Center,
        )
    }
}

private class Section(
    val id: String,
    val title: String,
    val scope: ReportScope,
    val approvals: PendingApprovals,
) {
    val isEmpty: Boolean get() = approvals.releases.isEmpty() && approvals.upgrades.isEmpty()
}

/** A consent request's confirmation code, waiting for the person to continue or cancel. */
private class CodePrompt(
    val code: String,
    val answer: CompletableDeferred<Boolean>,
)

/**
 * Releases and upgrades waiting for the person, per org (and their own apps), each approved on
 * the node's consent page in a Custom Tab. Before the page opens, the app shows the request's
 * confirmation code; the page shows the same one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod", "CyclomaticComplexMethod")
@Composable
fun ApprovalsSheet(
    vm: SheetsAppViewModel,
    orgs: List<Pair<String, String>>,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val consent by vm.consentResult.collectAsStateWithLifecycle()
    var sections by remember { mutableStateOf<List<Section>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var deciding by remember { mutableStateOf<String?>(null) }
    var prompt by remember { mutableStateOf<CodePrompt?>(null) }

    suspend fun load() {
        loading = sections.isEmpty()
        try {
            val next = mutableListOf(Section("account", "Your apps", ReportScope.Account, vm.pendingApprovals()))
            for ((id, title) in orgs) next += Section(id, title, ReportScope.org(id), vm.pendingApprovals(id))
            sections = next
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            error = CloudErrorText.describe(e)
        } finally {
            loading = false
        }
    }

    fun review(
        key: String,
        request: (String) -> ConsentRequest,
    ) {
        deciding = key
        scope.launch {
            try {
                vm.requestConsent(context, request) { started ->
                    if (started.code.isEmpty()) {
                        true
                    } else {
                        val answer = CompletableDeferred<Boolean>()
                        prompt = CodePrompt(started.code, answer)
                        answer.await()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = CloudErrorText.describe(e)
            }
            deciding = null
            load()
        }
    }

    LaunchedEffect(Unit) { load() }
    LaunchedEffect(consent) { if (consent != null) load() }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.ground) {
        Column(
            Modifier
                .padding(horizontal = Palette.gutter)
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.fillMaxWidth()) {
                Text("Approvals", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink, modifier = Modifier.align(Alignment.Center))
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterEnd)) { Text("Done", color = Palette.ink) }
            }
            when {
                loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.ink) }
                error != null -> ErrorLine(error)
                sections.all { it.isEmpty } ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.Verified, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.size(10.dp))
                        Text("Nothing is waiting for you.", color = Palette.text2)
                    }
                else ->
                    sections.filterNot { it.isEmpty }.forEach { section ->
                        Text(section.title.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.text3)
                        Column(Modifier.card(12.dp)) {
                            section.approvals.releases.forEachIndexed { i, release ->
                                if (i > 0) HorizontalDivider(color = Palette.line)
                                val key = "${section.id}/r/${release.version}"
                                ApprovalRow(
                                    Icons.Outlined.Shield,
                                    "Node release ${release.version}",
                                    release.deadline?.let { "Approve before ${it.after}" }
                                        ?: "Runs on ${release.nodes} node${if (release.nodes == 1L) "" else "s"}",
                                    release.actionable,
                                    deciding == key,
                                    deciding == null,
                                ) { review(key) { returnTo -> releaseConsent(section.scope, release.version, returnTo) } }
                            }
                            section.approvals.upgrades.forEachIndexed { i, upgrade ->
                                if (i > 0 || section.approvals.releases.isNotEmpty()) HorizontalDivider(color = Palette.line)
                                val key = "${section.id}/u/${upgrade.app}"
                                ApprovalRow(
                                    Icons.Outlined.ArrowCircleUp,
                                    "Update ${upgrade.name ?: upgrade.`package`}",
                                    "${upgrade.from} to ${upgrade.to}",
                                    upgrade.actionable,
                                    deciding == key,
                                    deciding == null,
                                ) { review(key) { returnTo -> upgradeConsent(upgrade.app, upgrade.to, returnTo) } }
                            }
                        }
                    }
            }
            consent?.takeIf { !it.isPending }?.let { result ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(
                        if (result.isApproved) Icons.Outlined.CheckCircle else Icons.Outlined.HighlightOff,
                        contentDescription = null,
                        tint = Palette.text2,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        if (result.isApproved) "Approved. It takes effect on the cluster shortly." else "Not approved.",
                        fontSize = 14.sp,
                        color = Palette.text2,
                    )
                }
            }
            Spacer(Modifier.size(12.dp))
        }
    }

    prompt?.let { current ->
        fun answer(proceed: Boolean) {
            prompt = null
            current.answer.complete(proceed)
        }
        AlertDialog(
            onDismissRequest = { answer(false) },
            title = { Text("Check the code") },
            text = { Text("Your node’s approval page will show the code ${current.code}. Continue only if it matches.") },
            confirmButton = { TextButton(onClick = { answer(true) }) { Text("Continue", color = Palette.ink) } },
            dismissButton = { TextButton(onClick = { answer(false) }) { Text("Cancel", color = Palette.text2) } },
            containerColor = Palette.surface,
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
    enabled: Boolean,
    review: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = Palette.ink)
            Text(if (actionable) detail else "Your cluster's operator approves this.", fontSize = 13.sp, color = Palette.text2)
        }
        if (actionable) {
            if (deciding) {
                CircularProgressIndicator(color = Palette.ink, modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
            } else {
                OutlinedButton(onClick = review, enabled = enabled) { Text("Review", color = Palette.ink, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}
