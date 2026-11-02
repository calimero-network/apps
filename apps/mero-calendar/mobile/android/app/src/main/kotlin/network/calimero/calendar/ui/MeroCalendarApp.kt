package network.calimero.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.calimero.mero.app.MeroAppBackend
import com.calimero.mero.compose.MeroAppSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import network.calimero.calendar.BuildConfig
import network.calimero.calendar.app.ApprovalsModel
import network.calimero.calendar.app.CalendarAppViewModel
import network.calimero.calendar.app.CalendarModel
import network.calimero.calendar.app.CalendarsModel
import network.calimero.calendar.app.Screen
import network.calimero.calendar.app.Team
import network.calimero.calendar.app.TeamsModel
import network.calimero.calendar.data.CalendarConstants
import network.calimero.calendar.data.ErrorText
import network.calimero.calendar.data.TeamInvites

@Composable
fun MeroCalendarApp(
    vm: CalendarAppViewModel,
    onShare: (String, String) -> Unit,
) {
    CalendarTheme {
        val restored by vm.restored.collectAsState()
        val session by vm.session.collectAsState()
        val backend by vm.backend.collectAsState()
        val revision by (session?.revision ?: remember { MutableStateFlow(0) }).collectAsState()
        val busy by vm.busy.collectAsState()
        val error by vm.error.collectAsState()
        val current = backend
        when {
            !restored -> StatusScreen("Restoring your session…")
            current != null -> key(revision) { SignedIn(vm, session, current, onShare) }
            else ->
                SignInScreen(
                    busy = busy,
                    error = error,
                    initialCluster = vm.lastCluster,
                    initialDevNode = vm.lastDevNode,
                    onCloud = vm::signInCloud,
                    onDevelopment = vm::signInDevelopment,
                )
        }
    }
}

@Composable
private fun SignedIn(
    vm: CalendarAppViewModel,
    session: MeroAppSession?,
    backend: MeroAppBackend,
    onShare: (String, String) -> Unit,
) {
    val teams = remember(backend) { TeamsModel(backend, vm.names) }
    val approvals =
        remember(backend) {
            ApprovalsModel(
                packageName = CalendarConstants.PACKAGE_NAME,
                appName = "Mero Calendar",
                fetch = { org -> checkNotNull(session).client.pendingApprovals(org) },
                consent = { request, confirm -> vm.requestConsent(request, confirm) },
                returnTo = BuildConfig.CONSENT_CALLBACK_URL,
            )
        }
    val stack by vm.stack.collectAsState()
    val pending by (session?.pendingInvitation ?: remember { MutableStateFlow(null) }).collectAsState()
    val consentResult by (session?.consentResult ?: remember { MutableStateFlow(null) }).collectAsState()
    val scope = rememberCoroutineScope()

    // The consent page sent the person back: re-read what still waits.
    LaunchedEffect(consentResult) { if (consentResult != null) approvals.load(teams.orgs) }

    BackHandler(enabled = stack.size > 1) { vm.pop() }

    suspend fun joined(namespaceId: String) {
        teams.load()
        val team =
            teams.state.value.teams
                .firstOrNull { it.id == namespaceId }
                ?: Team(namespaceId, vm.names.team(namespaceId) ?: TeamsModel.teamPlaceholder(namespaceId), CalendarConstants.PACKAGE_NAME)
        vm.didJoin(team)
    }

    when (val screen = stack.last()) {
        Screen.Teams ->
            TeamsScreen(
                model = teams,
                approvals = approvals,
                account = backend.account,
                onOpen = { vm.push(Screen.TeamCalendars(it)) },
                onCreated = { vm.push(Screen.TeamCalendars(it)) },
                onJoined = { joined(it) },
                onSignOut = { vm.signOut() },
                onShare = onShare,
            )
        is Screen.TeamCalendars -> {
            val team = screen.team.withApplication(CalendarConstants.PACKAGE_NAME)
            val model = remember(screen) { CalendarsModel(backend, team, vm.names, justJoined = team.id in vm.justJoined) }
            TeamCalendarsScreen(
                model = model,
                onBack = { vm.pop() },
                onOpened = { vm.push(Screen.Calendar(team, it)) },
                makeInviteLink = { teams.inviteLink(team) },
                onShare = onShare,
            )
        }
        is Screen.Calendar -> {
            val model = remember(screen) { CalendarModel(backend, screen.team, screen.calendar, vm.names) }
            CalendarScreen(model = model, onBack = { vm.pop() })
        }
    }

    pending?.let { link ->
        var busy by remember(link) { mutableStateOf(false) }
        var error by remember(link) { mutableStateOf<String?>(null) }
        val name = TeamInvites.parse(link)?.teamName
        AlertDialog(
            onDismissRequest = { if (!busy) session?.dismissPendingInvitation() },
            title = { Text(if (name != null) "Join $name?" else "Join this team?") },
            text = { Text(error ?: "You were invited to a team on Mero Calendar.") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        try {
                            val id = teams.join(link)
                            session?.dismissPendingInvitation()
                            joined(id)
                        } catch (e: IllegalArgumentException) {
                            error = e.message
                        } catch (e: Exception) {
                            error = ErrorText.of(e, "join the team")
                        } finally {
                            busy = false
                        }
                    }
                }) { Text(if (busy) "Joining…" else "Join", color = Tokens.ink) }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { session?.dismissPendingInvitation() }) { Text("Not now", color = Tokens.muted) }
            },
            containerColor = Tokens.surface,
        )
    }
}

/** A team listed before the session knew its application id gets the session's. */
private fun Team.withApplication(sessionApplicationId: String?): Team =
    if (applicationId.isBlank() && !sessionApplicationId.isNullOrBlank()) copy(applicationId = sessionApplicationId) else this
