package network.calimero.vote.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.Anchor
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.vote.core.AuditCheck
import network.calimero.vote.core.PollModel
import network.calimero.vote.core.VoteErrorText
import network.calimero.vote.core.VoteFormat
import network.calimero.vote.generated.AuditReport
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.TrusteeStatus

/**
 * The t-of-n key ceremony and the tally, from one trustee's seat, plus the creator's "Open
 * voting". Every secret stays on this device.
 */
@Composable
fun TrusteeCard(
    model: PollModel,
    label: (String) -> String,
) {
    val view = model.view.collectAsState().value ?: return
    val busy by model.busy.collectAsState()
    val scope = rememberCoroutineScope()
    val def = view.definition
    val phase = view.state.phase
    val t = def.threshold.toInt()
    val n = def.trustees.size
    Panel {
        CardHead(
            Icons.Filled.Key,
            "Trustees",
            if (n == 1) {
                "One trustee holds the whole decryption key — fine for a quick poll, not for a secret one."
            } else {
                "Any $t of these $n can decrypt the totals together; fewer than $t learn nothing, and no one ever holds the whole key."
            },
            accent = phase == Phase.KeyCeremony,
        ) { Badge("$t of $n", strong = false) }
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            view.trustees.forEach { TrusteeRow(model, it, phase, label) }
        }
        if (model.amTrustee) TrusteeBox(model, phase, label)
        if (model.isCreator && phase == Phase.KeyCeremony) {
            Hairline()
            Text(model.ceremonyStatus, fontSize = 14.sp, color = Palette.Muted)
            PrimaryButton(
                if (busy == "open") "Opening…" else "Open voting",
                { scope.launch { model.openVoting() } },
                enabled = model.canOpenVoting,
                busy = busy == "open",
            )
        }
        view.state.election?.disqualified?.takeIf { it.isNotEmpty() }?.let { out ->
            Callout(Tone.WARNING, "Left out of the key by proven complaint: ${out.joinToString(", ") { label(it) }}.")
        }
    }
}

@Composable
private fun TrusteeRow(
    model: PollModel,
    x: TrusteeStatus,
    phase: Phase,
    label: (String) -> String,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.Ground)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(label(x.account), seed = x.account, size = 30.dp)
            Spacer(Modifier.width(10.dp))
            Text(label(x.account) + if (x.account == model.account) " (you)" else "", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
        }
        StatusRow("Transport key") { StatusWord(x.transportPublished, waiting = true, doneText = "Published") }
        StatusRow("Shares dealt") {
            when {
                x.qualified == false && x.complaintsAgainst == 0u -> Badge("Not in key", strong = false)
                x.qualified == false -> TonePill("Disqualified", Palette.DangerSoft, Palette.Danger, Icons.Filled.Close)
                x.complaintsAgainst > 0u ->
                    TonePill(
                        "${x.complaintsAgainst} complaint${if (x.complaintsAgainst > 1u) "s" else ""}",
                        Palette.DangerSoft,
                        Palette.Danger,
                        Icons.Outlined.Warning,
                    )
                else -> StatusWord(x.dealingPublished, waiting = phase == Phase.KeyCeremony, doneText = "Dealt")
            }
        }
        StatusRow("Decryption") { StatusWord(x.partialPublished, waiting = phase == Phase.Closed, doneText = "Published") }
    }
}

@Composable
private fun StatusRow(
    label: String,
    value: @Composable () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, color = Palette.Muted, modifier = Modifier.weight(1f))
        value()
    }
}

@Composable
private fun TrusteeBox(
    model: PollModel,
    phase: Phase,
    label: (String) -> String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val busy by model.busy.collectAsState()
    val key by model.trusteeKey.collectAsState()
    val ceremony by model.ceremony.collectAsState()
    val mine = model.mine
    var restoring by remember { mutableStateOf(false) }
    Hairline()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        if (phase == Phase.KeyCeremony && mine?.transportPublished != true) {
            Step(
                "Step 1 of 2",
                "Publish a transport key",
                "Publish a transport key so the other trustees can send you your share privately. Its secret stays on this device.",
            )
            PrimaryButton(
                if (busy == "transport") "Publishing…" else "Publish my transport key",
                { scope.launch { model.publishTransportKey() } },
                enabled = busy == null,
                busy = busy == "transport",
                icon = Icons.Filled.Key,
            )
        }
        if (phase == Phase.KeyCeremony && mine?.transportPublished == true && !mine.dealingPublished) {
            Step(
                "Step 2 of 2",
                "Deal key shares",
                "Deal shares of a fresh random secret to every trustee." + if (model.allTransport) "" else " Waiting for every trustee's transport key.",
            )
            PrimaryButton(
                if (busy == "deal") "Dealing…" else "Deal my key shares",
                { scope.launch { model.publishDealing() } },
                enabled = busy == null && model.allTransport && ceremony != null && key != null,
                busy = busy == "deal",
            )
        }
        val received = model.received
        if (phase == Phase.KeyCeremony && received.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionLabel("Shares dealt to you")
                received.forEach { r ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (r.ok) Icons.Filled.Check else Icons.Filled.Close,
                            contentDescription = if (r.ok) "Valid" else "Invalid",
                            tint = if (r.ok) Palette.Success else Palette.Danger,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("share from ${label(r.dealer)}", fontSize = 14.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                        if (!r.ok && !r.complained) {
                            TextButton(onClick = { scope.launch { model.complain(r.dealer, label(r.dealer)) } }, enabled = busy == null) {
                                Text("File complaint", color = Palette.Danger, fontWeight = FontWeight.SemiBold)
                            }
                        }
                        if (r.complained) Text("complaint filed", fontSize = 13.sp, color = Palette.Muted)
                    }
                }
            }
        }
        if (mine?.transportPublished == true && key == null && !mine.partialPublished) {
            Callout(
                Tone.WARNING,
                "This device does not hold your trustee key. Restore it from your backup, or you cannot take part in the decryption.",
            )
        }
        if (phase == Phase.Closed && mine?.partialPublished != true && key != null) {
            Step(null, "Your decryption share is needed", "It decrypts only the per-option totals, never a single ballot.")
            PrimaryButton(
                if (busy == "partial") "Decrypting…" else "Publish my decryption share",
                { scope.launch { model.publishPartial(label) } },
                enabled = busy == null,
                busy = busy == "partial",
                icon = Icons.Filled.Key,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            key?.let { k ->
                SecondaryButton("Save key backup", { share(context, k.json(), k.backupFileName) }, compact = true, icon = Icons.Outlined.Share)
            }
            if (mine?.transportPublished == true && !mine.partialPublished) {
                SecondaryButton("Restore key from backup", { restoring = true }, compact = true, icon = Icons.Outlined.Download)
            }
        }
    }
    if (restoring) RestoreKeySheet(model) { restoring = false }
}

@Composable
private fun Step(
    badge: String?,
    title: String,
    hint: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (badge != null) {
                Badge(badge)
                Spacer(Modifier.width(8.dp))
            }
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
        }
        Text(hint, fontSize = 14.sp, color = Palette.Muted)
    }
}

/** Put a trustee key back: paste the backup's text, or choose the file. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RestoreKeySheet(
    model: PollModel,
    dismiss: () -> Unit,
) {
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val pick =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) } }
                    .getOrNull()
                    ?.let { text = it }
            }
        }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar("Restore key", "Restore", canAct = text.isNotBlank(), busy = false, cancel = dismiss, act = {
                runCatching { model.restoreKey(text) }
                    .onSuccess { dismiss() }
                    .onFailure { error = VoteErrorText.describe(it) }
            })
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextField(
                    value = text,
                    onValueChange = { text = it },
                    placeholder = { Text("Paste the backup's text", fontFamily = FontFamily.Monospace) },
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, color = Palette.Ink),
                    minLines = 4,
                    maxLines = 8,
                    colors = filledFieldColors(),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                SecondaryButton("Choose file", { pick.launch(arrayOf("application/json", "text/plain", "*/*")) }, compact = true, icon = Icons.Outlined.Description)
                Text("The backup is the mero-vote-trustee-….json file you saved, from this app or the web app.", fontSize = 13.sp, color = Palette.Muted)
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** The counts, decrypted from the totals only. */
@Composable
fun ResultCard(
    model: PollModel,
    report: AuditReport,
    label: (String) -> String,
) {
    val options = model.definition?.options.orEmpty()
    val counts = report.counts
    val total = counts?.fold(0uL) { a, b -> a + b } ?: 0uL
    val n = report.countedBallots.toULong()
    val denom = if (n > 0uL) n else maxOf(total, 1uL)
    val top = counts?.maxOrNull() ?: 0uL
    val winners = if (counts != null && top > 0uL) options.indices.filter { counts.getOrNull(it) == top } else emptyList()
    val ballots = VoteFormat.count(report.countedBallots.toInt(), "ballot", "ballots")
    Panel {
        CardHead(
            Icons.Filled.BarChart,
            "Result",
            if (counts != null) "$ballots · ${VoteFormat.count(total.toInt(), "selection", "selections")}" else null,
            accent = counts != null,
        ) { if (report.verified) VerifiedPill() }
        if (counts != null && top > 0uL) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("${VoteFormat.percent(top, denom)}%", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = Palette.Ink)
                Spacer(Modifier.width(10.dp))
                Text(
                    (if (winners.size == 1) "${options[winners[0]]} has the most votes" else "A tie between ${winners.joinToString(", ") { options[it] }}") +
                        ", $top of $ballots.",
                    fontSize = 15.sp,
                    color = Palette.InkSoft,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
            }
        }
        if (counts != null) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                options.forEachIndexed { i, option ->
                    val c = counts.getOrElse(i) { 0uL }
                    val winner = top > 0uL && c == top
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(option, fontSize = 15.sp, fontWeight = if (winner) FontWeight.SemiBold else FontWeight.Normal, color = Palette.Ink, maxLines = 2)
                            if (winner) {
                                Spacer(Modifier.width(8.dp))
                                Badge("Most votes")
                            }
                            Spacer(Modifier.weight(1f))
                            Text("$c", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                            Text("${VoteFormat.percent(c, denom)}%", fontSize = 13.sp, color = Palette.Muted, textAlign = TextAlign.End, modifier = Modifier.widthIn(min = 38.dp))
                        }
                        val fraction = (c.toDouble() / maxOf(denom, top, 1uL).toDouble()).coerceIn(0.0, 1.0).toFloat()
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(8.dp)
                                .clip(CircleShape)
                                .background(Palette.Sunken),
                        ) {
                            if (fraction > 0f) {
                                Box(
                                    Modifier
                                        .fillMaxWidth(fraction)
                                        .fillMaxHeight()
                                        .clip(CircleShape)
                                        .background(if (winner) Palette.Ink else Palette.InkSoft.copy(alpha = 0.55f)),
                                )
                            }
                        }
                    }
                }
            }
            Text(
                "Decrypted from the totals only, by ${report.decryptedBy.joinToString(" + ") { label(it) }}. No single ballot was ever decrypted.",
                fontSize = 13.sp,
                color = Palette.Muted,
            )
        } else if (report.verified) {
            val t = model.definition?.threshold?.toInt() ?: 0
            Callout(
                Tone.INFO,
                "$ballots counted. ${model.publishedPartials} of the $t decryption share${if (t == 1) "" else "s"} needed are in.",
                icon = Icons.Outlined.Schedule,
            )
        } else {
            Callout(Tone.DANGER, "This poll does not verify — see the audit below. No result is shown for it.")
        }
    }
}

/** Every check the node ran, and the same checks re-run on this device. */
@Composable
fun AuditCard(
    model: PollModel,
    report: AuditReport,
    label: (String) -> String,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val busy by model.busy.collectAsState()
    val local by model.localAudit.collectAsState()
    Panel {
        CardHead(
            Icons.Filled.VerifiedUser,
            "Audit",
            "Your node recomputed all of this from the frozen ballots just now. Nothing here is a stored conclusion.",
        )
        if (report.verified) {
            Callout(Tone.SUCCESS, "The node re-verified every proof, from the key ceremony to the decryption.", title = "Every check passed")
        } else {
            Callout(Tone.DANGER, "At least one check below failed. A poll is only as good as its worst check.", title = "This poll does not verify")
        }
        Disclosure("Show the checks (${report.checks.size})") { CheckList(report.checks.map { AuditCheck(it.name, it.ok, it.detail) }) }
        if (report.uncounted.isNotEmpty()) {
            Callout(
                Tone.WARNING,
                "Not in the sealed count: ${report.uncounted.joinToString(", ") { label(it) }} — their ballot reached this node after the seal, or the creator left it out.",
            )
        }
        PrimaryButton(
            if (busy == "verify") "Re-verifying…" else "Re-verify on this device",
            { scope.launch { model.reverify() } },
            enabled = busy == null,
            busy = busy == "verify",
            icon = Icons.Outlined.VerifiedUser,
        )
        SecondaryButton("Share transcript", {
            scope.launch {
                runCatching { model.transcriptJson() }
                    .onSuccess {
                        share(context, it, "mero-vote-transcript-${model.pollId.take(12)}.json")
                    }.onFailure { model.error.value = VoteErrorText.describe(it) }
            }
        }, icon = Icons.Outlined.Share)
        local?.let { audit ->
            val good = audit.verified && audit.agreesWithNode
            Callout(
                if (good) Tone.SUCCESS else Tone.DANGER,
                "Checked from the raw transcript with an independent implementation.",
                title =
                    when {
                        good -> "This device independently reproduced the node's result."
                        audit.agreesWithNode -> "The poll does not verify here either."
                        else -> "This device disagrees with the node."
                    },
            )
            Disclosure("Details") { CheckList(audit.checks) }
        }
    }
}

@Composable
private fun CheckList(checks: List<AuditCheck>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        checks.forEach { c ->
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.size(20.dp).clip(CircleShape).background(if (c.ok) Palette.SuccessSoft else Palette.DangerSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (c.ok) Icons.Filled.Check else Icons.Filled.Close,
                        contentDescription = if (c.ok) "passed" else "failed",
                        tint = if (c.ok) Palette.Success else Palette.Danger,
                        modifier = Modifier.size(12.dp),
                    )
                }
                Column(Modifier.padding(start = 10.dp)) {
                    Text(c.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                    Text(c.detail, fontSize = 13.sp, color = Palette.Muted)
                }
            }
        }
    }
}

/** The transcript digest, held to a public record outside the group. */
@Composable
fun AnchorCard(
    model: PollModel,
    report: AuditReport,
) {
    var recording by remember { mutableStateOf(false) }
    Panel {
        CardHead(Icons.Outlined.Anchor, "Public anchor", if (report.anchor == null) "Hold the result to a digest published outside this group." else null)
        val anchor = report.anchor
        if (anchor != null) {
            CopyRow("Digest", anchor.digest)
            CopyRow("Network", anchor.network)
            CopyRow("Reference", anchor.reference)
        } else {
            Text(
                "Publish the transcript digest somewhere outside this group — a transaction memo, a signed git tag, a post — then record where. Anyone given the transcript can then check it against that public digest.",
                fontSize = 14.sp,
                color = Palette.Muted,
            )
            SecondaryButton("Record anchor", { recording = true })
        }
    }
    if (recording) AnchorSheet(model) { recording = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AnchorSheet(
    model: PollModel,
    dismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val busy by model.busy.collectAsState()
    val error by model.error.collectAsState()
    var network by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface, dragHandle = null) {
        Column(Modifier.imePadding()) {
            SheetBar("Record anchor", "Record", canAct = network.isNotBlank() && reference.isNotBlank(), busy = busy == "anchor", cancel = dismiss, act = {
                scope.launch {
                    model.anchor(network, reference)
                    if (model.error.value == null) dismiss()
                }
            })
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                LabelledField("Network", network, "ethereum:sepolia, git, web") { network = it }
                LabelledField("Reference", reference, "tx hash, URL, tag") { reference = it }
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun LabelledField(
    title: String,
    value: String,
    placeholder: String,
    onChange: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted)
        FilledField(value, onChange, placeholder)
    }
}
