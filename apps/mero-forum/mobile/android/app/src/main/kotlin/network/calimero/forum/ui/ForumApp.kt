package network.calimero.forum.ui

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.WarningAmber
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.forum.ForumViewModel
import network.calimero.forum.core.FeedModel
import network.calimero.forum.core.ForumRef
import network.calimero.forum.core.ForumsModel
import network.calimero.forum.core.InvitationDestination
import network.calimero.forum.core.InvitationModel
import network.calimero.forum.core.SpacesModel
import network.calimero.forum.core.ThreadModel

/** Where the person is. The stack's top is on screen; Back pops it. (iOS: the NavigationStack path.) */
sealed interface Route {
    data object Spaces : Route

    data class Forums(
        val space: AppNamespace,
    ) : Route

    data class Feed(
        val forum: ForumRef,
    ) : Route

    data class Post(
        val forum: ForumRef,
        val postId: String,
    ) : Route
}

/** The back stack, and each entry's model so a screen keeps its state while covered. */
class Navigator(
    private val backend: MeroAppBackend,
    private val vm: ForumViewModel,
) {
    val stack = mutableStateListOf<Route>(Route.Spaces)
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

    fun spaces(): SpacesModel = models.getOrPut(Route.Spaces) { SpacesModel(backend) } as SpacesModel

    fun forums(route: Route.Forums): ForumsModel =
        models.getOrPut(route) {
            ForumsModel(
                backend,
                route.space.id,
                SpacesModel.nameOf(route.space),
                vm.session.applicationId ?: route.space.applicationId,
            )
        } as ForumsModel

    fun feed(forum: ForumRef): FeedModel = models.getOrPut(Route.Feed(forum)) { FeedModel(backend, forum, vm.names) } as FeedModel

    fun thread(route: Route.Post): ThreadModel =
        models.getOrPut(route) {
            ThreadModel(backend, route.forum, route.postId, feed(route.forum).posts.value.firstOrNull { it.id == route.postId })
        } as ThreadModel
}

/** Signed out: the sign-in screen. Signed in: the spaces, and everything under them. */
@Composable
fun ForumApp(
    vm: ForumViewModel,
    onSignIn: () -> Unit,
) {
    ForumTheme {
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
                            InvitationSheet(vm) { destination -> nav.reset(destination.routes()) }
                        }
                    }
                restoring ->
                    Box(Modifier.fillMaxSize().background(Palette.Ground), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Palette.Ink)
                    }
                else ->
                    SignInScreen(
                        vm = vm,
                        invitedTo = (stage as? InvitationModel.Stage.Confirm)?.title,
                        onSignIn = onSignIn,
                    )
            }
        }
    }
}

private fun InvitationDestination.routes(): List<Route> {
    val space = Route.Forums(AppNamespace(namespaceId, spaceName, ""))
    return listOfNotNull(space, forum?.let { Route.Feed(it) })
}

@Composable
private fun Stack(
    nav: Navigator,
    vm: ForumViewModel,
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
            Route.Spaces ->
                SpacesScreen(
                    model = nav.spaces(),
                    vm = vm,
                    open = { nav.push(Route.Forums(it)) },
                    openInvitation = { vm.invitation.open(it) },
                )
            is Route.Forums -> ForumsScreen(nav.forums(route), route.space, back = nav::pop, open = { nav.push(Route.Feed(it)) })
            is Route.Feed -> FeedScreen(nav.feed(route.forum), back = nav::pop, open = { nav.push(Route.Post(route.forum, it)) })
            is Route.Post -> PostScreen(nav.thread(route), nav.feed(route.forum), back = nav::pop)
        }
    }
}

/** The front door: what Mero Forum is, and one way in. */
@Composable
private fun SignInScreen(
    vm: ForumViewModel,
    invitedTo: String?,
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
        ) { Icon(Icons.Filled.Forum, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(38.dp)) }
        Spacer(Modifier.height(20.dp))
        Text("Mero Forum", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, color = Palette.Ink)
        Spacer(Modifier.height(10.dp))
        Text(
            "Discussions that live on your members' own nodes. No server in between.",
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
                Text("You're invited to join “$invitedTo”. Sign in to accept.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
            }
        }
        Spacer(Modifier.weight(1f))
        state.error?.let {
            Text(it, fontSize = 14.sp, color = Palette.Danger, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }
        if (state.cancelled && state.error == null) {
            Text("Sign-in was cancelled in the wallet.", fontSize = 14.sp, color = Palette.Muted, textAlign = TextAlign.Center)
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

/** Join a space or forum from a link: ask, join, then say where it landed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvitationSheet(
    vm: ForumViewModel,
    open: (InvitationDestination) -> Unit,
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
                is InvitationModel.Stage.Confirm -> {
                    IconCircle(Icons.Outlined.Drafts, Palette.LimeSoft)
                    SheetTitle("Join “${s.title}”?")
                    SheetBody(if (s.isForum) "Joining takes you straight into that forum." else "Joining gives you access to the space and every forum in it.")
                    PrimaryButton("Join", ::accept)
                    SecondaryButton("Not now", { vm.invitation.reset() })
                }
                is InvitationModel.Stage.Joining -> {
                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.padding(top = 12.dp))
                    SheetTitle("Joining “${s.title}”…")
                    SheetBody("This can take up to a minute when no other member is online.")
                }
                is InvitationModel.Stage.Joined -> {
                    IconCircle(Icons.Filled.Check, Palette.Lime)
                    SheetTitle("You're in “${s.destination.forum?.forumName ?: s.destination.spaceName}”")
                    SheetBody(if (s.destination.forum == null) "Its forums are on the next screen." else "The forum opens next.")
                    PrimaryButton("Open", {
                        open(s.destination)
                        vm.invitation.reset()
                    })
                }
                is InvitationModel.Stage.Failed -> {
                    IconCircle(Icons.Outlined.WarningAmber, Palette.DangerSoft, Palette.Danger)
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
