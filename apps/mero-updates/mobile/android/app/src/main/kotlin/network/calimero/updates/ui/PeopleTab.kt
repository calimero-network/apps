package network.calimero.updates.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.PeopleModel
import network.calimero.updates.core.Format
import network.calimero.updates.core.People
import network.calimero.updates.generated.EngagementRow
import network.calimero.updates.generated.PersonView

/** The team, the investors, your profile and what you follow; for the team, engagement and who read what. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeopleTab(
    audience: AudienceModel,
    nav: AudienceNav,
) {
    val model = remember(audience) { PeopleModel(audience) }
    val version by audience.version.collectAsState()
    val me by audience.me.collectAsState()
    val categories by audience.categories.collectAsState()
    val people by model.people.collectAsState()
    val engagement by model.engagement.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val pending by model.pending.collectAsState()
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<PersonView?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val isTeam = me?.isTeam == true
    val team = people.filter { it.isTeam }
    val investors = people.filter { !it.isTeam }

    LaunchedEffect(model, version) { model.load() }

    Scaffold(containerColor = Palette.background, topBar = { AudienceTopBar(audience, nav) }) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch {
                    model.load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    PageHeader(
                        "People",
                        if (isTeam) "Who is in this audience, and who is engaged with your updates." else "The team and the other members of this audience.",
                    )
                }
                me?.let { current ->
                    item {
                        UpdatesCard {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(current.account, current.name, team = current.isTeam, size = 44.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("Signed in as", color = Palette.ink3, fontSize = 12.sp)
                                    Row {
                                        Text(People.label(current.name, current.account), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                                        if (current.firm.isNotEmpty()) Text(" · ${current.firm}", color = Palette.ink2, fontSize = 15.sp)
                                    }
                                }
                                SecondaryButton("Edit", onClick = { editing = true }, icon = Icons.Outlined.Edit, compact = true)
                            }
                            if (categories.isNotEmpty()) {
                                Text("Categories you follow — muted ones stop counting as unread:", color = Palette.ink2, fontSize = 13.sp)
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    items(categories, key = { it.id }) { c ->
                                        CategoryChip(c, selected = !c.muted, suffix = if (c.muted) " (muted)" else "") {
                                            scope.launch { runCatching { audience.toggleMuted(c) } }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (error != null) item { UpdatesCard { ErrorLine(error) } }
                item { SectionLabel("Team", trailing = "${team.size}") }
                item { PeopleList(team, me?.account, engagement = false, canManage = audience.isAdmin, pending = pending) { confirm = it } }
                item { SectionLabel("Investors & advisors", trailing = "${investors.size}") }
                if (loaded && investors.isEmpty()) {
                    item {
                        Text(
                            "Nobody yet. Invite people from the account menu — anyone with the link joins as a reader.",
                            color = Palette.ink2,
                            fontSize = 15.sp,
                            modifier = Modifier.padding(horizontal = 4.dp),
                        )
                    }
                } else {
                    item { PeopleList(investors, me?.account, engagement = isTeam, canManage = audience.isAdmin, pending = pending) { confirm = it } }
                }
                if (isTeam && engagement.isNotEmpty()) {
                    item { SectionLabel("Who read what") }
                    items(engagement, key = { it.postId }) { EngagementCard(it) }
                }
            }
        }
    }

    if (editing) ProfileSheet(audience, onDismiss = { editing = false })
    confirm?.let { person ->
        val who = People.label(person.name, person.account)
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (person.isTeam) "Remove $who from the team?" else "Make $who a teammate?") },
            text = { Text("Teammates can publish updates, answer questions and see who offered help.") },
            confirmButton = {
                LinkButton(if (person.isTeam) "Remove from team" else "Make teammate", color = if (person.isTeam) Palette.danger else Palette.ink, onClick = {
                    confirm = null
                    scope.launch { model.toggleTeam(person) }
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { confirm = null }) },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun PeopleList(
    list: List<PersonView>,
    self: String?,
    engagement: Boolean,
    canManage: Boolean,
    pending: String?,
    onManage: (PersonView) -> Unit,
) {
    UpdatesCard(padding = 4.dp) {
        list.forEachIndexed { i, person ->
            PersonRow(person, person.account == self, engagement, canManage && !person.isAdmin, pending == person.account) { onManage(person) }
            if (i < list.size - 1) HorizontalDivider(color = Palette.hairline, modifier = Modifier.padding(start = 56.dp))
        }
    }
}

@Composable
private fun PersonRow(
    person: PersonView,
    isSelf: Boolean,
    engagement: Boolean,
    canManage: Boolean,
    busy: Boolean,
    onManage: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
        Avatar(person.account, person.name, team = person.isTeam, size = 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(People.label(person.name, person.account), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                if (isSelf) Text("(you)", color = Palette.ink3, fontSize = 13.sp)
                if (person.isAdmin) Badge("Admin")
            }
            if (person.firm.isNotEmpty()) Text(person.firm, color = Palette.ink2, fontSize = 13.sp)
            if (engagement) {
                val pct = Format.percent(person.updatesRead, person.updatesTotal)
                LinearProgressIndicator(
                    progress = { pct / 100f },
                    color = Palette.ink,
                    trackColor = Palette.sunken,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)),
                )
                Text(PeopleModel.engagementLine(person), color = Palette.ink2, fontSize = 12.sp)
            }
        }
        if (canManage) {
            if (busy) {
                CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
            } else {
                Box {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Outlined.MoreHoriz, contentDescription = "Manage ${People.label(person.name, person.account)}", tint = Palette.ink2)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(if (person.isTeam) "Remove from team" else "Make teammate") },
                            leadingIcon = { Icon(if (person.isTeam) Icons.Outlined.PersonRemove else Icons.Outlined.PersonAdd, contentDescription = null) },
                            onClick = {
                                menu = false
                                onManage()
                            },
                        )
                    }
                }
            }
        }
    }
}

/** One update: who read it, and who to follow up with. */
@Composable
private fun EngagementCard(row: EngagementRow) {
    var expanded by remember { mutableStateOf(false) }
    val total = row.readers.size + row.notRead.size
    UpdatesCard {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                Text(
                    "${Format.formatDate(row.publishedAt)} · ${Format.plural(row.reactions, "reaction")} · ${Format.plural(row.comments, "reply", "replies")} · ${Format.plural(row.offers, "offer")}",
                    color = Palette.ink2,
                    fontSize = 12.sp,
                )
            }
            Text("${row.readers.size}/$total read", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, contentDescription = null, tint = Palette.ink2)
        }
        AnimatedVisibility(expanded) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("READ", color = Palette.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp)
                    if (row.readers.isEmpty()) Text("Nobody yet.", color = Palette.ink3, fontSize = 13.sp)
                    row.readers.forEach { r ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Palette.good, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("${People.label(r.name, r.account)} · ${Format.timeAgo(r.firstAt)}", fontSize = 13.sp)
                        }
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("NOT YET — FOLLOW UP", color = Palette.ink3, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.5.sp)
                    if (row.notRead.isEmpty()) Text("Everyone has read it.", color = Palette.ink3, fontSize = 13.sp)
                    row.notRead.forEach { r ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Circle, contentDescription = null, tint = Palette.ink3, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(People.label(r.name, r.account) + if (r.firm.isEmpty()) "" else " · ${r.firm}", fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
}
