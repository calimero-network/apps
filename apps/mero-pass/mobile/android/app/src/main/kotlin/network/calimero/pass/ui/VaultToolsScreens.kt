package network.calimero.pass.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.DeleteForever
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material.icons.outlined.RemoveModerator
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.VerifiedUser
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.pass.core.AuditRecord
import network.calimero.pass.core.DeviceRecord
import network.calimero.pass.core.ItemView
import network.calimero.pass.core.LoadPhase
import network.calimero.pass.core.MemberRecord
import network.calimero.pass.core.PasswordTools
import network.calimero.pass.core.PeopleModel
import network.calimero.pass.core.Role
import network.calimero.pass.core.Secret
import network.calimero.pass.core.VaultModel

/** A pull-to-refresh list under the shared top bar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ToolScaffold(
    title: String,
    back: () -> Unit,
    refresh: (suspend () -> Unit)? = null,
    content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    Scaffold(containerColor = Palette.Ground, topBar = { PassTopBar(title, back = back) }) { padding ->
        val list = @Composable { LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp), content = content) }
        if (refresh == null) {
            Box(Modifier.padding(padding).fillMaxSize()) { list() }
        } else {
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        refresh()
                        refreshing = false
                    }
                },
                modifier = Modifier.padding(padding).fillMaxSize(),
            ) { list() }
        }
    }
}

/** People and the devices holding the key (the web's `VaultPeople`). */
@Composable
fun PeopleScreen(
    vault: VaultModel,
    back: () -> Unit,
) {
    val model = remember(vault) { PeopleModel(vault.session, vault.api) }
    val members by model.members.collectAsState()
    val devices by model.devices.collectAsState()
    val phase by model.phase.collectAsState()
    val status by model.status.collectAsState()
    val error by model.error.collectAsState()
    val info by vault.info.collectAsState()
    val scope = rememberCoroutineScope()
    var confirmRemove by remember { mutableStateOf<MemberRecord?>(null) }
    var confirmRevoke by remember { mutableStateOf<DeviceRecord?>(null) }
    var confirmRotate by remember { mutableStateOf(false) }
    var roleMenu by remember { mutableStateOf<String?>(null) }
    val working = status?.endsWith("…") == true

    LaunchedEffect(model) { model.load() }

    fun after(ok: Boolean) {
        if (ok) scope.launch { vault.reload() }
    }

    ToolScaffold("People", back, refresh = { model.load() }) {
        item {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "The vault key is wrapped to each device below. Removing someone or revoking a device rotates the key, so nothing written afterwards is readable to them. What they already saw cannot be taken back: change those passwords.",
                    fontSize = 14.sp,
                    color = Palette.Muted,
                )
                error?.let { ErrorBanner(it) { model.error.value = null } }
                status?.let { Banner(Tone.INFO, Icons.Outlined.VerifiedUser, it) { model.clearStatus() } }
            }
        }
        if (phase == LoadPhase.Loading && members.isEmpty()) item { LoadingBox() }
        item {
            PassSection(header = "People") {
                members.forEachIndexed { index, member ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Tile(member.account, 36.dp, icon = Icons.Filled.Person)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(
                                    ItemView.shortAccount(member.account) + if (member.account == vault.me) " (you)" else "",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Palette.Ink,
                                )
                                PassBadge(member.role.wire, strong = member.role == Role.ADMIN)
                            }
                            Text(
                                "${PeopleModel.roleHelp[member.role].orEmpty()} · ${member.devices} device${if (member.devices == 1) "" else "s"}",
                                fontSize = 12.sp,
                                color = Palette.Muted,
                            )
                        }
                        if (vault.isAdmin && member.account != vault.me) {
                            Box {
                                IconButton(onClick = { roleMenu = member.account }, enabled = !working) {
                                    Icon(Icons.Outlined.MoreVert, contentDescription = "Change role", tint = Palette.InkSoft)
                                }
                                DropdownMenu(expanded = roleMenu == member.account, onDismissRequest = { roleMenu = null }, containerColor = Palette.Surface) {
                                    listOf(Role.VIEWER, Role.EDITOR, Role.ADMIN).forEach { role ->
                                        DropdownMenuItem(
                                            text = { Text(role.wire.replaceFirstChar { it.uppercase() }) },
                                            leadingIcon = { if (member.role == role) Icon(Icons.Filled.Check, null) },
                                            onClick = {
                                                roleMenu = null
                                                scope.launch { model.setRole(member.account, role) }
                                            },
                                        )
                                    }
                                    if (member.role != Role.REMOVED) {
                                        HorizontalDivider(color = Palette.Hairline)
                                        DropdownMenuItem(
                                            text = { Text("Remove from vault", color = Palette.Danger) },
                                            leadingIcon = { Icon(Icons.Outlined.PersonRemove, null, tint = Palette.Danger) },
                                            onClick = {
                                                roleMenu = null
                                                confirmRemove = member
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                    if (index < members.lastIndex) RowDivider()
                }
            }
        }
        item {
            PassSection(header = "Devices holding the key", footer = "Swipe a device to revoke it.") {
                devices.forEachIndexed { index, device ->
                    val mine = device.fingerprint == vault.session.fingerprint
                    val canRevoke = !device.revoked && (vault.isAdmin || device.account == vault.me)
                    SwipeRow(end = if (canRevoke && !working) SwipeAction("Revoke", Icons.Outlined.RemoveModerator, Palette.Danger) { confirmRevoke = device } else null) {
                        Row(Modifier.fillMaxWidth().background(Palette.Surface).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Palette.Sunken), contentAlignment = Alignment.Center) {
                                Icon(KindIcon.device(device.kind), contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        device.label.ifEmpty { if (device.kind == "agent") "Agent" else "Device" } + if (mine) " (this phone)" else "",
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Palette.Ink,
                                    )
                                    if (device.kind == "agent") PassBadge("agent")
                                    if (device.revoked) PassBadge("revoked")
                                }
                                Text(
                                    "${device.fingerprint.take(16)}… · ${if (device.account == vault.me) "yours" else ItemView.shortAccount(device.account)}",
                                    fontSize = 12.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = Palette.Muted,
                                )
                            }
                        }
                    }
                    if (index < devices.lastIndex) RowDivider()
                }
            }
        }
        if (vault.isAdmin) {
            item {
                PassSection(header = "Admin") {
                    val current = if (info?.defaultRole == "viewer") Role.VIEWER else Role.EDITOR
                    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Newcomers join as", fontSize = 16.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                        listOf(Role.EDITOR to "Editor", Role.VIEWER to "Viewer").forEach { (role, label) ->
                            Text(
                                label,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Palette.Ink,
                                modifier =
                                    Modifier
                                        .padding(start = 6.dp)
                                        .clip(CircleShape)
                                        .background(if (current == role) Palette.Lime else Palette.Sunken)
                                        .clickable(enabled = !working && current != role) { scope.launch { after(model.setDefaultRole(role)) } }
                                        .padding(horizontal = 12.dp, vertical = 6.dp),
                            )
                        }
                    }
                    RowDivider()
                    RowAction("Rotate vault key", Icons.Outlined.Autorenew, { confirmRotate = true }, enabled = !working)
                }
            }
        }
    }

    confirmRemove?.let { member ->
        ConfirmDialog(
            "Remove ${ItemView.shortAccount(member.account)}?",
            "The vault key is rotated so nothing written afterwards is readable to them.",
            "Remove and rotate",
            dismiss = { confirmRemove = null },
        ) { scope.launch { after(model.remove(member.account)) } }
    }
    confirmRevoke?.let { device ->
        ConfirmDialog(
            "Revoke this device?",
            if (vault.isAdmin) "The vault key is rotated as well." else "It stops receiving this vault's keys.",
            "Revoke",
            dismiss = { confirmRevoke = null },
        ) { scope.launch { after(model.revoke(device)) } }
    }
    if (confirmRotate) {
        ConfirmDialog(
            "Rotate the vault key?",
            "A new key is given to every device still entitled to it, and every item is re-encrypted under it.",
            "Rotate and re-encrypt",
            dismiss = { confirmRotate = false },
            destructive = false,
        ) { scope.launch { after(model.rotate()) } }
    }
}

/** Weak, reused and old passwords (the web's `HealthPanel`). */
@Composable
fun HealthScreen(
    model: VaultModel,
    back: () -> Unit,
    open: (String) -> Unit,
) {
    model.secrets.collectAsState().value
    val rows = PasswordTools.analyse(model.live)
    val flagged = rows.filter { it.issues.isNotEmpty() }
    ToolScaffold("Password health", back) {
        item {
            Text(
                "Checked on this phone, over the decrypted items. Nothing is sent anywhere.",
                fontSize = 14.sp,
                color = Palette.Muted,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }
        when {
            rows.isEmpty() -> item { EmptyState(Icons.Outlined.HealthAndSafety, "No passwords yet", "Logins with a password show up here.") }
            flagged.isEmpty() ->
                item { EmptyState(Icons.Outlined.VerifiedUser, "All ${rows.size} passwords look healthy", "None is weak, reused or over a year old.") }
            else ->
                item {
                    PassSection(header = "${flagged.size} of ${rows.size} need attention") {
                        flagged.forEachIndexed { index, row ->
                            Row(Modifier.fillMaxWidth().clickable { open(row.id) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Tile(row.name, 36.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(row.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { row.issues.forEach { PassBadge(it.label) } }
                                }
                                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
                            }
                            if (index < flagged.lastIndex) RowDivider()
                        }
                    }
                }
        }
    }
}

/** Trashed items, restorable until an Admin deletes them for good. */
@Composable
fun TrashScreen(
    model: VaultModel,
    back: () -> Unit,
) {
    val services = LocalServices.current
    model.secrets.collectAsState().value
    model.info.collectAsState().value
    val scope = rememberCoroutineScope()
    var confirmPurge by remember { mutableStateOf<Secret?>(null) }
    val trashed = model.trashed
    ToolScaffold("Trash", back) {
        if (trashed.isEmpty()) {
            item { EmptyState(Icons.Outlined.Delete, "The trash is empty", "Items stay recoverable here until an Admin deletes them for good.") }
        } else {
            item {
                PassSection(footer = "Swipe right to restore${if (model.isAdmin) ", left to delete forever" else ""}.") {
                    trashed.forEachIndexed { index, secret ->
                        SwipeRow(
                            start =
                                if (model.canWrite) {
                                    SwipeAction("Restore", Icons.AutoMirrored.Outlined.Undo, Palette.Ink) {
                                        scope.launch { if (model.restore(secret.id)) services.show("Restored.") }
                                    }
                                } else {
                                    null
                                },
                            end = if (model.isAdmin) SwipeAction("Delete forever", Icons.Outlined.DeleteForever, Palette.Danger) { confirmPurge = secret } else null,
                        ) {
                            Row(Modifier.fillMaxWidth().background(Palette.Surface).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(KindIcon.of(secret.kind), contentDescription = null, tint = Palette.Ink, modifier = Modifier.width(28.dp))
                                Spacer(Modifier.width(12.dp))
                                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Text(secret.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                                    Text("Trashed ${stamp(secret.trashedAt)}", fontSize = 12.sp, color = Palette.Muted)
                                }
                            }
                        }
                        if (index < trashed.lastIndex) RowDivider()
                    }
                }
            }
        }
    }
    confirmPurge?.let { secret ->
        ConfirmDialog("Delete “${secret.name}” forever?", "This cannot be undone.", "Delete forever", dismiss = { confirmPurge = null }) {
            scope.launch { model.purge(secret.id) }
        }
    }
}

/** The vault's activity trail (the web's `ActivityList`). */
@Composable
fun ActivityScreen(
    model: VaultModel,
    back: () -> Unit,
) {
    var events by remember { mutableStateOf<List<AuditRecord>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    model.secrets.collectAsState().value
    LaunchedEffect(model) {
        events = model.activity()
        loaded = true
    }
    ToolScaffold("Activity", back, refresh = { events = model.activity() }) {
        if (!loaded) item { LoadingBox() }
        if (loaded && events.isEmpty()) item { EmptyState(Icons.Outlined.Schedule, "Nothing yet", "Nothing has happened in this vault yet.") }
        if (events.isNotEmpty()) {
            item {
                PassSection {
                    events.forEachIndexed { index, event ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
                            Box(
                                Modifier
                                    .padding(top = 5.dp)
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(Palette.Lime),
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(
                                    if (event.redacted) "entry redacted by its author" else event.action.replace('_', ' ').replace(':', ' '),
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Palette.Ink,
                                )
                                Text(model.secret(event.target)?.name ?: event.target.take(24), fontSize = 14.sp, color = Palette.InkSoft)
                                Text(
                                    "${stamp(event.timestamp)} · ${ItemView.who(event.account, model.me)} · device ${event.device.take(8)}",
                                    fontSize = 12.sp,
                                    color = Palette.Muted,
                                )
                            }
                        }
                        if (index < events.lastIndex) RowDivider()
                    }
                }
            }
        }
    }
}
