package network.calimero.battleships.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import network.calimero.battleships.core.ErrorText
import network.calimero.battleships.core.LoadPhase
import network.calimero.battleships.core.LobbyModel
import network.calimero.battleships.core.Names
import network.calimero.battleships.generated.lobby.MatchRecord
import network.calimero.battleships.generated.lobby.MatchStatus
import network.calimero.battleships.generated.lobby.MatchSummary
import java.text.DateFormat
import java.util.Date

private enum class LobbyTab(
    val label: String,
) {
    MATCHES("Matches"),
    PLAYERS("Players"),
    RECORD("Record"),
}

/** One lobby: your matches, the players you can challenge, your record, and inviting people in. */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LobbyScreen(
    model: LobbyModel,
    back: () -> Unit,
    openMatch: (MatchRoute) -> Unit,
) {
    val phase by model.phase.collectAsState()
    val matches by model.matches.collectAsState()
    val players by model.players.collectAsState()
    val stats by model.stats.collectAsState()
    val history by model.history.collectAsState()
    val me by model.me.collectAsState()
    val challenging by model.challenging.collectAsState()
    val notice by model.notice.collectAsState()
    val lobbyContextId by model.lobbyContextId.collectAsState()
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(LobbyTab.MATCHES) }
    var choosing by remember { mutableStateOf(false) }
    var inviteLink by remember { mutableStateOf<String?>(null) }
    var inviting by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) {
        model.load()
        model.live()
    }

    fun invite() {
        if (inviting) return
        inviting = true
        scope.launch {
            try {
                inviteLink = model.invitationLink()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                model.notice.value = ErrorText.describe(e, "Couldn't create an invitation. Try again.")
            }
            inviting = false
        }
    }

    fun challenge(player: String) {
        scope.launch {
            model.challenge(player)?.let { ref ->
                choosing = false
                openMatch(MatchRoute(ref, model.me.value, model.namespace))
            }
        }
    }

    val opponents = model.opponents(players)
    val mine = model.myMatches(matches)

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar(model.name, back) {
            IconButton(onClick = ::invite, enabled = !inviting && lobbyContextId != null) {
                if (inviting) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = Palette.Ink, strokeWidth = 2.dp)
                } else {
                    Icon(Icons.Outlined.PersonAdd, contentDescription = "Invite players", tint = Palette.Ink)
                }
            }
        }
        NoticeBanner(notice) { model.notice.value = null }
        Box(Modifier.weight(1f)) {
            when (val current = phase) {
                LoadPhase.Loading ->
                    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(color = Palette.Ink)
                        Spacer(Modifier.height(12.dp))
                        Text("Opening the lobby…", fontSize = 15.sp, color = Palette.Muted)
                    }
                is LoadPhase.Failed ->
                    PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
                        scope.launch {
                            refreshing = true
                            model.load()
                            refreshing = false
                        }
                    }) {
                        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = 60.dp)) {
                            ErrorState(current.message) { scope.launch { model.load() } }
                        }
                    }
                LoadPhase.Loaded ->
                    PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
                        scope.launch {
                            refreshing = true
                            model.refresh()
                            refreshing = false
                        }
                    }) {
                        Column(
                            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Segmented(LobbyTab.entries, tab, { it.label }) { tab = it }
                            when (tab) {
                                LobbyTab.MATCHES ->
                                    if (mine.isEmpty()) {
                                        if (opponents.isEmpty()) {
                                            EmptyState(Icons.Filled.GpsFixed, "No matches yet", "Invite a friend, then challenge them to a match.", "Invite players", ::invite)
                                        } else {
                                            EmptyState(Icons.Filled.GpsFixed, "No matches yet", "Challenge someone in this lobby to start one.", "New match") { choosing = true }
                                        }
                                    } else {
                                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                            mine.forEach { match ->
                                                val ref = model.ref(match)
                                                MatchRow(match, model.opponent(match), me, enabled = ref != null) {
                                                    ref?.let { openMatch(MatchRoute(it, me, model.namespace)) }
                                                }
                                            }
                                        }
                                    }
                                LobbyTab.PLAYERS ->
                                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                        PlayerRow("You", me, isYou = true, busy = false, challenge = null)
                                        opponents.forEach { entry ->
                                            PlayerRow(Names.player(entry.player, me), entry.player, false, challenging == entry.player) {
                                                challenge(entry.player)
                                            }
                                        }
                                        if (opponents.isEmpty()) {
                                            EmptyState(Icons.Outlined.Group, "Nobody else is here yet", "Players show up once they've opened the lobby.", "Invite players", ::invite)
                                        }
                                    }
                                LobbyTab.RECORD ->
                                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                            StatTile(stats?.wins ?: 0uL, "Wins", highlight = true, modifier = Modifier.weight(1f))
                                            StatTile(stats?.losses ?: 0uL, "Losses", modifier = Modifier.weight(1f))
                                            StatTile(stats?.gamesPlayed ?: 0uL, "Played", modifier = Modifier.weight(1f))
                                        }
                                        SectionLabel("History")
                                        val sorted = model.sortedHistory(history)
                                        if (sorted.isEmpty()) {
                                            EmptyState(Icons.Outlined.Schedule, "No results yet", "Finished matches in this lobby show up here.")
                                        } else {
                                            sorted.forEach { HistoryRow(it, me) }
                                        }
                                    }
                            }
                            Spacer(Modifier.height(72.dp))
                        }
                    }
            }
        }
        if (phase == LoadPhase.Loaded) {
            Box(Modifier.background(Palette.Ground).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp)) {
                PrimaryButton("New match", { choosing = true }, icon = Icons.Filled.GpsFixed)
            }
        }
    }

    if (choosing) {
        ChallengeSheet(
            model = model,
            opponents = opponents,
            me = me,
            challenging = challenging,
            close = { choosing = false },
            challenge = ::challenge,
            invite = {
                choosing = false
                invite()
            },
        )
    }
    inviteLink?.let { link -> InviteSheet(link, model.name) { inviteLink = null } }
}

private fun formatMs(ms: ULong): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms.toLong()))

@Composable
private fun MatchRow(
    match: MatchSummary,
    opponent: String,
    me: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val won = if (match.status == MatchStatus.Finished && match.winner != null) match.winner.equals(me, true) else null
    val icon: ImageVector =
        when (won) {
            true -> Icons.Filled.EmojiEvents
            false -> Icons.Outlined.Flag
            null -> if (match.contextId == null) Icons.Outlined.HourglassEmpty else Icons.Filled.GpsFixed
        }
    val tone =
        when (won) {
            true -> Palette.Lime
            false -> Palette.Sunken
            null -> Palette.LimeSoft
        }
    Card(padding = 14.dp, onClick = if (enabled) onClick else null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SymbolTile(icon, tone = tone, size = 44.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("vs ${Names.player(opponent, me)}", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Palette.Ink)
                Text(formatMs(match.createdMs), fontSize = 13.sp, color = Palette.Muted)
            }
            when (won) {
                true -> Badge("Won")
                false -> Badge("Lost", BadgeTone.NEUTRAL)
                null ->
                    when {
                        match.contextId == null -> Badge("Setting up", BadgeTone.PENDING)
                        match.status == MatchStatus.Finished -> Badge("Over", BadgeTone.NEUTRAL)
                        else -> Badge("In play", BadgeTone.NEUTRAL)
                    }
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
        }
    }
}

@Composable
private fun PlayerRow(
    name: String,
    key: String,
    isYou: Boolean,
    busy: Boolean,
    challenge: (() -> Unit)?,
) {
    Card(padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SymbolTile(if (isYou) Icons.Filled.Person else Icons.Outlined.Person, tone = if (isYou) Palette.Lime else Palette.Sunken)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                Text(Names.short(key), fontSize = 13.sp, fontFamily = FontFamily.Monospace, color = Palette.Muted)
            }
            if (challenge != null) PrimaryButton("Challenge", challenge, compact = true, busy = busy)
        }
    }
}

@Composable
private fun StatTile(
    value: ULong,
    label: String,
    modifier: Modifier = Modifier,
    highlight: Boolean = false,
) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier
            .clip(shape)
            .background(if (highlight) Palette.LimeSoft else Palette.Surface)
            .border(0.5.dp, Palette.Hairline, shape)
            .padding(vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("$value", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 28.sp, color = Palette.Ink)
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = if (highlight) Palette.Ink else Palette.Muted)
    }
}

@Composable
private fun HistoryRow(
    result: MatchRecord,
    me: String,
) {
    val mine =
        when {
            result.winner.equals(me, true) -> true
            result.loser.equals(me, true) -> false
            else -> null
        }
    val title =
        when (mine) {
            true -> "You beat ${Names.player(result.loser, me)}"
            false -> "${Names.player(result.winner, me)} beat you"
            null -> "${Names.player(result.winner, me)} beat ${Names.player(result.loser, me)}"
        }
    val icon =
        when (mine) {
            true -> Icons.Filled.EmojiEvents
            false -> Icons.Outlined.Flag
            null -> Icons.Filled.Groups
        }
    Card(padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SymbolTile(icon, tone = if (mine == true) Palette.Lime else Palette.Sunken, size = 36.dp)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                Text(formatMs(result.finishedMs), fontSize = 13.sp, color = Palette.Muted)
            }
        }
    }
}

/** Pick an opponent for a new match. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChallengeSheet(
    model: LobbyModel,
    opponents: List<network.calimero.battleships.generated.lobby.PlayerEntry>,
    me: String,
    challenging: String?,
    close: () -> Unit,
    challenge: (String) -> Unit,
    invite: () -> Unit,
) {
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val notice by model.notice.collectAsState()
    ModalBottomSheet(onDismissRequest = { if (challenging == null) close() }, sheetState = sheet, containerColor = Palette.Ground, dragHandle = null) {
        Column(Modifier.navigationBarsPadding()) {
            Box(Modifier.background(Palette.Surface)) { SheetBar("New match", null, canAct = false, busy = challenging != null, cancel = close) }
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (opponents.isEmpty()) {
                    EmptyState(Icons.Outlined.Group, "Nobody to challenge yet", "Invite a friend. They show up here once they've opened the lobby.", "Invite players", invite)
                } else {
                    SectionLabel("Challenge")
                    opponents.forEach { entry ->
                        PlayerRow(Names.player(entry.player, me), entry.player, false, challenging == entry.player) { challenge(entry.player) }
                    }
                    notice?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/** The invitation link, to share or copy. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InviteSheet(
    link: String,
    lobbyName: String,
    close: () -> Unit,
) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = close, sheetState = sheet, containerColor = Palette.Surface) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp)
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(60.dp).clip(CircleShape).background(Palette.LimeSoft), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.PersonAdd, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(26.dp))
            }
            Text("Invite to “$lobbyName”", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink, textAlign = TextAlign.Center)
            Text(
                "Anyone with this link can join the lobby and challenge you. It works on the web app too, and expires in a day.",
                fontSize = 15.sp,
                color = Palette.Muted,
                textAlign = TextAlign.Center,
            )
            PrimaryButton("Share link", { share(context, link, "Join $lobbyName on Battleships") }, icon = Icons.Filled.Share)
            SecondaryButton(
                if (copied) "Copied" else "Copy link",
                {
                    copy(context, "Invitation", link)
                    copied = true
                },
                icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy,
            )
        }
    }
}
