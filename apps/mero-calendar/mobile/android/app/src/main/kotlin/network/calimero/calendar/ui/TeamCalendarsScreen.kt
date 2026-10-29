package network.calimero.calendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.calendar.app.CalendarRef
import network.calimero.calendar.app.CalendarsModel
import network.calimero.calendar.data.ErrorText

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamCalendarsScreen(
    model: CalendarsModel,
    onBack: () -> Unit,
    onOpened: (CalendarRef) -> Unit,
    makeInviteLink: suspend () -> String,
    onShare: (String, String) -> Unit,
) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var inviting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(model) {
        model.load()
        // A team joined this session: its calendars are still on their way to the relay.
        if (model.justJoined) {
            repeat(SYNC_POLLS) {
                if (model.state.value.calendars
                        .isNotEmpty()
                ) {
                    return@LaunchedEffect
                }
                delay(SYNC_POLL_MS)
                model.load()
            }
        }
    }

    fun open(calendar: CalendarRef) {
        if (state.opening != null) return
        scope.launch {
            error = null
            try {
                model.open(calendar)
                onOpened(calendar)
            } catch (e: Exception) {
                error = ErrorText.of(e, "open this calendar")
            }
        }
    }

    Scaffold(
        containerColor = Tokens.ground,
        topBar = {
            TopAppBar(
                title = { Text(model.team.name, maxLines = 1) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = { inviting = true }) { Icon(Icons.Filled.PersonAdd, contentDescription = "Invite") }
                    IconButton(onClick = { creating = true }) { Icon(Icons.Filled.Add, contentDescription = "New calendar") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Tokens.ground),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.load()
                    refreshing = false
                }
            },
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(horizontal = Tokens.gutter, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item {
                    Text("Pick a calendar to open, or start another one in this team.", style = Tokens.caption, modifier = Modifier.padding(bottom = 6.dp))
                }
                (error ?: state.error)?.let { item { ErrorBanner(it) { scope.launch { model.load() } } } }
                when {
                    state.loading -> item { Loading() }
                    state.calendars.isEmpty() && model.justJoined ->
                        item {
                            EmptyState(Icons.Filled.Sync, "Syncing calendars…", "You just joined. This team's calendars are on their way.") {
                                PrimaryButton("New calendar", onClick = { creating = true })
                            }
                        }
                    state.calendars.isEmpty() ->
                        item {
                            EmptyState(Icons.Filled.CalendarMonth, "No calendars yet", "Create the first calendar in this team.") {
                                PrimaryButton("New calendar", onClick = { creating = true })
                            }
                        }
                    else ->
                        items(state.calendars, key = { it.contextId }) { calendar ->
                            Card(onClick = { open(calendar) }) {
                                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    IconTile()
                                    Spacer(Modifier.width(14.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(calendar.name, style = Tokens.heading)
                                        Text("Calendar", style = Tokens.caption)
                                    }
                                    if (state.opening == calendar.contextId) {
                                        CircularProgressIndicator(Modifier.size(20.dp), color = Tokens.ink, strokeWidth = 2.dp)
                                    } else {
                                        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = Tokens.faint)
                                    }
                                }
                            }
                        }
                }
                item { DetailsDisclosure(listOf("Team id" to model.team.id)) }
            }
        }
    }

    if (creating) {
        FormSheet(
            title = "New calendar",
            label = "Calendar name",
            placeholder = model.team.name,
            action = "Create calendar",
            busyAction = "Creating…",
            allowEmpty = true,
            onDismiss = { creating = false },
        ) { name ->
            try {
                val ref = model.create(name)
                creating = false
                open(ref)
                null
            } catch (e: Exception) {
                ErrorText.of(e, "create the calendar")
            }
        }
    }
    if (inviting) {
        InviteSheet(model.team.name, makeLink = makeInviteLink, onShare = onShare, onDismiss = { inviting = false })
    }
}

private const val SYNC_POLLS = 18
private const val SYNC_POLL_MS = 5_000L
