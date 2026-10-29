package network.calimero.pass.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.calimero.mero.app.MeroAppBackend
import network.calimero.pass.PassViewModel
import network.calimero.pass.core.DeviceKeyPair
import network.calimero.pass.core.InvitationDestination
import network.calimero.pass.core.InvitationModel
import network.calimero.pass.core.TeamModel
import network.calimero.pass.core.TeamRow
import network.calimero.pass.core.TeamsModel
import network.calimero.pass.core.VaultModel
import network.calimero.pass.core.VaultRef

/** Where the Vaults tab is. The stack's top is on screen; Back pops it. (iOS: the NavigationStack path.) */
sealed interface Route {
    data object Teams : Route

    data class Team(
        val team: TeamRow,
    ) : Route

    data class Vault(
        val ref: VaultRef,
    ) : Route

    data class Item(
        val ref: VaultRef,
        val secretId: String,
    ) : Route

    data class People(
        val ref: VaultRef,
    ) : Route

    data class Health(
        val ref: VaultRef,
    ) : Route

    data class Trash(
        val ref: VaultRef,
    ) : Route

    data class Activity(
        val ref: VaultRef,
    ) : Route
}

/** The Vaults tab's back stack, and each entry's model so a screen keeps its state while covered. */
class Navigator(
    val backend: MeroAppBackend,
    private val vm: PassViewModel,
    private val device: DeviceKeyPair,
) {
    val stack = mutableStateListOf<Route>(Route.Teams)
    private val models = mutableMapOf<Any, Any>()

    fun push(route: Route) {
        stack.add(route)
    }

    fun pop() {
        if (stack.size > 1) {
            val gone = stack.removeAt(stack.lastIndex)
            if (gone is Route.Team || gone is Route.Vault) models.remove(gone)
        }
    }

    fun reset(routes: List<Route>) {
        while (stack.size > 1) pop()
        stack.addAll(routes)
    }

    fun teams(): TeamsModel = models.getOrPut(Route.Teams) { TeamsModel(backend) } as TeamsModel

    fun team(route: Route.Team): TeamModel =
        models.getOrPut(route) {
            TeamModel(backend, route.team.id, route.team.name, vm.session.applicationId.orEmpty())
        } as TeamModel

    /** One model per open vault, shared by its item, people, health, trash and activity screens. */
    fun vault(ref: VaultRef): VaultModel =
        models.getOrPut(Route.Vault(ref)) {
            VaultModel.over(ref, backend, device, vm.services.deviceLabel, vm.preferences)
        } as VaultModel
}

/** Signed out: sign in. Signed in but locked: unlock. Then the tabs. */
@Composable
fun PassApp(
    vm: PassViewModel,
    activity: FragmentActivity,
    onSignIn: () -> Unit,
) {
    PassTheme {
        CompositionLocalProvider(LocalServices provides vm.services) {
            val backend by vm.session.backend.collectAsState()
            val revision by vm.session.revision.collectAsState()
            val restoring by vm.session.isRestoring.collectAsState()
            val device by vm.keeper.device.collectAsState()
            val generation by vm.keeper.generation.collectAsState()
            val stage by vm.invitation.stage.collectAsState()
            val pending by vm.session.pendingInvitation.collectAsState()

            LaunchedEffect(pending) {
                pending?.let {
                    vm.invitation.open(it)
                    vm.session.dismissPendingInvitation()
                }
            }

            val current = backend
            val unlocked = device
            Box(Modifier.fillMaxSize().background(Palette.Ground)) {
                when {
                    restoring && current == null -> CenteredProgress()
                    current == null -> SignInScreen(vm, invitedTo = (stage as? InvitationModel.Stage.Confirm)?.title, onSignIn = onSignIn)
                    unlocked == null -> LockScreen(vm.keeper, activity)
                    else ->
                        key(revision, generation) {
                            val nav = remember { Navigator(current, vm, unlocked) }
                            var tab by remember { mutableIntStateOf(0) }
                            MainTabs(vm, nav, tab, { tab = it })
                            if (stage != InvitationModel.Stage.Idle) {
                                InvitationSheet(vm) { destination ->
                                    tab = 0
                                    nav.reset(destination.routes())
                                }
                            }
                        }
                }
                Toast(vm.services.toast, Modifier.align(Alignment.BottomCenter))
            }
        }
    }
}

private fun Route.vaultRef(): VaultRef? =
    when (this) {
        is Route.Vault -> ref
        is Route.Item -> ref
        is Route.People -> ref
        is Route.Health -> ref
        is Route.Trash -> ref
        is Route.Activity -> ref
        else -> null
    }

private fun InvitationDestination.routes(): List<Route> =
    listOfNotNull(Route.Team(TeamRow(namespaceId, teamName, 0, 0)), vault?.let { Route.Vault(it) })

@Composable
private fun Toast(
    text: String?,
    modifier: Modifier,
) {
    AnimatedVisibility(visible = text != null, enter = fadeIn(), exit = fadeOut(), modifier = modifier.padding(bottom = 100.dp)) {
        Text(
            text.orEmpty(),
            color = Palette.Surface,
            fontSize = 14.sp,
            modifier =
                Modifier
                    .clip(CircleShape)
                    .background(Palette.Ink)
                    .padding(horizontal = 16.dp, vertical = 10.dp),
        )
    }
}

/** Vaults and Security. */
@Composable
private fun MainTabs(
    vm: PassViewModel,
    nav: Navigator,
    tab: Int,
    select: (Int) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
            if (tab == 0) {
                BackHandler(enabled = nav.stack.size > 1) { nav.pop() }
                VaultsStack(vm, nav)
            } else {
                BackHandler { select(0) }
                SecurityScreen(vm, nav.backend)
            }
        }
        NavigationBar(containerColor = Palette.Surface) {
            val colors =
                NavigationBarItemDefaults.colors(
                    selectedIconColor = Palette.Ink,
                    selectedTextColor = Palette.Ink,
                    indicatorColor = Palette.Lime,
                    unselectedIconColor = Palette.Muted,
                    unselectedTextColor = Palette.Muted,
                )
            NavigationBarItem(
                selected = tab == 0,
                onClick = { if (tab == 0) nav.reset(emptyList()) else select(0) },
                icon = { Icon(if (tab == 0) Icons.Filled.Lock else Icons.Outlined.Lock, contentDescription = null) },
                label = { Text("Vaults") },
                colors = colors,
            )
            NavigationBarItem(
                selected = tab == 1,
                onClick = { select(1) },
                icon = { Icon(if (tab == 1) Icons.Filled.VerifiedUser else Icons.Outlined.VerifiedUser, contentDescription = null) },
                label = { Text("Security") },
                colors = colors,
            )
        }
    }
}

@Composable
private fun VaultsStack(
    vm: PassViewModel,
    nav: Navigator,
) {
    val back = { nav.pop() }
    val top = nav.stack.last()
    // The open vault stays live (events, polling) while any of its screens is on top, as iOS's
    // `.task` on the vault screen does under its pushed item and tool screens.
    val liveRef = top.vaultRef()
    if (liveRef != null) {
        LaunchedEffect(liveRef) { nav.vault(liveRef).run() }
    }
    when (val route = top) {
        Route.Teams -> TeamsScreen(nav.teams(), open = { nav.push(Route.Team(it)) }, openInvitation = { vm.invitation.open(it) })
        is Route.Team -> TeamScreen(nav.team(route), route.team, back = back, open = { nav.push(Route.Vault(it)) })
        is Route.Vault -> VaultScreen(nav.vault(route.ref), nav.backend, back = back, push = { nav.push(it) })
        is Route.Item -> ItemDetailScreen(nav.vault(route.ref), route.secretId, back = back)
        is Route.People -> PeopleScreen(nav.vault(route.ref), back = back)
        is Route.Health -> HealthScreen(nav.vault(route.ref), back = back, open = { nav.push(Route.Item(route.ref, it)) })
        is Route.Trash -> TrashScreen(nav.vault(route.ref), back = back)
        is Route.Activity -> ActivityScreen(nav.vault(route.ref), back = back)
    }
}
