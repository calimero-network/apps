package network.calimero.vote.ui

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.HowToVote
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.vote.VoteViewModel
import network.calimero.vote.core.GroupModel
import network.calimero.vote.core.GroupRef
import network.calimero.vote.core.GroupsModel
import network.calimero.vote.core.InvitationModel
import network.calimero.vote.core.PollModel

/** Where the person is. The stack's top is on screen; Back pops it. (iOS: the NavigationStack path.) */
sealed interface Route {
    data object Groups : Route

    data class Group(
        val group: GroupRef,
    ) : Route

    data class Poll(
        val group: GroupRef,
        val pollId: String,
    ) : Route
}

/** The back stack, and each entry's model so a screen keeps its state while covered. */
class Navigator(
    private val backend: MeroAppBackend,
    private val vm: VoteViewModel,
) {
    val stack = mutableStateListOf<Route>(Route.Groups)
    private val models = mutableMapOf<Route, Any>()

    fun push(route: Route) {
        stack.add(route)
    }

    fun pop() {
        if (stack.size > 1) models.remove(stack.removeAt(stack.lastIndex))
    }

    fun reset(routes: List<Route>) {
        stack.drop(1).forEach { models.remove(it) }
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
        stack.addAll(routes)
    }

    fun groups(): GroupsModel = models.getOrPut(Route.Groups) { GroupsModel(backend, vm.session.applicationId.orEmpty()) } as GroupsModel

    fun group(route: Route.Group): GroupModel = models.getOrPut(route) { GroupModel(backend, route.group) } as GroupModel

    fun poll(route: Route.Poll): PollModel = models.getOrPut(route) { PollModel(backend, route.group, route.pollId, vm.keys) } as PollModel
}

/** Signed out: the sign-in screen. Signed in: the voting groups, and everything under them. */
@Composable
fun VoteApp(
    vm: VoteViewModel,
    onSignIn: () -> Unit,
) {
    VoteTheme {
        val backend by vm.session.backend.collectAsState()
        val revision by vm.session.revision.collectAsState()
        val restoring by vm.session.isRestoring.collectAsState()
        val stage by vm.invitation.stage.collectAsState()
        val pending by vm.session.pendingInvitation.collectAsState()

        LaunchedEffect(pending) {
            pending?.let {
                vm.invitation.open(it)
                vm.session.dismissPendingInvitation()
            }
        }

        val current = backend
        Box(Modifier.fillMaxSize().background(Palette.Surface)) {
            when {
                current != null ->
                    key(revision) {
                        val nav = remember { Navigator(current, vm) }
                        Stack(nav, vm)
                        if (stage != InvitationModel.Stage.Idle) {
                            InvitationSheet(vm) { group -> nav.reset(listOf(Route.Group(group))) }
                        }
                    }
                restoring ->
                    Box(Modifier.fillMaxSize().background(Palette.Ground), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Palette.Ink)
                    }
                else -> SignInScreen(vm, invited = stage == InvitationModel.Stage.Confirm, onSignIn = onSignIn)
            }
        }
    }
}

@Composable
private fun Stack(
    nav: Navigator,
    vm: VoteViewModel,
) {
    val top = nav.stack.last()
    BackHandler(enabled = nav.stack.size > 1) { nav.pop() }
    AnimatedContent(
        targetState = top,
        transitionSpec = {
            val forward = nav.stack.contains(initialState) && initialState != targetState && nav.stack.indexOf(targetState) > nav.stack.indexOf(initialState)
            if (forward) {
                slideInHorizontally { it } togetherWith slideOutHorizontally { -it / 3 }
            } else {
                slideInHorizontally { -it / 3 } togetherWith slideOutHorizontally { it }
            }
        },
        label = "stack",
    ) { route ->
        when (route) {
            Route.Groups ->
                GroupsScreen(
                    model = nav.groups(),
                    vm = vm,
                    open = { nav.push(Route.Group(it)) },
                    openInvitation = { vm.invitation.open(it) },
                )
            is Route.Group -> GroupScreen(nav.group(route), back = nav::pop, open = { nav.push(Route.Poll(route.group, it)) })
            is Route.Poll -> PollScreen(nav.poll(route), back = nav::pop)
        }
    }
}

/** The front door: what Mero Vote is, and one way in. */
@Composable
private fun SignInScreen(
    vm: VoteViewModel,
    invited: Boolean,
    onSignIn: () -> Unit,
) {
    val state by vm.session.client.state
        .collectAsState()
    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.Ground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        Box(
            Modifier.size(84.dp).clip(RoundedCornerShape(24.dp)).background(Palette.Lime),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Filled.HowToVote, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(38.dp)) }
        Spacer(Modifier.height(20.dp))
        Text("Mero Vote", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = Palette.Ink)
        Spacer(Modifier.height(10.dp))
        Text("Private polls with verifiable tallies.", fontSize = 17.sp, color = Palette.Muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(24.dp))
        Column(verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxWidth()) {
            Point(Icons.Filled.Lock, "Encrypted here", "Your choice leaves this phone as ciphertext and a proof.")
            Point(Icons.Filled.Key, "Shared key", "Trustees hold the decryption key together; no one holds all of it.")
            Point(Icons.Filled.BarChart, "Audited by everyone", "Every member's node recomputes the tally from the frozen ballots.")
        }
        if (invited) {
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
                Text("You're invited to a voting group. Sign in to accept.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
            }
        }
        Spacer(Modifier.weight(1f))
        state.error?.let {
            Text(it, fontSize = 14.sp, color = Palette.Danger, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }
        PrimaryButton("Sign in with Calimero", onSignIn, busy = state.isLoading, icon = Icons.Outlined.HowToReg)
        if (state.isLoading) {
            TextButton(onClick = { vm.session.cancelSignIn() }) { Text("Cancel", color = Palette.Ink) }
        } else {
            Spacer(Modifier.height(12.dp))
            Text("You'll approve this device in your Calimero wallet.", fontSize = 13.sp, color = Palette.Muted)
        }
    }
}

@Composable
private fun Point(
    icon: ImageVector,
    title: String,
    text: String,
) {
    Row(verticalAlignment = Alignment.Top) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(Palette.Surface), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.padding(start = 12.dp)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text(text, fontSize = 14.sp, color = Palette.Muted)
        }
    }
}

/** Join a voting group from a link: ask, join, then open it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvitationSheet(
    vm: VoteViewModel,
    open: (GroupRef) -> Unit,
) {
    val stage by vm.invitation.stage.collectAsState()
    val scope = rememberCoroutineScope()
    val joining = stage is InvitationModel.Stage.Joining
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !joining })

    fun accept() {
        scope.launch {
            vm.invitation.accept(backend = { vm.session.backend.value }, didJoin = { vm.session.didJoinNamespace() })
        }
    }
    ModalBottomSheet(onDismissRequest = { if (!joining) vm.invitation.reset() }, sheetState = sheet, containerColor = Palette.Surface) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when (val s = stage) {
                InvitationModel.Stage.Idle -> Unit
                InvitationModel.Stage.Confirm -> {
                    IconCircle(Icons.Outlined.Drafts, Palette.LimeSoft)
                    SheetTitle("Join this voting group?")
                    SheetBody(
                        "Joining makes your account a member of the workspace it lives in, and its polls and ballots sync to you from the other members.",
                    )
                    PrimaryButton("Join", ::accept)
                    SecondaryButton("Not now", { vm.invitation.reset() })
                }
                InvitationModel.Stage.Joining -> {
                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.padding(top = 12.dp))
                    SheetTitle("Joining…")
                    SheetBody("This can take up to a minute when no other member is online.")
                }
                is InvitationModel.Stage.Joined -> {
                    IconCircle(Icons.Filled.Check, Palette.Lime)
                    SheetTitle("You're in")
                    SheetBody("The voting group opens next.")
                    PrimaryButton("Open", {
                        open(s.group)
                        vm.invitation.reset()
                    })
                }
                is InvitationModel.Stage.Failed -> {
                    IconCircle(Icons.Outlined.Warning, Palette.DangerSoft, Palette.Danger)
                    SheetTitle("Couldn't join")
                    SheetBody(s.message)
                    if (vm.invitation.invitation != null) PrimaryButton("Try again", ::accept)
                    SecondaryButton("Close", { vm.invitation.reset() })
                }
            }
        }
    }
}

@Composable
fun SheetTitle(text: String) = Text(text, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Palette.Ink, textAlign = TextAlign.Center)

@Composable
fun SheetBody(text: String) = Text(text, fontSize = 16.sp, color = Palette.Muted, textAlign = TextAlign.Center)
