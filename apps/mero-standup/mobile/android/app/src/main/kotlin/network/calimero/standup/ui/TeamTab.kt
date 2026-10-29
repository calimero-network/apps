package network.calimero.standup.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.SwapHoriz
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.standup.app.StandupViewModel
import network.calimero.standup.app.TeamModel
import network.calimero.standup.core.Days
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.Limits

/** The Team tab: its name, invitations, your name, the people, switch team, sign out, details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeamTab(
    vm: StandupViewModel,
    team: TeamModel,
    platform: Platform,
) {
    val scope = rememberCoroutineScope()
    val teamName by team.teamName.collectAsState()
    val myName by team.myName.collectAsState()
    val members by team.members.collectAsState()
    val me by team.me.collectAsState()
    var link by remember { mutableStateOf<String?>(null) }
    var minting by remember { mutableStateOf(false) }
    var inviteError by remember { mutableStateOf<String?>(null) }
    var renamingTeam by remember { mutableStateOf(false) }
    var renamingMe by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf(false) }

    Scaffold(containerColor = Palette.background, topBar = { TabBar(team.title) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { SectionLabel("Team") }
            item {
                StandupCard(padding = 4.dp) {
                    Row(name = "Name", value = teamName.ifEmpty { "Name this team" }, icon = Icons.Outlined.Edit) { renamingTeam = true }
                }
            }
            item { SectionLabel("Invite") }
            item {
                StandupCard {
                    Muted("One link. Whoever opens it joins this team and sees its standups and decisions; nobody without one can.")
                    PrimaryButton(
                        if (minting) {
                            "Creating…"
                        } else if (link == null) {
                            "Create invite link"
                        } else {
                            "Create another"
                        },
                        busy = minting,
                        icon = Icons.Outlined.Link,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            minting = true
                            inviteError = null
                            scope.launch {
                                try {
                                    link = team.inviteLink()
                                } catch (e: Exception) {
                                    inviteError = ErrorText.describe(e)
                                } finally {
                                    minting = false
                                }
                            }
                        },
                    )
                    link?.let { l ->
                        Text(l, maxLines = 1, overflow = TextOverflow.Ellipsis, fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Palette.ink2)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SecondaryButton("Share", onClick = { platform.share("Join ${team.title} on Mero Standup", l) }, icon = Icons.Outlined.Share)
                            SecondaryButton("Copy", onClick = { platform.copy("Invitation link", l) }, icon = Icons.Outlined.ContentCopy)
                        }
                    }
                    ErrorLine(inviteError)
                }
            }
            item { SectionLabel("You") }
            item {
                StandupCard(padding = 4.dp) {
                    Row(name = "Your name", value = myName.ifEmpty { "Not set" }, icon = Icons.Outlined.Edit) { renamingMe = true }
                }
            }
            if (members.isNotEmpty()) {
                item { SectionLabel("People") }
                item {
                    StandupCard {
                        for (m in members) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Avatar(m.account, m.name, 32.dp)
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(team.name(m.account, m.name), fontWeight = FontWeight.Medium)
                                    Text(
                                        if (m.lastDay.isEmpty()) "Hasn't posted" else "Last posted ${Days.describe(m.lastDay).lowercase()}",
                                        fontSize = 13.sp,
                                        color = Palette.ink3,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            item {
                StandupCard(padding = 4.dp) {
                    Row(name = "Switch team", icon = Icons.Outlined.SwapHoriz) { vm.open(null) }
                    Row(name = "Sign out", icon = Icons.AutoMirrored.Outlined.Logout, color = Palette.danger) { vm.signOut() }
                }
            }
            item {
                Row(Modifier.clickable { details = !details }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Details", color = Palette.ink2, fontWeight = FontWeight.Medium)
                }
            }
            if (details) {
                items(listOf("Team (context) id" to team.contextId, "Namespace id" to team.namespaceId, "Your account" to (me ?: ""))) { (label, value) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(label, fontSize = 12.sp, color = Palette.ink3)
                            Text(value, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                        }
                        IconButton(onClick = { platform.copy(label, value) }) { Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy") }
                    }
                }
            }
        }
    }

    if (renamingTeam) {
        RenameSheet("Name this team", teamName, Limits.TEAM_NAME, onDismiss = { renamingTeam = false }) { team.renameTeam(it) }
    }
    if (renamingMe) {
        RenameSheet("Your name", myName, Limits.NAME, onDismiss = { renamingMe = false }) { team.setMyName(it) }
    }
}

@Composable
private fun Row(
    name: String,
    value: String? = null,
    icon: ImageVector,
    color: Color = Palette.ink,
    onClick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, color = color, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(value, color = Palette.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 8.dp).weight(1f, fill = false))
        }
        Icon(icon, contentDescription = null, tint = if (color == Palette.ink) Palette.ink2 else color, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun RenameSheet(
    title: String,
    current: String,
    max: Int,
    onDismiss: () -> Unit,
    save: suspend (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(current) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    StandupSheet(title, onDismiss) {
        LabeledField(null, value, { value = it }, title, max, singleLine = true)
        ErrorLine(error)
        PrimaryButton(if (busy) "Saving…" else "Save", busy = busy, modifier = Modifier.fillMaxWidth(), onClick = {
            busy = true
            scope.launch {
                try {
                    save(value)
                    onDismiss()
                } catch (e: Exception) {
                    error = ErrorText.describe(e)
                } finally {
                    busy = false
                }
            }
        })
    }
}
