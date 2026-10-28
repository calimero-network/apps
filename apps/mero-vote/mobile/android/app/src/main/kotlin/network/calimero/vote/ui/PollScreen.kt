package network.calimero.vote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.vote.core.GroupModel
import network.calimero.vote.core.LoadPhase
import network.calimero.vote.core.PollModel
import network.calimero.vote.core.VoteFormat
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollView

private enum class Confirm { CLOSE, SEAL }

/** One poll: where it stands, your ballot, the trustees, the result and its audit. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PollScreen(
    model: PollModel,
    back: () -> Unit,
) {
    val group = remember(model) { GroupModel(model.backend, model.group) }
    val view by model.view.collectAsState()
    val phase by model.phase.collectAsState()
    // Read so derived values on the model recompose with them.
    val report by model.report.collectAsState()
    model.ceremony.collectAsState().value
    model.selection.collectAsState().value
    model.busy.collectAsState().value
    model.trusteeKey.collectAsState().value
    model.localAudit.collectAsState().value
    group.roster.collectAsState().value
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    LaunchedEffect(model) {
        launch { group.refresh() }
        model.load()
    }
    LaunchedEffect(model) { model.watch() }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = { VoteTopBar(title = "Poll", navigation = { BackButton(back) }) },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.load()
                    group.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                val v = view
                when (val p = phase) {
                    LoadPhase.Loading -> items(2) { SkeletonCard() }
                    is LoadPhase.Failed -> item { ErrorState(p.message) { scope.launch { model.load() } } }
                    LoadPhase.Loaded ->
                        if (v != null) {
                            val label = group::label
                            item { Hero(model, v, label) }
                            if (!model.trusteesLast) item { TrusteeCard(model, label) }
                            if (v.state.phase == Phase.Voting) item { BallotCard(model, v) }
                            val r = report
                            if (v.state.phase == Phase.Closed && r != null) {
                                item { ResultCard(model, r, label) }
                                item { AuditCard(model, r, label) }
                                if (r.anchor != null || (model.isCreator && r.counts != null)) item { AnchorCard(model, r) }
                            }
                            if (model.trusteesLast) item { TrusteeCard(model, label) }
                            if (v.state.phase != Phase.KeyCeremony) item { TurnoutCard(model, v, label) { confirm = it } }
                            item {
                                Card {
                                    Box(Modifier.padding(horizontal = 16.dp)) {
                                        DetailsDisclosure(
                                            listOf(
                                                "Poll id" to model.pollId,
                                                "Election key" to (v.state.election?.key ?: ""),
                                                "Transcript digest" to (r?.transcriptDigest ?: ""),
                                                "Your receipt" to (v.myDigest ?: ""),
                                            ),
                                        )
                                    }
                                }
                            }
                        }
                }
            }
        }
    }

    confirm?.let { which ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (which == Confirm.CLOSE) "Close this poll?" else "Seal the count?") },
            text = { Text(if (which == Confirm.CLOSE) "No new ballots are accepted after this." else "The ballots your node holds now are frozen and counted.") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    scope.launch { if (which == Confirm.CLOSE) model.closePoll() else model.sealPoll() }
                }) { Text(if (which == Confirm.CLOSE) "Close poll" else "Seal", color = Palette.Danger, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel", color = Palette.Ink) } },
            containerColor = Palette.Surface,
        )
    }
}

/** A white card holding a column of spaced content. */
@Composable
fun Panel(content: @Composable ColumnScope.() -> Unit) = SectionCard(content)

@Composable
private fun Hero(
    model: PollModel,
    view: PollView,
    label: (String) -> String,
) {
    val def = view.definition
    val note by model.note.collectAsState()
    val error by model.error.collectAsState()
    Panel {
        PhaseBadge(view.state.phase)
        Text(def.title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 24.sp, color = Palette.Ink)
        if (def.description.isNotEmpty()) Text(def.description, fontSize = 16.sp, color = Palette.InkSoft)
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Fact(Icons.Outlined.Person, "Created by ${label(def.creator)}")
            Fact(Icons.Filled.Check, VoteFormat.ruleText(def.minChoices, def.maxChoices))
            Fact(Icons.Outlined.Group, if (def.voters.isEmpty()) "Every member can vote." else "${def.voters.size} eligible voters.")
            def.closesAt?.let { Fact(Icons.Outlined.Event, "Planned close ${VoteFormat.date(it)}") }
        }
        Steps(view.state.phase)
        SuccessBanner(note) { model.note.value = null }
        NoticeBanner(error) { model.error.value = null }
    }
}

@Composable
private fun Fact(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Palette.InkSoft, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, fontSize = 14.sp, color = Palette.InkSoft)
    }
}

@Composable
private fun Steps(phase: Phase) {
    val at = VoteFormat.stepIndex(phase)
    Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
        VoteFormat.steps.forEachIndexed { i, step ->
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(
                            if (i < at) {
                                Palette.Ink
                            } else if (i == at) {
                                Palette.Lime
                            } else {
                                Palette.Sunken
                            },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (i < at) {
                        Icon(Icons.Filled.Check, contentDescription = null, tint = Palette.Lime, modifier = Modifier.size(13.dp))
                    } else {
                        Text("${i + 1}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (i == at) Palette.Ink else Palette.Muted)
                    }
                }
                Spacer(Modifier.size(6.dp))
                Text(
                    step.second,
                    fontSize = 11.sp,
                    fontWeight = if (i == at) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (i <= at) Palette.Ink else Palette.Muted,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun BallotCard(
    model: PollModel,
    view: PollView,
) {
    val scope = rememberCoroutineScope()
    val def = view.definition
    val single = VoteFormat.isSingleChoice(def)
    val rule = VoteFormat.ruleText(def.minChoices, def.maxChoices)
    val selection by model.selection.collectAsState()
    val busy by model.busy.collectAsState()
    Panel {
        CardHead(
            Icons.Filled.Lock,
            if (view.myDigest == null) "Your ballot" else "Change your vote",
            if (view.canVote) "$rule Your choice is encrypted on this device before it is sent." else null,
            accent = true,
        )
        if (view.canVote) {
            def.options.forEachIndexed { i, option ->
                val on = selection.getOrElse(i) { false }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (on) Palette.LimeSoft else Palette.Surface)
                        .border(if (on) 1.dp else 0.5.dp, if (on) Palette.Ink else Palette.Hairline, RoundedCornerShape(12.dp))
                        .clickable { model.toggle(i) }
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        when {
                            single && on -> Icons.Filled.RadioButtonChecked
                            single -> Icons.Filled.RadioButtonUnchecked
                            on -> Icons.Filled.CheckBox
                            else -> Icons.Filled.CheckBoxOutlineBlank
                        },
                        contentDescription = null,
                        tint = if (on) Palette.Ink else Palette.Muted,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(option, fontSize = 16.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, color = Palette.Ink)
                }
            }
            PrimaryButton(
                if (busy == "cast") {
                    "Encrypting & proving…"
                } else if (view.myDigest == null) {
                    "Encrypt & cast ballot"
                } else {
                    "Replace my ballot"
                },
                { scope.launch { model.cast() } },
                enabled = model.canCast,
                busy = busy == "cast",
                icon = Icons.Filled.Lock,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text("Encrypted and proven well-formed before it leaves this phone", fontSize = 13.sp, color = Palette.Muted)
            }
        } else {
            Text("You are not on this poll's voter roll.", fontSize = 15.sp, color = Palette.Muted)
        }
        view.myDigest?.let {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                CopyRow("Your receipt", it)
                Text("After the close, check it appears in the counted list.", fontSize = 13.sp, color = Palette.Muted)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TurnoutCard(
    model: PollModel,
    view: PollView,
    label: (String) -> String,
    confirm: (Confirm) -> Unit,
) {
    val phase = view.state.phase
    val voters = model.voterList
    val busy by model.busy.collectAsState()
    Panel {
        CardHead(
            Icons.Outlined.Group,
            if (phase == Phase.Closed) "Counted ballots (${model.counted.size})" else "Turnout (${view.turnout.size})",
            "Who voted is public. What they voted is not.",
        )
        if (voters.isEmpty()) {
            Text("No ballots yet.", fontSize = 15.sp, color = Palette.Muted)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                voters.forEach { v ->
                    Row(
                        Modifier.clip(CircleShape).background(Palette.Sunken).padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(label(v), seed = v, size = 22.dp)
                        Spacer(Modifier.width(6.dp))
                        Text(label(v) + if (v == model.account) " (you)" else "", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                    }
                }
            }
        }
        val digest = view.myDigest
        if (phase == Phase.Closed && digest != null) {
            if (model.myCounted) {
                Callout(Tone.SUCCESS, "Your ballot ${VoteFormat.short(digest)} is in the counted set.", icon = Icons.Filled.Check)
            } else {
                Callout(
                    Tone.WARNING,
                    "Your latest ballot ${VoteFormat.short(digest)} is NOT in the counted set — it reached the creator's node after the seal.",
                )
            }
        }
        if (phase == Phase.Closing) {
            Callout(
                Tone.INFO,
                "Closing: nodes refuse new ballots as soon as they see the close, but ballots cast before that are still arriving. " +
                    if (model.isCreator) "Seal once everyone's nodes have caught up." else "The creator seals the count next.",
                icon = Icons.Outlined.Schedule,
            )
        }
        if (model.isCreator && phase == Phase.Voting) {
            Hairline()
            Text("Stops new ballots. The count is frozen in the next step.", fontSize = 14.sp, color = Palette.Muted)
            DangerButton(if (busy == "close") "Closing…" else "Close poll", { confirm(Confirm.CLOSE) }, enabled = busy == null)
        }
        if (model.isCreator && phase == Phase.Closing) {
            Hairline()
            Text("Freezes the ballots your node holds now.", fontSize = 14.sp, color = Palette.Muted)
            DangerButton(if (busy == "seal") "Sealing…" else "Seal the count", { confirm(Confirm.SEAL) }, enabled = busy == null, icon = Icons.Filled.Lock)
        }
    }
}

/** The "Verified" pill on the result. */
@Composable
fun VerifiedPill() = TonePill("Verified", Palette.SuccessSoft, Palette.Success, Icons.Filled.VerifiedUser)
