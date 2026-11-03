package network.calimero.crm.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowCircleUp
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentScope
import com.calimero.mero.PendingApprovals
import com.calimero.mero.confirmationCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.crm.app.CrmViewModel
import network.calimero.crm.core.ErrorText

/** One group of approvals: the person's own apps, or one org's. */
private class ApprovalSection(
    val id: String,
    val title: String,
    val scope: ConsentScope,
    val approvals: PendingApprovals,
) {
    val isEmpty: Boolean get() = approvals.releases.isEmpty() && approvals.upgrades.isEmpty()
}

/** The confirmation code waiting for the person to check, and the answer it waits for. */
private class PendingCode(
    val code: String,
    val answer: CompletableDeferred<Boolean>,
)

/**
 * Node releases and app upgrades waiting for the person, per org (and their own apps), each approved
 * on the node's consent page in a Custom Tab. The app's own session cannot approve anything. Before
 * the page opens, the confirmation code it will show is shown here, so the person can check they
 * match. (iOS: `ApprovalsSheet` in CloudAccess.swift.)
 */
@Composable
fun ApprovalsSheet(
    vm: CrmViewModel,
    orgs: List<Pair<String, String>>,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sections by remember { mutableStateOf<List<ApprovalSection>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var deciding by remember { mutableStateOf<String?>(null) }
    var pendingCode by remember { mutableStateOf<PendingCode?>(null) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(reload) {
        try {
            val next = mutableListOf(ApprovalSection("account", "Your apps", ConsentScope.Account, vm.pendingApprovals()))
            for ((id, name) in orgs) next += ApprovalSection(id, name, ConsentScope(id), vm.pendingApprovals(id))
            sections = next
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            error = ErrorText.describe(e)
            if (sections == null) sections = emptyList()
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
                    val answer = CompletableDeferred<Boolean>()
                    pendingCode = PendingCode(started.code.ifEmpty { confirmationCode(started.requestId) }, answer)
                    answer.await()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = ErrorText.describe(e)
            } finally {
                deciding = null
                reload += 1
            }
        }
    }

    CrmSheet("Approvals", onDismiss, cancelLabel = "Done") {
        ErrorLine(error)
        val loaded = sections
        when {
            loaded == null ->
                Row(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(color = Palette.ink)
                }
            loaded.all { it.isEmpty } -> EmptyState(Icons.Outlined.Verified, "Nothing is waiting for you.")
            else ->
                for (section in loaded.filterNot { it.isEmpty }) {
                    SectionLabel(section.title)
                    for (release in section.approvals.releases) {
                        val key = "${section.id}/r/${release.version}"
                        ApprovalRow(
                            symbol = { Icon(Icons.Outlined.Shield, contentDescription = null, tint = Palette.ink) },
                            title = "Node release ${release.version}",
                            detail =
                                release.deadline?.let { "Approve before ${it.after}" }
                                    ?: "Runs on ${release.nodes} node${if (release.nodes == 1L) "" else "s"}",
                            actionable = release.actionable,
                            deciding = deciding,
                            key = key,
                        ) { review(key, ConsentRequest.Release(section.scope, release.version, vm.consentCallback)) }
                    }
                    for (upgrade in section.approvals.upgrades) {
                        val key = "${section.id}/u/${upgrade.app}"
                        ApprovalRow(
                            symbol = { Icon(Icons.Outlined.ArrowCircleUp, contentDescription = null, tint = Palette.ink) },
                            title = "Update ${upgrade.name ?: upgrade.`package`}",
                            detail = "${upgrade.from} → ${upgrade.to}",
                            actionable = upgrade.actionable,
                            deciding = deciding,
                            key = key,
                        ) { review(key, ConsentRequest.Upgrade(upgrade.app, upgrade.to, vm.consentCallback)) }
                    }
                }
        }
    }

    pendingCode?.let { pending ->
        fun answer(open: Boolean) {
            pendingCode = null
            pending.answer.complete(open)
        }
        AlertDialog(
            onDismissRequest = { answer(false) },
            title = { Text("Confirmation code") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(pending.code, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
                    Text("The approval page will show this code. Approve only if it shows the same code.", color = Palette.ink2)
                }
            },
            confirmButton = { TextButton(onClick = { answer(true) }) { Text("Open the page", color = Palette.ink) } },
            dismissButton = { TextButton(onClick = { answer(false) }) { Text("Cancel", color = Palette.ink2) } },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun ApprovalRow(
    symbol: @Composable () -> Unit,
    title: String,
    detail: String,
    actionable: Boolean,
    deciding: String?,
    key: String,
    onReview: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.size(28.dp), horizontalArrangement = Arrangement.Center) { symbol() }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Text(if (actionable) detail else "Your cluster's operator approves this.", fontSize = 13.sp, color = Palette.ink2)
        }
        if (actionable) {
            if (deciding == key) {
                CircularProgressIndicator(Modifier.size(20.dp), color = Palette.ink, strokeWidth = 2.dp)
            } else {
                SmallButton("Review", onClick = onReview, enabled = deciding == null)
            }
        }
    }
}
