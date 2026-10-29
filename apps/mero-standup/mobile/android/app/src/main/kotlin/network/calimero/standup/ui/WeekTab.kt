package network.calimero.standup.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.standup.app.TeamModel
import network.calimero.standup.app.WeekModel

/** The Week tab: a week per person, shareable as Markdown. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WeekTab(
    team: TeamModel,
    model: WeekModel,
    platform: Platform,
) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val version by team.version.collectAsState()
    val start by model.start.collectAsState()
    val week by model.week.collectAsState()
    val loading by model.isLoading.collectAsState()
    val error by model.error.collectAsState()
    val teamName by team.teamName.collectAsState()
    Track(teamName)

    LaunchedEffect(model, version) { model.load() }

    Scaffold(
        containerColor = Palette.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TabBar(team.title) {
                IconButton(onClick = { platform.share("Week of ${model.range}", model.markdown) }, enabled = week != null) {
                    Icon(Icons.Outlined.Share, contentDescription = "Share")
                }
                IconButton(onClick = {
                    platform.copy("Week digest", model.markdown)
                    scope.launch { snackbar.showSnackbar("Copied") }
                }, enabled = week != null) {
                    Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy as Markdown")
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading && week != null,
            onRefresh = { scope.launch { model.load() } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                item {
                    StandupCard(padding = 8.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { scope.launch { model.shift(-1) } }) {
                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Previous week")
                            }
                            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(if (model.isThisWeek) "This week" else "Week of", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                                Text(model.range, color = Palette.ink2, fontSize = 14.sp, textAlign = TextAlign.Center)
                            }
                            IconButton(onClick = { scope.launch { model.shift(1) } }, enabled = !model.isThisWeek) {
                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Next week")
                            }
                        }
                    }
                }
                if (error != null) item { ErrorLine(error) }
                if (week == null && loading) item { Muted("Loading…") }
                val people = model.people
                if (week != null && people.isEmpty()) {
                    item { EmptyState(Icons.Outlined.CalendarMonth, "No updates this week.") }
                }
                items(people, key = { it.account + start }) { p ->
                    StandupCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(p.account, p.name)
                            Spacer(Modifier.width(10.dp))
                            Text(team.name(p.account, p.name, you = false), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            Text("${p.updates.size} day${if (p.updates.size == 1) "" else "s"}", color = Palette.ink3, fontSize = 13.sp)
                        }
                        for (u in p.updates) {
                            Row {
                                Text(model.weekday(u.day), fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = Palette.ink2, modifier = Modifier.width(44.dp).padding(top = 2.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    if (u.done.isNotEmpty()) RichTextView(u.done)
                                    if (u.next.isNotEmpty()) Text("Next: ${u.next.lineSequence().first()}", color = Palette.ink2, fontSize = 14.sp)
                                    if (u.blockers.isNotEmpty()) Text("Blocked: ${u.blockers.lineSequence().first()}", color = Palette.danger, fontSize = 14.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
