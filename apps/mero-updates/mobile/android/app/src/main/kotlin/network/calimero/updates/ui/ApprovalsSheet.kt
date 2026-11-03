package network.calimero.updates.ui

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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.ConsentRequest
import com.calimero.mero.PendingApprovals
import com.calimero.mero.ReportScope
import com.calimero.mero.confirmationCode
import com.calimero.mero.releaseConsent
import com.calimero.mero.upgradeConsent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import network.calimero.updates.app.UpdatesViewModel
import network.calimero.updates.core.ErrorText

/** One scope's pending list: the account's own apps, or one company (org). */
private data class ApprovalScope(
    val id: String,
    val title: String,
    val scope: ReportScope,
    val approvals: PendingApprovals,
)

/**
 * Releases and upgrades waiting for the person, per company (and their own apps), each approved on
 * the node's consent page in a Custom Tab after the app showed the request's confirmation code
 * (the page shows the same one). (Swift `ApprovalsSheet`.)
 */
@Suppress("LongMethod")
@Composable
fun ApprovalsSheet(
    vm: UpdatesViewModel,
    companies: List<Pair<String, String>>,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val returned by vm.consentResult.collectAsState()
    var sections by remember { mutableStateOf<List<ApprovalScope>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var deciding by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf<String?>(null) }
    var answer by remember { mutableStateOf<CompletableDeferred<Boolean>?>(null) }

    suspend fun load() {
        try {
            val next = mutableListOf(ApprovalScope("account", "Your apps", ReportScope.Account, vm.pendingApprovals(null)))
            for ((id, title) in companies) next += ApprovalScope(id, title, ReportScope.org(id), vm.pendingApprovals(id))
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
        request: (String) -> ConsentRequest,
    ) {
        deciding = key
        scope.launch {
            try {
                vm.requestConsent(context, request) { started ->
                    val waiting = CompletableDeferred<Boolean>()
                    answer = waiting
                    code = started.code.ifEmpty { confirmationCode(started.requestId) }
                    waiting.await()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                error = ErrorText.describe(e)
            } finally {
                deciding = null
                code = null
            }
        }
    }

    fun decide(proceed: Boolean) {
        code = null
        answer?.complete(proceed)
        answer = null
    }

    // On open, and again when the consent page sent the person back.
    LaunchedEffect(returned) { load() }

    UpdatesSheet("Approvals", onDismiss) {
        val shown = sections
        when {
            error != null -> ErrorLine(error)
            shown == null -> SkeletonCard(72.dp)
            shown.all { it.approvals.releases.isEmpty() && it.approvals.upgrades.isEmpty() } ->
                UpdatesCard { EmptyState(Icons.Outlined.Verified, "Nothing is waiting for you", "Node releases and app updates that need your approval show up here.") }
            else -> {
                for (section in shown) {
                    if (section.approvals.releases.isEmpty() && section.approvals.upgrades.isEmpty()) continue
                    SectionLabel(section.title)
                    UpdatesCard {
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            for (release in section.approvals.releases) {
                                val key = "${section.id}/r/${release.version}"
                                ApprovalRow(
                                    Icons.Outlined.Shield,
                                    "Node release ${release.version}",
                                    release.deadline?.let { "Approve before ${it.after}" }
                                        ?: "Runs on ${release.nodes} node${if (release.nodes == 1L) "" else "s"}",
                                    release.actionable,
                                    busy = deciding == key,
                                    enabled = deciding == null,
                                ) { review(key) { releaseConsent(section.scope, release.version, it) } }
                            }
                            for (upgrade in section.approvals.upgrades) {
                                val key = "${section.id}/u/${upgrade.app}"
                                ApprovalRow(
                                    Icons.Outlined.ArrowCircleUp,
                                    "Update ${upgrade.name ?: upgrade.`package`}",
                                    "${upgrade.from} → ${upgrade.to}",
                                    upgrade.actionable,
                                    busy = deciding == key,
                                    enabled = deciding == null,
                                ) { review(key) { upgradeConsent(upgrade.app, upgrade.to, it) } }
                            }
                        }
                    }
                }
            }
        }
    }

    code?.let { shown ->
        AlertDialog(
            onDismissRequest = { decide(false) },
            title = { Text("Confirmation code", style = displayStyle(20.sp)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(shown, fontFamily = FontFamily.Monospace, fontSize = 26.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink)
                    Text("Your node's approval page will show this code. Approve only if it shows the same code.", color = Palette.ink2)
                }
            },
            confirmButton = { PrimaryButton("Open approval page", onClick = { decide(true) }, compact = true) },
            dismissButton = { LinkButton("Cancel", onClick = { decide(false) }) },
            containerColor = Palette.surface,
        )
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
        Icon(icon, contentDescription = null, tint = Palette.ink, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).padding(end = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, fontWeight = FontWeight.Medium, fontSize = 16.sp, color = Palette.ink)
            Text(if (actionable) detail else "Your cluster's operator approves this.", fontSize = 13.sp, color = Palette.ink2)
        }
        if (actionable) {
            if (busy) {
                CircularProgressIndicator(Modifier.size(20.dp), color = Palette.ink, strokeWidth = 2.dp)
            } else {
                SecondaryButton("Review", onClick = review, enabled = enabled, compact = true)
            }
        }
    }
}
