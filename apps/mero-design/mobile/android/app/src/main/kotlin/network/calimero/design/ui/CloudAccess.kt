package network.calimero.design.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.calimero.mero.ConsentRequest
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.design.app.DesignAppViewModel
import network.calimero.design.core.DesignFormat

// Calimero 1.0 sign-in and approvals. (iOS `SignInView` + `ApprovalsCard` / `ApprovalsModel`.)

/** How the sign-in form is set. */
private enum class SignInMode { SIGN_IN, CREATE, DEVELOPMENT }

/**
 * Calimero Cloud (the cluster's name, looked up in the Calimero directory, or a node URL of it,
 * then the device's passkey; "Create an account" registers a new one), or a development node
 * (`merod local`, mock attestation allowed, a software passkey kept on this phone).
 */
@Composable
fun SignInForm(
    vm: DesignAppViewModel,
    activity: Context,
) {
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    var mode by remember { mutableStateOf(SignInMode.SIGN_IN) }
    var cluster by remember { mutableStateOf(vm.defaultCluster) }
    var devNode by remember { mutableStateOf(vm.defaultDevNode) }
    var name by remember { mutableStateOf("") }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (mode == SignInMode.DEVELOPMENT) {
            FieldLabel("Development node URL")
            Field(devNode, { devNode = it }, "http://10.0.2.2:2501", KeyboardType.Uri)
            FieldLabel("Your name")
            Field(name, { name = it }, "e.g. Ada")
            Text(
                "For a `merod local` cluster: mock attestation is allowed and a passkey is kept on this device for that node.",
                style = DesignTheme.body(13, color = DesignTheme.muted),
            )
        } else {
            FieldLabel("Cluster")
            Field(cluster, { cluster = it }, "your-cluster, or https://node.example", KeyboardType.Uri)
            if (mode == SignInMode.CREATE) {
                FieldLabel("Your name")
                Field(name, { name = it }, "e.g. Ada Lovelace")
            }
        }
        error?.let { Text(it, style = DesignTheme.body(14, color = DesignTheme.danger)) }
        val canSubmit =
            when (mode) {
                SignInMode.SIGN_IN -> cluster.isNotBlank()
                SignInMode.CREATE -> cluster.isNotBlank() && name.isNotBlank()
                SignInMode.DEVELOPMENT -> devNode.isNotBlank()
            }
        PrimaryButton(
            onClick = {
                when (mode) {
                    SignInMode.SIGN_IN -> vm.signInCloud(activity, cluster, create = false, name = "")
                    SignInMode.CREATE -> vm.signInCloud(activity, cluster, create = true, name = name)
                    SignInMode.DEVELOPMENT -> vm.signInDev(devNode, name)
                }
            },
            enabled = canSubmit && !busy,
        ) {
            if (busy) {
                CircularProgressIndicator(color = DesignTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
            }
            val title =
                when (mode) {
                    SignInMode.SIGN_IN -> if (busy) "Waiting for your passkey…" else "Sign in with passkey"
                    SignInMode.CREATE -> if (busy) "Creating your account…" else "Create account"
                    SignInMode.DEVELOPMENT -> if (busy) "Connecting…" else "Connect"
                }
            Text(title, style = DesignTheme.body(16, FontWeight.SemiBold, DesignTheme.ink))
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            when (mode) {
                SignInMode.SIGN_IN -> LinkButton("Create an account", busy) { mode = SignInMode.CREATE }
                SignInMode.CREATE -> LinkButton("I have an account", busy) { mode = SignInMode.SIGN_IN }
                SignInMode.DEVELOPMENT -> LinkButton("Use Calimero Cloud", busy) { mode = SignInMode.SIGN_IN }
            }
            Spacer(Modifier.weight(1f))
            if (mode != SignInMode.DEVELOPMENT) LinkButton("Development node", busy) { mode = SignInMode.DEVELOPMENT }
        }
        Text(
            "Your boards live on your team's Calimero cluster. This phone holds no node; it signs in with a passkey.",
            style = DesignTheme.body(12, color = DesignTheme.faint),
        )
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text.uppercase(), style = DesignTheme.body(12, FontWeight.SemiBold, DesignTheme.muted))
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(placeholder, style = DesignTheme.body(16, color = DesignTheme.faint)) },
        singleLine = true,
        textStyle = DesignTheme.body(16),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = false),
        shape = RoundedCornerShape(12.dp),
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedContainerColor = DesignTheme.surface,
                unfocusedContainerColor = DesignTheme.surface,
                focusedBorderColor = DesignTheme.ink,
                unfocusedBorderColor = DesignTheme.line,
                cursorColor = DesignTheme.ink,
            ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LinkButton(
    text: String,
    busy: Boolean,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = !busy) {
        Text(text, style = DesignTheme.body(14, FontWeight.SemiBold, DesignTheme.ink))
    }
}

/** One thing waiting for the person's approval. (Swift `ApprovalsModel.Item`.) */
data class ApprovalItem(
    val id: String,
    val title: String,
    val detail: String,
    val upgrade: Boolean,
    val request: (returnTo: String) -> ConsentRequest,
) {
    companion object {
        /** The actionable items of one scope: upgrades of this app's package, and node releases. */
        fun from(
            pending: PendingApprovals,
            org: String?,
        ): List<ApprovalItem> {
            val upgrades =
                pending.upgrades.filter { it.actionable && it.`package` == DesignFormat.PACKAGE_NAME }.map { u ->
                    ApprovalItem(
                        "upgrade:${u.app}:${u.to}",
                        "Mero Design ${u.to} is available",
                        "${u.name ?: "An app instance"} runs ${u.from}. Review the update to keep it current.",
                        upgrade = true,
                    ) { upgradeConsent(u.app, u.to, it) }
                }
            val releases =
                pending.releases.filter { it.actionable }.map { r ->
                    ApprovalItem(
                        "release:${org ?: "-"}:${r.version}",
                        "Node release ${r.version} needs your approval",
                        r.deadline?.let { "New work stops after ${it.after} until it's approved." }
                            ?: "Your cluster's nodes run a release you haven't approved yet.",
                        upgrade = false,
                    ) { releaseConsent(org?.let { o -> ReportScope.org(o) } ?: ReportScope.Account, r.version, it) }
                }
            return upgrades + releases
        }
    }
}

/**
 * What waits for the person's approval (an update of Mero Design, a node release): "Review" shows
 * the confirmation code, then opens the node's consent page in a Custom Tab. Nothing shows when
 * there is nothing to approve.
 */
@Suppress("LongMethod")
@Composable
fun ApprovalsCard(
    vm: DesignAppViewModel,
    activity: Context,
    orgs: List<String>,
) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<ApprovalItem>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var approving by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf<Pair<String, CompletableDeferred<Boolean>>?>(null) }

    suspend fun load() {
        val found = mutableListOf<ApprovalItem>()
        for (org in listOf<String?>(null) + orgs) {
            val pending =
                try {
                    vm.pendingApprovals(org)
                } catch (e: CancellationException) {
                    throw e
                } catch (
                    @Suppress("TooGenericExceptionCaught") e: Exception,
                ) {
                    continue
                }
            found += ApprovalItem.from(pending, org)
        }
        items = found.distinctBy { it.id }
    }

    LaunchedEffect(orgs) { load() }

    if (items.isEmpty() && error == null) return
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        error?.let { Text(it, style = DesignTheme.body(14, color = DesignTheme.danger)) }
        items.forEach { item ->
            Row(Modifier.fillMaxWidth().card(14.dp), verticalAlignment = Alignment.Top) {
                Box(
                    Modifier
                        .size(36.dp)
                        .background(DesignTheme.lime.copy(alpha = 0.35f), RoundedCornerShape(10.dp))
                        .border(DesignTheme.hairline, DesignTheme.line, RoundedCornerShape(10.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (item.upgrade) Icons.Outlined.ArrowCircleUp else Icons.Outlined.VerifiedUser,
                        contentDescription = null,
                        tint = DesignTheme.ink,
                        modifier = Modifier.size(18.dp),
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(item.title, style = DesignTheme.body(15, FontWeight.SemiBold))
                    Text(item.detail, style = DesignTheme.body(13, color = DesignTheme.muted))
                }
                Spacer(Modifier.width(8.dp))
                SecondaryButton(
                    onClick = {
                        scope.launch {
                            approving = item.id
                            error = null
                            try {
                                vm.requestConsent(activity, item.request(vm.consentCallback)) { started ->
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
                                error = DesignFormat.errorText(e)
                            } finally {
                                approving = null
                            }
                            load()
                        }
                    },
                    fullWidth = false,
                ) {
                    if (approving == item.id) {
                        CircularProgressIndicator(color = DesignTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                    } else {
                        Text("Review")
                    }
                }
            }
        }
    }

    code?.let { (shown, answer) ->
        fun close(ok: Boolean) {
            code = null
            answer.complete(ok)
        }
        AlertDialog(
            onDismissRequest = { close(false) },
            title = { Text("Check the code") },
            text = { Text("The approval page will show $shown. Continue only if it shows this code.") },
            confirmButton = { TextButton(onClick = { close(true) }) { Text("Continue") } },
            dismissButton = { TextButton(onClick = { close(false) }) { Text("Cancel") } },
        )
    }
}
