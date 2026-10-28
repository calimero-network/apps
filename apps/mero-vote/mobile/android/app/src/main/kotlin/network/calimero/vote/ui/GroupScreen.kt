package network.calimero.vote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.RadioButtonChecked
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.vote.core.GroupModel
import network.calimero.vote.core.LoadPhase
import network.calimero.vote.core.PollDraft
import network.calimero.vote.core.VoteConstants
import network.calimero.vote.core.VoteErrorText
import network.calimero.vote.core.VoteFormat
import network.calimero.vote.generated.Member
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollSummary
import java.util.Calendar

private enum class GroupSheet { NEW_POLL, MEMBERS, INVITE, NAME }

/** One voting group: its polls, who is here, and a way to invite more. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupScreen(
    model: GroupModel,
    back: () -> Unit,
    open: (String) -> Unit,
) {
    val me by model.me.collectAsState()
    val roster by model.roster.collectAsState()
    val polls by model.polls.collectAsState()
    val phase by model.phase.collectAsState()
    val notice by model.notice.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<GroupSheet?>(null) }
    LaunchedEffect(model) { model.refresh() }
    LaunchedEffect(model) { model.watch() }
    val myName =
        me?.let { m ->
            roster
                .firstOrNull { it.account == m }
                ?.name
                ?.trim()
                ?.ifEmpty { null }
        }

    fun count(vararg phases: Phase) = polls.count { it.phase in phases }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            VoteTopBar(
                title = "Polls",
                subtitle = model.group.workspaceName,
                navigation = { BackButton(back) },
                actions = {
                    IconButton(onClick = { sheet = GroupSheet.MEMBERS }) { Icon(Icons.Outlined.Group, contentDescription = "Members") }
                    IconButton(onClick = { sheet = GroupSheet.INVITE }) { Icon(Icons.Outlined.PersonAdd, contentDescription = "Invite someone") }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { if (me != null) sheet = GroupSheet.NEW_POLL },
                containerColor = Palette.Lime,
                contentColor = Palette.Ink,
                shape = CircleShape,
            ) { Icon(Icons.Filled.Add, contentDescription = "New poll") }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.refresh()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item { NoticeBanner(notice) { model.notice.value = null } }
                when (val p = phase) {
                    LoadPhase.Loading -> items(3) { SkeletonCard() }
                    is LoadPhase.Failed -> item { ErrorState(p.message) { scope.launch { model.refresh() } } }
                    LoadPhase.Loaded -> {
                        if (myName == null) item { NameCard { sheet = GroupSheet.NAME } }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Stat(Icons.Filled.BarChart, count(Phase.Voting), "Open for voting", accent = true, Modifier.weight(1f))
                                Stat(Icons.Filled.Key, count(Phase.KeyCeremony), "In key ceremony", accent = false, Modifier.weight(1f))
                                Stat(Icons.Filled.Check, count(Phase.Closing, Phase.Closed), "Closed or counting", accent = false, Modifier.weight(1f))
                            }
                        }
                        if (polls.isEmpty()) {
                            item {
                                Card {
                                    EmptyState(
                                        Icons.Filled.BarChart,
                                        "No polls yet",
                                        "Start one with New poll — ballots are encrypted on each voter's device.",
                                        "New poll",
                                    ) { sheet = GroupSheet.NEW_POLL }
                                }
                            }
                        } else {
                            items(polls, key = { it.pollId }) { poll -> PollCard(poll, model.label(poll.creator)) { open(poll.pollId) } }
                        }
                    }
                }
            }
        }
    }

    when (sheet) {
        GroupSheet.NEW_POLL -> me?.let { m -> NewPollSheet(model, m, roster, dismiss = { sheet = null }) { open(it) } }
        GroupSheet.MEMBERS -> MembersSheet(model) { sheet = null }
        GroupSheet.INVITE -> InviteSheet(model) { sheet = null }
        GroupSheet.NAME ->
            NameSheet(
                title = "Your name",
                placeholder = "Your name",
                action = "Save",
                note = "Your name in this voting group. Others pick voters and trustees by it.",
                initial = myName.orEmpty(),
                maxLength = VoteConstants.MAX_NAME,
                dismiss = { sheet = null },
            ) { model.setName(it) }
        null -> Unit
    }
}

@Composable
private fun NameCard(set: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.LimeSoft)
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(Palette.Lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Person, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Pick a name", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text("Pick a name so others can add you as a voter or trustee.", fontSize = 14.sp, color = Palette.InkSoft)
        }
        PrimaryButton("Set name", set, compact = true)
    }
}

@Composable
private fun Stat(
    icon: ImageVector,
    n: Int,
    label: String,
    accent: Boolean,
    modifier: Modifier,
) {
    Box(modifier) {
        Card {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(26.dp).clip(CircleShape).background(if (accent) Palette.Lime else Palette.Sunken), contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(14.dp))
                }
                Text("$n", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink)
                Text(label, fontSize = 12.sp, color = Palette.Muted, minLines = 2, maxLines = 2)
            }
        }
    }
}

/** One poll in the list: phase, question, who made it, ballots, and where it stands. */
@Composable
private fun PollCard(
    poll: PollSummary,
    creator: String,
    onClick: () -> Unit,
) {
    val at = VoteFormat.stepIndex(poll.phase)
    Card(onClick = onClick) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PhaseBadge(poll.phase)
                Spacer(Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
            }
            Text(poll.title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Meta(Icons.Outlined.Person, creator)
                Meta(
                    if (poll.phase == Phase.KeyCeremony) Icons.Outlined.Schedule else Icons.Filled.Check,
                    VoteFormat.count(poll.ballots.toInt(), "ballot", "ballots"),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                repeat(4) { i ->
                    Box(
                        Modifier
                            .weight(1f)
                            .height(4.dp)
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
                    )
                }
            }
        }
    }
}

@Composable
private fun Meta(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, fontSize = 13.sp, color = Palette.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** You (and your name on the roster) and everyone else here. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MembersSheet(
    model: GroupModel,
    dismiss: () -> Unit,
) {
    val me by model.me.collectAsState()
    val roster by model.roster.collectAsState()
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val myName =
        me?.let { m ->
            roster
                .firstOrNull { it.account == m }
                ?.name
                ?.trim()
                ?.ifEmpty { null }
        }
    ModalBottomSheet(onDismissRequest = dismiss, containerColor = Palette.Surface) {
        Column(
            Modifier
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp)
                .imePadding()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Members", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                TextButton(onClick = dismiss) { Text("Done", color = Palette.Ink, fontWeight = FontWeight.SemiBold) }
            }
            SectionLabel("You")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(myName ?: "You", seed = me ?: "you", size = 44.dp)
                Column(Modifier.padding(start = 12.dp)) {
                    Text(myName ?: "No name yet", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                    Text(VoteFormat.short(me.orEmpty()), fontSize = 13.sp, fontFamily = FontFamily.Monospace, color = Palette.Muted)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                FilledField(name, { name = it }, "Your name", Modifier.weight(1f), maxLength = VoteConstants.MAX_NAME)
                Spacer(Modifier.width(10.dp))
                PrimaryButton(
                    if (myName == null) "Join roster" else "Rename",
                    {
                        busy = true
                        error = null
                        scope.launch {
                            runCatching { model.setName(name) }
                                .onSuccess { name = "" }
                                .onFailure { error = VoteErrorText.describe(it) }
                            busy = false
                        }
                    },
                    enabled = name.isNotBlank(),
                    busy = busy,
                    compact = true,
                )
            }
            error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
            Hairline()
            SectionLabel("Members (${roster.size})")
            if (roster.isEmpty()) Text("Nobody has joined the roster yet.", fontSize = 15.sp, color = Palette.Muted)
            roster.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Avatar(model.label(m.account), seed = m.account, size = 36.dp)
                    Text(
                        model.label(m.account) + if (m.account == me) " (you)" else "",
                        fontSize = 16.sp,
                        color = Palette.Ink,
                        modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(VoteFormat.short(m.account), fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Palette.Muted)
                }
            }
            Text("Everyone here can vote and audit.", fontSize = 13.sp, color = Palette.Muted)
        }
    }
}

@Composable
fun SectionLabel(text: String) = Text(text.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted)

/** Mint an invitation link to this voting group, then share or copy it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InviteSheet(
    model: GroupModel,
    dismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var link by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    ModalBottomSheet(onDismissRequest = dismiss, containerColor = Palette.Surface) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Invite someone", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                TextButton(onClick = dismiss) { Text("Done", color = Palette.Ink, fontWeight = FontWeight.SemiBold) }
            }
            Text("One link. Whoever opens it joins this voting group and sees its polls.", fontSize = 15.sp, color = Palette.Muted)
            val current = link
            if (current != null) {
                Text(
                    current,
                    fontSize = 13.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = Palette.Ink,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Palette.Sunken)
                            .padding(12.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton("Share", { share(context, current) }, Modifier.weight(1f), icon = Icons.Outlined.Share)
                    SecondaryButton(
                        if (copied) "Copied" else "Copy",
                        {
                            copy(context, "Invitation link", current)
                            copied = true
                        },
                        Modifier.weight(1f),
                        icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy,
                    )
                }
            } else {
                PrimaryButton(
                    if (busy) "Creating…" else "Create invite link",
                    {
                        busy = true
                        error = null
                        scope.launch {
                            runCatching { model.inviteLink() }.onSuccess { link = it }.onFailure { error = VoteErrorText.describe(it) }
                            busy = false
                        }
                    },
                    enabled = !busy,
                    icon = Icons.Outlined.Link,
                )
            }
            error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
        }
    }
}

/** Create a poll. Its definition is frozen at creation (its hash is the poll id). */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun NewPollSheet(
    model: GroupModel,
    me: String,
    roster: List<Member>,
    dismiss: () -> Unit,
    created: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(PollDraft(me, roster)) }
    var planned by remember { mutableStateOf(false) }
    var closes by remember { mutableStateOf(System.currentTimeMillis() + DAY_MS) }
    var picking by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val people = model.people

    fun personLabel(m: Member) = if (m.account == me) "${m.name.ifEmpty { "You" }} (you)" else m.name.ifEmpty { VoteFormat.short(m.account) }

    fun submit() {
        if (busy) return
        busy = true
        error = null
        val final = draft.copy(closesAt = if (planned) closes.toULong() else null)
        scope.launch {
            runCatching { model.createPoll(final) }
                .onSuccess {
                    dismiss()
                    created(it)
                }.onFailure { error = VoteErrorText.describe(it) }
            busy = false
        }
    }

    @Composable
    fun chips(
        selected: Set<String>,
        set: (Set<String>) -> Unit,
    ) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            people.forEach { m ->
                val on = m.account in selected
                ToggleChip(personLabel(m), on) { set(if (on) selected - m.account else selected + m.account) }
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!busy) dismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.Ground,
        dragHandle = null,
    ) {
        Column(Modifier.imePadding()) {
            Box(Modifier.background(Palette.Surface)) {
                SheetBar("New poll", "Create", canAct = draft.isValid, busy = busy, cancel = dismiss, act = ::submit)
            }
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                FormSection("Question") {
                    FilledField(draft.title, { draft = draft.copy(title = it) }, "Where do we hold the offsite?", singleLine = false, maxLength = VoteConstants.MAX_TITLE)
                }
                FormSection("Details (optional)") {
                    FilledField(draft.details, { draft = draft.copy(details = it) }, "", singleLine = false, minLines = 2, maxLength = VoteConstants.MAX_DESCRIPTION)
                }
                FormSection("Options") {
                    draft.options.forEachIndexed { i, o ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${i + 1}.", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted, modifier = Modifier.width(26.dp))
                            FilledField(
                                o,
                                { v -> draft = draft.copy(options = draft.options.mapIndexed { j, x -> if (j == i) v else x }) },
                                "Option ${i + 1}",
                                Modifier.weight(1f),
                                maxLength = VoteConstants.MAX_OPTION,
                            )
                            if (draft.options.size > 2) {
                                IconButton(onClick = { draft = draft.copy(options = draft.options.filterIndexed { j, _ -> j != i }) }) {
                                    Icon(Icons.Filled.Close, contentDescription = "Remove option ${i + 1}", tint = Palette.Muted, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                    if (draft.options.size < VoteConstants.MAX_OPTIONS) {
                        TextButton(onClick = { draft = draft.copy(options = draft.options + "") }) {
                            Icon(Icons.Filled.Add, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Add option", color = Palette.Ink)
                        }
                    }
                }
                FormSection("Each voter may pick") {
                    Radio("Exactly one option", draft.mode == PollDraft.Mode.SINGLE) { draft = draft.copy(mode = PollDraft.Mode.SINGLE) }
                    Radio("Up to ${draft.maxC} options (approval)", draft.mode == PollDraft.Mode.MULTI) { draft = draft.copy(mode = PollDraft.Mode.MULTI) }
                    if (draft.mode == PollDraft.Mode.MULTI) {
                        StepperRow("Up to ${draft.maxC}", draft.maxC, 1, draft.filled.size.coerceAtLeast(1)) { draft = draft.copy(maxChoices = it) }
                    }
                }
                FormSection("Trustees") {
                    Text(
                        "Trustees generate the election key together, so no one ever holds all of it. Any threshold of them can decrypt the totals; fewer learn nothing.",
                        fontSize = 14.sp,
                        color = Palette.Muted,
                    )
                    chips(draft.trustees) { draft = draft.copy(trustees = it) }
                    if (draft.trustees.size > 1) {
                        StepperRow(
                            "Any ${draft.threshold} of the ${draft.trustees.size} trustees can decrypt the totals.",
                            draft.threshold,
                            1,
                            draft.trustees.size,
                        ) { draft = draft.copy(thresholdPick = it) }
                    }
                    draft.trusteeNote(me)?.let { (text, warning) ->
                        if (warning) Callout(Tone.WARNING, text) else Text(text, fontSize = 14.sp, color = Palette.Muted)
                    }
                }
                FormSection("Who can vote") {
                    Radio("Every member of this group", draft.everyone) { draft = draft.copy(everyone = true) }
                    Radio("Only these members:", !draft.everyone) { draft = draft.copy(everyone = false) }
                    if (!draft.everyone) chips(draft.voters) { draft = draft.copy(voters = it) }
                }
                FormSection("Planned close") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Show a planned close", fontSize = 16.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                        Switch(
                            checked = planned,
                            onCheckedChange = { planned = it },
                            colors = SwitchDefaults.colors(checkedTrackColor = Palette.Lime, checkedThumbColor = Palette.Ink),
                        )
                    }
                    if (planned) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Planned close", fontSize = 16.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                            TextButton(onClick = { picking = "date" }) { Text(VoteFormat.date(closes.toULong()), color = Palette.Ink) }
                        }
                    }
                    Text("Shown to voters; you close the poll yourself.", fontSize = 13.sp, color = Palette.Muted)
                }
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                Text("Everything here is frozen once the poll is created.", fontSize = 13.sp, color = Palette.Muted)
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    when (picking) {
        "date" -> {
            val state = rememberDatePickerState(initialSelectedDateMillis = closes)
            DatePickerDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        state.selectedDateMillis?.let { closes = withDate(closes, it) }
                        picking = "time"
                    }) { Text("Next", color = Palette.Ink) }
                },
                dismissButton = { TextButton(onClick = { picking = null }) { Text("Cancel", color = Palette.Ink) } },
            ) { DatePicker(state) }
        }
        "time" -> {
            val cal = Calendar.getInstance().apply { timeInMillis = closes }
            val state = rememberTimePickerState(cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
            AlertDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        closes =
                            Calendar
                                .getInstance()
                                .apply {
                                    timeInMillis = closes
                                    set(Calendar.HOUR_OF_DAY, state.hour)
                                    set(Calendar.MINUTE, state.minute)
                                }.timeInMillis
                        picking = null
                    }) { Text("Done", color = Palette.Ink) }
                },
                text = { TimePicker(state) },
                containerColor = Palette.Surface,
            )
        }
    }
}

private const val DAY_MS = 86_400_000L

/** The picked day (UTC midnight from the date picker), keeping the time of day of [current]. */
private fun withDate(
    current: Long,
    utcDay: Long,
): Long {
    val day = Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply { timeInMillis = utcDay }
    return Calendar
        .getInstance()
        .apply {
            timeInMillis = current
            set(day.get(Calendar.YEAR), day.get(Calendar.MONTH), day.get(Calendar.DAY_OF_MONTH))
        }.timeInMillis
}

@Composable
private fun FormSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(title)
        Card { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) { content() } }
    }
}

@Composable
private fun Radio(
    title: String,
    on: Boolean,
    pick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().clickable(onClick = pick).padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            if (on) Icons.Filled.RadioButtonChecked else Icons.Filled.RadioButtonUnchecked,
            contentDescription = null,
            tint = if (on) Palette.Ink else Palette.Muted,
            modifier = Modifier.size(22.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(title, fontSize = 16.sp, color = Palette.Ink)
    }
}

@Composable
private fun StepperRow(
    label: String,
    value: Int,
    min: Int,
    max: Int,
    set: (Int) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 15.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
        SecondaryButton("−", { if (value > min) set(value - 1) }, compact = true)
        Spacer(Modifier.width(6.dp))
        SecondaryButton("+", { if (value < max) set(value + 1) }, compact = true)
    }
}
