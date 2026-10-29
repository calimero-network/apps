package network.calimero.sign.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.sign.Services
import network.calimero.sign.SignViewModel
import network.calimero.sign.core.AgreementRef
import network.calimero.sign.core.InvitationDestination
import network.calimero.sign.core.InvitationModel
import network.calimero.sign.core.SignIds

/** The three tabs. (iOS `AppTab`.) */
enum class Tab(
    val title: String,
    val icon: ImageVector,
) {
    INBOX("Inbox", Icons.Outlined.Inbox),
    AGREEMENTS("Agreements", Icons.Outlined.Folder),
    SIGNATURES("Signatures", Icons.Outlined.Draw),
}

/** A screen pushed over a tab. */
sealed interface Route {
    data class Agreement(
        val ref: AgreementRef,
    ) : Route

    data class Document(
        val ref: AgreementRef,
        val documentId: String,
    ) : Route
}

/** Signed out: the sign-in screen. Signed in: Inbox, Agreements, Signatures. */
@Composable
fun SignApp(
    vm: SignViewModel,
    onSignIn: () -> Unit,
) {
    SignTheme {
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
                        val services = remember { Services(current, vm) }
                        var tab by remember { mutableStateOf(Tab.INBOX) }
                        val stack = remember { mutableStateListOf<Route>() }
                        SignedIn(vm, services, tab, { tab = it }, stack)
                        if (stage != InvitationModel.Stage.Idle) {
                            InvitationSheet(vm) { destination ->
                                tab = Tab.INBOX
                                stack.clear()
                                destination.agreement?.let { stack += Route.Agreement(it) }
                            }
                        }
                    }
                restoring ->
                    Box(Modifier.fillMaxSize().background(Palette.Ground), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Palette.Ink)
                    }
                else -> SignInScreen(vm, (stage as? InvitationModel.Stage.Confirm)?.title, onSignIn)
            }
        }
    }
}

@Composable
private fun SignedIn(
    vm: SignViewModel,
    services: Services,
    tab: Tab,
    selectTab: (Tab) -> Unit,
    stack: MutableList<Route>,
) {
    var pasting by remember { mutableStateOf(false) }
    BackHandler(enabled = stack.isNotEmpty()) { stack.removeAt(stack.lastIndex) }
    val push: (Route) -> Unit = { stack += it }
    val pop: () -> Unit = { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }
    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        Box(Modifier.weight(1f)) {
            when (val top = stack.lastOrNull()) {
                null ->
                    when (tab) {
                        Tab.INBOX -> InboxScreen(services.inbox, vm, push, openInvitation = { pasting = true })
                        Tab.AGREEMENTS -> AgreementsScreen(services.agreements, push, openInvitation = { pasting = true })
                        Tab.SIGNATURES -> SignaturesScreen(services.signatures, vm)
                    }
                is Route.Agreement -> AgreementScreen(services.agreement(top.ref), back = pop, push = push)
                is Route.Document -> key(top) { DocumentScreen(services.document(top.ref, top.documentId), back = pop) }
            }
        }
        if (stack.isEmpty()) {
            NavigationBar(containerColor = Palette.Surface, tonalElevation = 0.dp) {
                Tab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = item == tab,
                        onClick = { selectTab(item) },
                        icon = { Icon(item.icon, contentDescription = null) },
                        label = { Text(item.title, fontSize = 12.sp, fontWeight = FontWeight.Medium) },
                        colors =
                            NavigationBarItemDefaults.colors(
                                selectedIconColor = Palette.Ink,
                                selectedTextColor = Palette.Ink,
                                indicatorColor = Palette.Lime,
                                unselectedIconColor = Palette.Muted,
                                unselectedTextColor = Palette.Muted,
                            ),
                    )
                }
            }
        }
    }
    if (pasting) PasteInvitationSheet(dismiss = { pasting = false }) { vm.invitation.open(it) }
}

/** The front door: what Mero Sign is, and one way in. */
@Composable
private fun SignInScreen(
    vm: SignViewModel,
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
        ) { Icon(Icons.Outlined.Draw, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(38.dp)) }
        Spacer(Modifier.height(20.dp))
        Text("Mero Sign", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 34.sp, color = Palette.Ink)
        Spacer(Modifier.height(10.dp))
        Text(
            "Review and sign agreements peer to peer. Documents live on the nodes of the people who sign them.",
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
                Text("You're invited to sign “$invitedTo”. Sign in to accept.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
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

/** Join from a link: ask, join, open the agreement, then say where it landed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvitationSheet(
    vm: SignViewModel,
    open: (InvitationDestination) -> Unit,
) {
    val stage by vm.invitation.stage.collectAsState()
    val scope = rememberCoroutineScope()
    val joining = stage is InvitationModel.Stage.Joining
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !joining })

    fun accept() {
        scope.launch { vm.invitation.accept(directory = { vm.directory() }, didJoin = { vm.session.didJoinNamespace() }) }
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
                    SheetTitle("Open “${s.title}”?")
                    SheetBody("You'll join its workspace and be registered as a signer of this agreement.")
                    PrimaryButton("Join and open", ::accept)
                    SecondaryButton("Not now", { vm.invitation.reset() })
                }
                is InvitationModel.Stage.Joining -> {
                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.padding(top = 12.dp))
                    SheetTitle("Joining “${s.title}”")
                    Text(s.step, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.InkSoft)
                    SheetBody("This can take up to a minute when no other signer is online.")
                }
                is InvitationModel.Stage.Joined -> {
                    IconCircle(Icons.Filled.Check, Palette.Lime)
                    SheetTitle("You're in “${s.destination.agreement?.name ?: s.destination.workspaceName}”")
                    SheetBody(if (s.destination.agreement == null) "Its agreements appear in your inbox as they sync." else "Its documents are ready to review.")
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

/** Paste an invitation link someone sent you. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PasteInvitationSheet(
    dismiss: () -> Unit,
    open: (String) -> Unit,
) {
    var text by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current
    ModalBottomSheet(onDismissRequest = dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Palette.Surface) {
        SheetBar("Open an invitation", "Open", canAct = text.isNotBlank(), busy = false, cancel = dismiss, act = {
            dismiss()
            open(text)
        })
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Paste the link you were sent to sign an agreement.", fontSize = 15.sp, color = Palette.Muted)
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text("https://links.calimero.network/…", color = Palette.Muted) },
                textStyle =
                    androidx.compose.ui.text
                        .TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp, color = Palette.Ink),
                minLines = 3,
                maxLines = 6,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Palette.Ink, unfocusedBorderColor = Palette.Hairline),
            )
            SecondaryButton("Paste from clipboard", { text = clipboard.getText()?.text.orEmpty() }, compact = true, icon = Icons.Outlined.ContentPaste)
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** The account button in a top bar: who you are, open an invitation, sign out. */
@Composable
fun AccountMenu(
    vm: SignViewModel,
    openInvitation: (() -> Unit)? = null,
) {
    var open by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Outlined.AccountCircle, contentDescription = "Account", tint = Palette.Ink) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Palette.Surface) {
            vm.session.account?.let { account ->
                Text(
                    "Signed in as ${SignIds.short(account)}",
                    fontSize = 13.sp,
                    color = Palette.Muted,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
                DropdownMenuItem(
                    text = { Text("Copy account id") },
                    leadingIcon = { Icon(Icons.Outlined.ContentCopy, contentDescription = null) },
                    onClick = {
                        copy(context, "Account", account)
                        open = false
                    },
                )
            }
            if (openInvitation != null) {
                DropdownMenuItem(
                    text = { Text("Open an invitation link") },
                    leadingIcon = { Icon(Icons.Outlined.Link, contentDescription = null) },
                    onClick = {
                        open = false
                        openInvitation()
                    },
                )
            }
            DropdownMenuItem(
                text = { Text("Sign out", color = Palette.Danger) },
                leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = null, tint = Palette.Danger) },
                onClick = {
                    open = false
                    confirm = true
                },
            )
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Mero Sign?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    scope.launch { vm.session.signOut() }
                }) { Text("Sign out", color = Palette.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel", color = Palette.Ink) } },
            containerColor = Palette.Surface,
        )
    }
}

@Composable
fun SheetTitle(text: String) = Text(text, fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink, textAlign = TextAlign.Center)

@Composable
fun SheetBody(text: String) = Text(text, fontSize = 16.sp, color = Palette.Muted, textAlign = TextAlign.Center)

/** A top bar: back (when given), a title, trailing actions. */
@Composable
fun TopBar(
    title: String,
    back: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    Column(Modifier.background(Palette.Surface).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (back != null) {
                IconButton(onClick = back) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Palette.Ink)
                }
            } else {
                Spacer(Modifier.width(12.dp))
            }
            Text(
                title,
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = Palette.Ink,
                maxLines = 1,
                modifier = Modifier.weight(1f).clickable(enabled = false) {},
            )
            actions()
        }
        Hairline()
    }
}
