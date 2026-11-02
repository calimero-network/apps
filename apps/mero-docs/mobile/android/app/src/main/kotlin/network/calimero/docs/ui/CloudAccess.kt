package network.calimero.docs.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentStarted
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.docs.app.DocsAppViewModel
import network.calimero.docs.core.DocsFormat
import kotlin.coroutines.cancellation.CancellationException

// Calimero 1.0 sign-in and approvals. (Swift `CloudAccess.swift`: the same views and copy.)
//
// - Cloud: the person's cluster, by name (`eu-shared-1`, its nodes read from the Calimero Cloud
//   directory) or by a node's URL (prefilled from `-PmeroCluster`), then the device's passkey: sign
//   in, or create an account.
// - Development: a `merod local` node (`-PmeroDevNodeUrl`, `http://10.0.2.2:2501` by default) with
//   mock attestation allowed and a software passkey kept on this phone.
// - Approvals: releases and upgrades waiting for the person's decision, approved on the node's own
//   consent page in a Custom Tab (an app's session cannot approve anything itself). The
//   confirmation code the page will show is shown here first.

/** Sign in with a passkey, create an account, or connect to a development node. (Swift `CloudSignInPanel`.) */
@Suppress("LongMethod")
@Composable
fun CloudSignInPanel(vm: DocsAppViewModel) {
    val context = LocalContext.current
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    var cluster by remember { mutableStateOf(vm.lastCluster) }
    var devNode by remember { mutableStateOf(vm.lastDevNode) }
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var showDevelopment by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        error?.let {
            Text(it, style = DocsTheme.body(14, color = DocsTheme.danger), textAlign = TextAlign.Center, modifier = Modifier.testTag("signIn.error"))
        }
        if (!showDevelopment) {
            Field("Cluster", cluster, "eu-shared-1 or https://node.example.com", KeyboardType.Uri, "signIn.cluster") { cluster = it }
        }
        if (creating || showDevelopment) {
            Field("Your name", name, "Ada", KeyboardType.Text, "signIn.name") { name = it }
        }
        when {
            showDevelopment -> {
                Field("Development node", devNode, "http://10.0.2.2:2501", KeyboardType.Uri, "signIn.devNode") { devNode = it }
                Primary("Connect", Icons.Outlined.Dns, enabled = devNode.isNotBlank(), busy = busy, tag = "signIn.connect") {
                    vm.signInDev(devNode, name)
                }
            }
            creating ->
                Primary("Create account", Icons.Outlined.Key, enabled = cluster.isNotBlank() && name.isNotBlank(), busy = busy, tag = "signIn.create") {
                    (context as? Activity)?.let { vm.signInCloud(it, cluster, create = true, name = name) }
                }
            else ->
                Primary("Sign in with passkey", Icons.Outlined.Key, enabled = cluster.isNotBlank(), busy = busy, tag = "signIn.passkey") {
                    (context as? Activity)?.let { vm.signInCloud(it, cluster, create = false, name = "") }
                }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            if (!showDevelopment) {
                TextButton(onClick = { creating = !creating }, enabled = !busy) {
                    Text(if (creating) "I have an account" else "Create an account", style = DocsTheme.body(15, FontWeight.Medium))
                }
            }
            TextButton(onClick = {
                showDevelopment = !showDevelopment
                creating = false
            }, enabled = !busy) {
                Text(if (showDevelopment) "Use Calimero Cloud" else "Development node", style = DocsTheme.body(15, FontWeight.Medium))
            }
        }
        Text(
            if (showDevelopment) {
                "For a node from `merod local`: its mock attestation is trusted and a test passkey is kept on this phone."
            } else {
                "Your passkey stays on this device. Calimero verifies the node before anything is sent."
            },
            style = DocsTheme.body(13, color = DocsTheme.muted),
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Field(
    title: String,
    value: String,
    placeholder: String,
    keyboard: KeyboardType,
    tag: String,
    onChange: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = DocsTheme.body(13, FontWeight.Medium, DocsTheme.muted))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            placeholder = { Text(placeholder, style = DocsTheme.body(16, color = DocsTheme.faint)) },
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = false),
            shape = RoundedCornerShape(12.dp),
            colors =
                OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = DocsTheme.surface,
                    unfocusedContainerColor = DocsTheme.surface,
                    focusedBorderColor = DocsTheme.ink,
                    unfocusedBorderColor = DocsTheme.lineStrong,
                    cursorColor = DocsTheme.ink,
                ),
            modifier = Modifier.fillMaxWidth().testTag(tag),
        )
    }
}

@Composable
private fun Primary(
    title: String,
    icon: ImageVector,
    enabled: Boolean,
    busy: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    PrimaryButton(onClick = onClick, enabled = enabled && !busy, modifier = Modifier.testTag(tag)) {
        if (busy) {
            CircularProgressIndicator(color = DocsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        } else {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(title, style = DocsTheme.body(16, FontWeight.SemiBold, DocsTheme.ink))
        }
    }
}

/** One scope's approvals: the person's own apps, or one workspace. */
private data class ApprovalSection(
    val id: String,
    val title: String,
    val scope: ReportScope,
    val approvals: PendingApprovals,
)

/**
 * Releases and upgrades waiting for the person, per workspace (and their own apps), each approved
 * on the node's consent page in a Custom Tab. (Swift `ApprovalsSheet`.)
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalsSheet(
    vm: DocsAppViewModel,
    orgs: suspend () -> List<Pair<String, String>>,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sections by remember { mutableStateOf<List<ApprovalSection>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var deciding by remember { mutableStateOf<String?>(null) }
    var confirming by remember { mutableStateOf<Pair<ConsentStarted, CompletableDeferred<Boolean>>?>(null) }

    suspend fun load() {
        loading = sections.isEmpty()
        try {
            val next = mutableListOf(ApprovalSection("account", "Your apps", ReportScope.Account, vm.pendingApprovals()))
            for ((id, name) in orgs()) {
                next += ApprovalSection(id, name, ReportScope.org(id), vm.pendingApprovals(id))
            }
            sections = next
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            error = DocsFormat.errorText(e)
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
                vm.requestConsent(context, request) { started ->
                    if (started.code.isNullOrEmpty()) return@requestConsent true
                    val answer = CompletableDeferred<Boolean>()
                    confirming = started to answer
                    answer.await()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = DocsFormat.errorText(e)
            }
            deciding = null
            load()
        }
    }

    LaunchedEffect(Unit) { load() }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = DocsTheme.ground) {
        Text("Approvals", style = DocsTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val empty = sections.all { it.approvals.releases.isEmpty() && it.approvals.upgrades.isEmpty() }
            when {
                loading -> item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DocsTheme.ink) } }
                error != null -> item { Text(error.orEmpty(), style = DocsTheme.body(15, color = DocsTheme.danger)) }
                empty ->
                    item {
                        Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Outlined.Verified, contentDescription = null, tint = DocsTheme.ink, modifier = Modifier.size(28.dp))
                            Spacer(Modifier.size(10.dp))
                            Text("Nothing is waiting for you.", style = DocsTheme.body(15, color = DocsTheme.muted))
                        }
                    }
                else ->
                    for (section in sections) {
                        if (section.approvals.releases.isEmpty() && section.approvals.upgrades.isEmpty()) continue
                        item(key = "h/${section.id}") { SectionLabel(section.title) }
                        items(section.approvals.releases, key = { "${section.id}/r/${it.version}" }) { release ->
                            val key = "${section.id}/r/${release.version}"
                            ApprovalRow(
                                Icons.Outlined.Shield,
                                "Node release ${release.version}",
                                release.deadline?.let { "Approve before ${it.after}" }
                                    ?: "Runs on ${release.nodes} node${if (release.nodes == 1L) "" else "s"}",
                                release.actionable,
                                deciding = deciding,
                                key = key,
                            ) { review(key, releaseConsent(section.scope, release.version, DocsAppViewModel.CONSENT_CALLBACK)) }
                        }
                        items(section.approvals.upgrades, key = { "${section.id}/u/${it.app}" }) { upgrade ->
                            val key = "${section.id}/u/${upgrade.app}"
                            ApprovalRow(
                                Icons.Outlined.ArrowCircleUp,
                                "Update ${upgrade.name ?: upgrade.`package`}",
                                "${upgrade.from} → ${upgrade.to}",
                                upgrade.actionable,
                                deciding = deciding,
                                key = key,
                            ) { review(key, upgradeConsent(upgrade.app, upgrade.to, DocsAppViewModel.CONSENT_CALLBACK)) }
                        }
                    }
            }
        }
        Spacer(Modifier.size(8.dp))
    }

    confirming?.let { (started, answer) ->
        fun close(go: Boolean) {
            confirming = null
            answer.complete(go)
        }
        AlertDialog(
            onDismissRequest = { close(false) },
            title = { Text("Check the code") },
            text = { Text("The approval page will show ${started.code}. Continue only if it shows the same code.") },
            confirmButton = { TextButton(onClick = { close(true) }) { Text("Continue") } },
            dismissButton = { TextButton(onClick = { close(false) }) { Text("Cancel") } },
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
    deciding: String?,
    key: String,
    onReview: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().card(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = DocsTheme.ink, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = DocsTheme.body(16, FontWeight.Medium))
            Text(if (actionable) detail else "Your cluster's operator approves this.", style = DocsTheme.body(13, color = DocsTheme.muted))
        }
        if (actionable) {
            if (deciding == key) {
                CircularProgressIndicator(color = DocsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            } else {
                SecondaryButton(onClick = onReview, fullWidth = false, modifier = Modifier.testTag("approvals.review")) {
                    Text("Review", style = DocsTheme.body(15, FontWeight.SemiBold))
                }
            }
        }
    }
}
