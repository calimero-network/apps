package network.calimero.pass.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.SendToMobile
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.pass.core.DeviceRecord
import network.calimero.pass.core.ItemFilter
import network.calimero.pass.core.ItemView
import network.calimero.pass.core.PassCrypto
import network.calimero.pass.core.PassErrorText
import network.calimero.pass.core.Role
import network.calimero.pass.core.Secret
import network.calimero.pass.core.SecretKind
import network.calimero.pass.core.SessionState
import network.calimero.pass.core.VaultModel
import java.text.DateFormat
import java.util.Date

/** A stamp as "12 Mar 2026, 14:05" (iOS: abbreviated date, short time). */
fun stamp(value: ULong): String = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ItemView.millis(value)))

/** One vault: its state, the devices asking to be let in, the filters and search, and the items. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(
    model: VaultModel,
    backend: MeroAppBackend,
    back: () -> Unit,
    push: (Route) -> Unit,
) {
    val services = LocalServices.current
    // Collected so every derived property below recomposes.
    val phase by model.phase.collectAsState()
    model.secrets.collectAsState().value
    model.info.collectAsState().value
    val approvals by model.approvals.collectAsState()
    val awaiting by model.awaitingApproval.collectAsState()
    val holders by model.holders.collectAsState()
    val error by model.error.collectAsState()
    val filter by model.filter.collectAsState()
    val query by model.query.collectAsState()
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf<SecretKind?>(null) }
    var invite by remember { mutableStateOf<InviteShown?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val ref = model.ref
    val state = model.state
    val flagged = model.flagged
    val trashedCount = model.trashed.size

    fun inviteSomeone() {
        scope.launch {
            runCatching { model.invite(backend) }
                .onSuccess { invite = InviteShown("Invite to ${ref.vaultName}", it, vaultInviteHint(ref.vaultName, ref.teamName)) }
                .onFailure { model.error.value = PassErrorText.describe(it) }
        }
    }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            PassTopBar(ref.vaultName, back = back, actions = {
                Box {
                    IconButton(onClick = { menu = true }, enabled = state != null) {
                        Icon(Icons.Outlined.MoreVert, contentDescription = "Vault menu")
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Palette.Surface) {
                        MenuItem("People and devices", Icons.Outlined.People) {
                            menu = false
                            push(Route.People(ref))
                        }
                        MenuItem(if (flagged > 0) "Password health ($flagged)" else "Password health", Icons.Outlined.HealthAndSafety) {
                            menu = false
                            push(Route.Health(ref))
                        }
                        MenuItem(if (trashedCount == 0) "Trash" else "Trash ($trashedCount)", Icons.Outlined.Delete) {
                            menu = false
                            push(Route.Trash(ref))
                        }
                        MenuItem("Activity", Icons.Outlined.History) {
                            menu = false
                            push(Route.Activity(ref))
                        }
                        HorizontalDivider(color = Palette.Hairline)
                        MenuItem("Invite someone", Icons.Outlined.PersonAdd) {
                            menu = false
                            inviteSomeone()
                        }
                    }
                }
                IconButton(onClick = { adding = newKind(filter) }, enabled = model.canWrite) {
                    Icon(Icons.Filled.AddCircle, contentDescription = "New item", tint = if (model.canWrite) Palette.Ink else Palette.Muted)
                }
            })
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    model.reload()
                    refreshing = false
                }
            },
            modifier = Modifier.padding(padding).fillMaxSize(),
        ) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
                item { SearchField("Search ${ref.vaultName}", query) { model.query.value = it } }
                item {
                    Row(Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Tile(ref.vaultName, 48.dp)
                        Spacer(Modifier.width(14.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(ref.vaultName, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                            Text(model.subtitle, fontSize = 13.sp, color = Palette.Muted)
                        }
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        error?.let { ErrorBanner(it) { model.error.value = null } }
                        when (val p = phase) {
                            is VaultModel.Phase.Opening ->
                                Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Text(p.notice?.let { "$it Trying again on its own." } ?: "Opening the vault…", fontSize = 14.sp, color = Palette.InkSoft)
                                }
                            is VaultModel.Phase.Failed -> ErrorState(p.message) { scope.launch { model.retry() } }
                            is VaultModel.Phase.Open -> StateBanner(model, p.state, awaiting)
                        }
                        holders?.let {
                            if (it.browsers <= 1 && it.recovery == 0) {
                                Banner(
                                    Tone.WARN,
                                    Icons.Filled.Warning,
                                    "Lose it and the items are gone. Create a recovery key under Security, or open the vault on a second device.",
                                    title = "Only this phone can open this vault.",
                                )
                            }
                        }
                        if (state == SessionState.READY && approvals.isNotEmpty()) ApprovalsCard(model, approvals)
                    }
                }
                if (model.readable) {
                    if (model.live.isNotEmpty()) item { Filters(model, filter) }
                    val shown = model.shown
                    if (shown.isEmpty()) {
                        item {
                            when {
                                query.isNotEmpty() ->
                                    EmptyState(Icons.Outlined.Search, "Nothing matches", "Search looks at names, tags, usernames and sites, never at passwords.")
                                state == SessionState.WAITING ->
                                    EmptyState(Icons.Outlined.Lock, "Locked for now", "Items appear here once this phone has the vault key.")
                                model.live.isEmpty() ->
                                    EmptyState(
                                        Icons.Outlined.Key,
                                        "This vault is empty",
                                        "Everything you add is encrypted on this phone before it leaves.",
                                        action = if (model.canWrite) "Add your first item" else null,
                                    ) { adding = SecretKind.LOGIN }
                                else -> EmptyState(Icons.Outlined.Inbox, "Nothing here yet", "Nothing in this category.")
                            }
                        }
                    } else {
                        items(shown, key = { it.id }) { secret ->
                            val copy = primaryCopy(secret)
                            SwipeRow(
                                start = copy?.let { (label, value) -> SwipeAction("Copy ${label.lowercase()}", Icons.Outlined.ContentCopy, Palette.Ink) { services.copySecret(value, label) } },
                                end =
                                    if (model.canWrite) {
                                        SwipeAction("Trash", Icons.Outlined.Delete, Palette.Danger) {
                                            scope.launch { if (model.trash(secret.id)) services.show("Moved to trash.") }
                                        }
                                    } else {
                                        null
                                    },
                            ) { ItemRow(secret) { push(Route.Item(ref, secret.id)) } }
                            HorizontalDivider(color = Palette.Hairline, thickness = 0.5.dp, modifier = Modifier.padding(start = 68.dp))
                        }
                    }
                }
            }
        }
    }

    adding?.let { kind ->
        ItemEditorSheet(model, editing = null, initialKind = kind, dismiss = { adding = null }) {
            services.show("Saved, encrypted on this phone.")
        }
    }
    invite?.let { InviteLinkSheet(it.title, it.link, it.hint) { invite = null } }
}

private fun newKind(filter: ItemFilter): SecretKind = (filter as? ItemFilter.Kind)?.let { SecretKind.of(it.kind) } ?: SecretKind.LOGIN

/** What a right swipe copies: the password, else the kind's first secret field. */
private fun primaryCopy(s: Secret): Pair<String, String>? {
    if (s.unreadable) return null
    val kind = SecretKind.of(s.kind) ?: return null
    return kind.fields
        .filter { it.secret && !it.totp }
        .firstNotNullOfOrNull { f -> s.fields[f.key]?.takeIf { it.isNotEmpty() }?.let { f.label to it } }
}

@Composable
private fun MenuItem(
    text: String,
    icon: ImageVector,
    onClick: () -> Unit,
) {
    DropdownMenuItem(text = { Text(text) }, leadingIcon = { Icon(icon, null) }, onClick = onClick)
}

@Composable
private fun SearchField(
    placeholder: String,
    value: String,
    onChange: (String) -> Unit,
) {
    Row(
        Modifier
            .padding(start = 16.dp, end = 16.dp, top = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.Sunken)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, fontSize = 16.sp, color = Palette.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(fontSize = 16.sp, color = Palette.Ink),
                cursorBrush = SolidColor(Palette.Ink),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Clear search",
                tint = Palette.Muted,
                modifier = Modifier.size(18.dp).clickable { onChange("") },
            )
        }
    }
}

@Composable
private fun StateBanner(
    model: VaultModel,
    state: SessionState,
    awaiting: Boolean,
) {
    when (state) {
        SessionState.READY -> Unit
        SessionState.UNINITIALISED ->
            Banner(Tone.WARN, Icons.Outlined.Key, "This vault has no key yet. It is created the first time its Admin opens it.")
        SessionState.WAITING ->
            when {
                model.role == Role.PENDING ->
                    Banner(
                        Tone.WARN,
                        Icons.Outlined.HourglassEmpty,
                        "A vault Admin lets you in the next time they open this vault. This screen updates by itself.",
                        title = "You are in, but not admitted yet.",
                    )
                awaiting ->
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Banner(
                            Tone.WARN,
                            Icons.AutoMirrored.Outlined.SendToMobile,
                            "On another device of yours that opens this vault, or from a vault Admin, approve the request showing this code. Lost every other device? Use your recovery key under Security.",
                            title = "Approve this phone.",
                        )
                        Text(
                            model.myCode,
                            fontSize = 30.sp,
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Palette.Ink,
                            textAlign = TextAlign.Center,
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Palette.Surface)
                                    .border(0.5.dp, Palette.Hairline, RoundedCornerShape(12.dp))
                                    .padding(vertical = 12.dp),
                        )
                    }
                else ->
                    Banner(
                        Tone.WARN,
                        Icons.Outlined.HourglassEmpty,
                        "It arrives as soon as a member who holds it opens the vault. Nothing to do here.",
                        title = "Waiting for the vault key.",
                    )
            }
    }
}

@Composable
private fun Filters(
    model: VaultModel,
    filter: ItemFilter,
) {
    val counts = model.counts
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Chip("All", null, model.live.size, filter == ItemFilter.All) { model.filter.value = ItemFilter.All }
        SecretKind.categoryOrder.filter { (counts[it.wire] ?: 0) > 0 }.forEach { kind ->
            Chip(kind.plural, KindIcon.of(kind.wire), counts[kind.wire] ?: 0, filter == ItemFilter.Kind(kind.wire)) {
                model.filter.value = ItemFilter.Kind(kind.wire)
            }
        }
        model.tags.forEach { tag ->
            Chip(tag, KindIcon.tag, null, filter == ItemFilter.Tag(tag)) { model.filter.value = ItemFilter.Tag(tag) }
        }
    }
}

@Composable
private fun Chip(
    label: String,
    icon: ImageVector?,
    count: Int?,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .clip(CircleShape)
            .background(if (selected) Palette.Lime else Palette.Surface)
            .then(if (selected) Modifier else Modifier.border(BorderStroke(1.dp, Palette.Hairline), CircleShape))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(14.dp))
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
        if (count != null && count > 0) {
            Text("$count", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (selected) Palette.Ink else Palette.Muted)
        }
    }
}

@Composable
private fun ItemRow(
    secret: Secret,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Palette.Surface)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Tile(secret.name, 40.dp)
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 4.dp, y = 4.dp)
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(Palette.Surface)
                    .border(0.5.dp, Palette.Hairline, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(KindIcon.of(secret.kind), contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(11.dp)) }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(secret.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (secret.unreadable) "Sealed under a key this phone never received" else ItemView.subtitle(secret),
                fontSize = 13.sp,
                color = Palette.Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (secret.unreadable) Icon(Icons.Filled.Lock, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
    }
}

/** Devices asking for this vault, with Approve / Deny (the web's `DeviceApprovals`). */
@Composable
private fun ApprovalsCard(
    model: VaultModel,
    approvals: List<DeviceRecord>,
) {
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    PassCard {
        Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Devices asking for this vault", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text(
                "Approve only a device you recognise, showing the same code. Approving gives it every key of this vault, old ones included." +
                    if (approvals.any { it.kind == "agent" }) " An agent can then read every secret here: give one a vault that holds only what it should use." else "",
                fontSize = 13.sp,
                color = Palette.Muted,
            )
            approvals.forEach { request ->
                val agent = request.kind == "agent"
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(if (agent) Icons.Outlined.Memory else Icons.Outlined.PhoneAndroid, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
                        Text(
                            request.label.ifEmpty { if (agent) "Agent" else "Device" },
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Palette.Ink,
                        )
                        if (agent) PassBadge("agent")
                        Spacer(Modifier.weight(1f))
                        Text(PassCrypto.confirmationCode(request.fingerprint), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, color = Palette.Ink)
                    }
                    Text(
                        (if (request.account == model.me) "your account" else "account ${ItemView.shortAccount(request.account)}") +
                            " · registered ${stamp(request.addedAt)}",
                        fontSize = 12.sp,
                        color = Palette.Muted,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        PrimaryButton("Approve", {
                            busy = request.fingerprint
                            scope.launch {
                                model.approve(request)
                                busy = null
                            }
                        }, enabled = busy == null, compact = true)
                        SecondaryButton("Deny", {
                            busy = request.fingerprint
                            scope.launch {
                                model.deny(request)
                                busy = null
                            }
                        }, enabled = busy == null, compact = true)
                        if (busy == request.fingerprint) CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    }
                }
            }
        }
    }
}
