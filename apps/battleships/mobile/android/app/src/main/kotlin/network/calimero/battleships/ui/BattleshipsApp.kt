package network.calimero.battleships.ui

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.AppNamespace
import kotlinx.coroutines.launch
import network.calimero.battleships.BattleshipsViewModel
import network.calimero.battleships.core.Battleships
import network.calimero.battleships.core.BattleshipsBackend
import network.calimero.battleships.core.InvitationModel
import network.calimero.battleships.core.LobbiesModel
import network.calimero.battleships.core.LobbyModel
import network.calimero.battleships.core.MatchModel
import network.calimero.battleships.core.MatchRef

/** A match, who you are in it, its lobby (for a rematch), and the opponent's name there. (iOS `MatchRoute`.) */
data class MatchRoute(
    val ref: MatchRef,
    val me: String,
    val lobby: AppNamespace,
    val opponentName: String? = null,
)

/** Where the person is. The stack's top is on screen; Back pops it. (iOS: the NavigationStack path.) */
sealed interface Route {
    data object Lobbies : Route

    data class Lobby(
        val lobby: AppNamespace,
    ) : Route

    data class Match(
        val match: MatchRoute,
    ) : Route
}

/** The back stack, and each entry's model so a screen keeps its state while covered. */
class Navigator(
    private val backend: BattleshipsBackend,
    private val vm: BattleshipsViewModel,
) {
    val stack = mutableStateListOf<Route>(Route.Lobbies)
    private val models = mutableMapOf<Route, Any>()

    fun push(route: Route) {
        stack.add(route)
    }

    fun pop() {
        if (stack.size > 1) models.remove(stack.removeAt(stack.lastIndex))
    }

    /** Swap the top screen for [route] (a rematch replaces the finished match). */
    fun replaceTop(route: Route) {
        pop()
        push(route)
    }

    fun reset(routes: List<Route>) {
        stack.drop(1).forEach { models.remove(it) }
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
        stack.addAll(routes)
    }

    fun lobbies(): LobbiesModel = models.getOrPut(Route.Lobbies) { LobbiesModel(backend, Battleships.PACKAGE_NAME) } as LobbiesModel

    fun lobby(route: Route.Lobby): LobbyModel = models.getOrPut(route) { LobbyModel(backend, route.lobby) } as LobbyModel

    fun match(route: Route.Match): MatchModel =
        models.getOrPut(route) { MatchModel(route.match.ref, route.match.me, backend, vm.boards) } as MatchModel
}

/** Signed out: the sign-in screen. Signed in: the lobbies, and everything under them. */
@Composable
fun BattleshipsApp(
    vm: BattleshipsViewModel,
    activity: Context,
) {
    BattleshipsTheme {
        val backend by vm.backend.collectAsState()
        val revision by vm.revision.collectAsState()
        val restoring by vm.restoring.collectAsState()
        val stage by vm.invitation.stage.collectAsState()

        val current = backend
        Box(Modifier.fillMaxSize().background(Palette.Ground)) {
            when {
                current != null ->
                    key(revision) {
                        val nav = remember { Navigator(current, vm) }
                        Stack(nav, vm, activity)
                        if (stage != InvitationModel.Stage.Idle) {
                            InvitationSheet(vm) { namespaceId, title ->
                                nav.reset(listOf(Route.Lobby(AppNamespace(namespaceId, title, Battleships.PACKAGE_NAME))))
                            }
                        }
                    }
                restoring ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Palette.Ink) }
                else -> SignInScreen(vm, (stage as? InvitationModel.Stage.Confirm)?.title, activity)
            }
        }
    }
}

@Composable
private fun Stack(
    nav: Navigator,
    vm: BattleshipsViewModel,
    activity: Context,
) {
    val top = nav.stack.last()
    BackHandler(enabled = nav.stack.size > 1) { nav.pop() }
    AnimatedContent(
        targetState = top,
        transitionSpec = {
            val forward = nav.stack.indexOf(targetState) > nav.stack.indexOf(initialState) && nav.stack.contains(initialState)
            if (forward) {
                slideInHorizontally { it } togetherWith slideOutHorizontally { -it / 3 }
            } else {
                slideInHorizontally { -it / 3 } togetherWith slideOutHorizontally { it }
            }
        },
        label = "stack",
    ) { route ->
        when (route) {
            Route.Lobbies ->
                LobbiesScreen(
                    model = nav.lobbies(),
                    vm = vm,
                    activity = activity,
                    open = { nav.push(Route.Lobby(it)) },
                    openInvitation = { vm.invitation.open(it) },
                )
            is Route.Lobby ->
                LobbyScreen(nav.lobby(route), back = nav::pop, openMatch = { nav.push(Route.Match(it)) })
            is Route.Match ->
                MatchScreen(nav.match(route), route.match, back = nav::pop, rematched = { nav.replaceTop(Route.Match(it)) })
        }
    }
}

/** The front door: what Battleships is, and the way in (Calimero Cloud or a development node). */
@Composable
private fun SignInScreen(
    vm: BattleshipsViewModel,
    invitedTo: String?,
    activity: Context,
) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.Ground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(40.dp))
        Box(Modifier.size(84.dp).clip(RoundedCornerShape(24.dp)).background(Palette.Lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.GpsFixed, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(40.dp))
        }
        Spacer(Modifier.height(20.dp))
        Text("Battleships", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = Palette.Ink)
        Spacer(Modifier.height(10.dp))
        Text(
            "Two players, two hidden fleets. Your board never leaves this phone until the last shot.",
            fontSize = 17.sp,
            color = Palette.Muted,
            textAlign = TextAlign.Center,
        )
        if (invitedTo != null) {
            Spacer(Modifier.height(20.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Palette.LimeSoft)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Drafts, contentDescription = null, tint = Palette.Ink)
                Spacer(Modifier.width(10.dp))
                Text("You're invited to “$invitedTo”. Sign in to accept.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
            }
        }
        Spacer(Modifier.height(32.dp))
        CloudSignInPanel(vm, activity)
    }
}

/** Join a lobby from a link: ask, join, then open it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvitationSheet(
    vm: BattleshipsViewModel,
    open: (namespaceId: String, title: String) -> Unit,
) {
    val stage by vm.invitation.stage.collectAsState()
    val scope = rememberCoroutineScope()
    val joining = stage is InvitationModel.Stage.Joining
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !joining })

    fun accept() =
        scope.launch {
            vm.invitation.accept({ vm.backend.value }, { vm.didJoinNamespace() })
        }

    ModalBottomSheet(onDismissRequest = { if (!joining) vm.invitation.reset() }, sheetState = sheet, containerColor = Palette.Surface) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp)
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when (val current = stage) {
                InvitationModel.Stage.Idle -> Unit
                is InvitationModel.Stage.Confirm -> {
                    SheetHeader(Icons.Outlined.Drafts, Palette.LimeSoft, Palette.Ink, "Join “${current.title}”?")
                    Text(
                        "You'll see its matches and can challenge anyone in it.",
                        fontSize = 16.sp,
                        color = Palette.Muted,
                        textAlign = TextAlign.Center,
                    )
                    PrimaryButton("Join", { accept() })
                    SecondaryButton("Not now", { vm.invitation.reset() })
                }
                is InvitationModel.Stage.Joining -> {
                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.padding(top = 12.dp))
                    Text("Joining “${current.title}”…", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink)
                }
                is InvitationModel.Stage.Joined -> {
                    SheetHeader(Icons.Filled.Check, Palette.Lime, Palette.Ink, "You're in “${current.title}”")
                    Text("The lobby opens next.", fontSize = 16.sp, color = Palette.Muted)
                    PrimaryButton("Open lobby", {
                        open(current.namespaceId, current.title)
                        vm.invitation.reset()
                    })
                }
                is InvitationModel.Stage.Failed -> {
                    SheetHeader(Icons.Outlined.WarningAmber, Palette.DangerSoft, Palette.Danger, "Couldn't join")
                    Text(current.message, fontSize = 16.sp, color = Palette.Muted, textAlign = TextAlign.Center)
                    if (vm.invitation.invitation != null) PrimaryButton("Try again", { accept() })
                    SecondaryButton("Close", { vm.invitation.reset() })
                }
            }
        }
    }
}

@Composable
fun SheetHeader(
    icon: ImageVector,
    tone: Color,
    tint: Color,
    title: String,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(60.dp).clip(CircleShape).background(tone), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(26.dp))
        }
        Text(title, fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink, textAlign = TextAlign.Center)
    }
}
