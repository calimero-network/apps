package network.calimero.pass.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.pass.core.ItemView
import network.calimero.pass.core.PasswordTools
import network.calimero.pass.core.Revision
import network.calimero.pass.core.SecretKind
import network.calimero.pass.core.Totp
import network.calimero.pass.core.VaultModel

/**
 * One item: its fields with reveal and copy, the live authenticator code, strength, tags, who
 * changed it, previous values, edit, share and trash.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemDetailScreen(
    model: VaultModel,
    secretId: String,
    back: () -> Unit,
) {
    val services = LocalServices.current
    val context = LocalContext.current
    model.secrets.collectAsState().value
    model.info.collectAsState().value
    model.phase.collectAsState().value
    val scope = rememberCoroutineScope()
    val secret = model.secret(secretId)
    var revealed by remember { mutableStateOf(setOf<String>()) }
    var history by remember { mutableStateOf<List<Revision>?>(null) }
    var editing by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var confirmTrash by remember { mutableStateOf(false) }
    // Revealed values are forgotten when the screen goes.
    DisposableEffect(Unit) { onDispose { revealed = emptySet() } }

    Scaffold(
        containerColor = Palette.Ground,
        topBar = {
            PassTopBar("", back = back, actions = {
                if (secret != null && !secret.unreadable) {
                    IconButton(onClick = { sharing = true }) { Icon(Icons.Outlined.Share, contentDescription = "Share") }
                    if (model.canWrite) {
                        TextButton(onClick = { editing = true }) { Text("Edit", color = Palette.Ink, fontWeight = FontWeight.SemiBold) }
                    }
                }
            })
        },
    ) { padding ->
        if (secret == null) {
            Box(Modifier.padding(padding).fillMaxSize()) {
                EmptyState(Icons.Outlined.Inbox, "This item is gone", "It was moved or deleted on another device.")
            }
            return@Scaffold
        }
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
            item {
                Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Tile(secret.name, 56.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(secret.name, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(KindIcon.of(secret.kind), contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(SecretKind.labelOf(secret.kind), fontSize = 14.sp, color = Palette.Muted)
                        }
                    }
                }
                if (secret.unreadable) {
                    Banner(
                        Tone.WARN,
                        Icons.Outlined.Lock,
                        "Part of this item is sealed under a key this phone never received.",
                        Modifier.padding(horizontal = 16.dp),
                    )
                }
            }
            item {
                PassSection {
                    val fields = ItemView.orderedFields(secret)
                    fields.forEachIndexed { index, field ->
                        FieldRow(
                            kind = secret.kind,
                            key = field.key,
                            label = field.label,
                            value = field.value,
                            revealed = field.key in revealed,
                            toggle = { revealed = if (field.key in revealed) revealed - field.key else revealed + field.key },
                            copy = { services.copySecret(field.value, field.label) },
                            open =
                                if (field.key == "url") {
                                    ItemView.openableUrl(field.value)?.let { url ->
                                        { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
                                    }
                                } else {
                                    null
                                },
                        )
                        if (index < fields.lastIndex) RowDivider()
                    }
                }
            }
            if (secret.tags.isNotEmpty()) {
                item {
                    PassSection(header = "Tags") {
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            secret.tags.forEach { tag ->
                                Row(
                                    Modifier.clip(CircleShape).background(Palette.Sunken).padding(horizontal = 10.dp, vertical = 5.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(KindIcon.tag, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(13.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text(tag, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                                }
                            }
                        }
                    }
                }
            }
            item {
                PassSection {
                    Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Modified ${stamp(secret.updatedAt)} by ${ItemView.who(secret.updatedBy, model.me)}", fontSize = 13.sp, color = Palette.Muted)
                        Text("Created ${stamp(secret.createdAt)} by ${ItemView.who(secret.createdBy, model.me)}", fontSize = 13.sp, color = Palette.Muted)
                    }
                    RowDivider()
                    RowAction(if (history == null) "Previous values" else "Hide previous values", Icons.Outlined.History, {
                        scope.launch { history = if (history == null) model.history(secret.id) else null }
                    })
                    history?.let { revisions ->
                        if (revisions.isEmpty()) Text("No earlier values.", fontSize = 14.sp, color = Palette.Muted, modifier = Modifier.padding(bottom = 10.dp))
                        revisions.forEach { revision ->
                            RowDivider()
                            RevisionRow(revision, secret.kind, model.me, model.canWrite) {
                                scope.launch {
                                    if (model.restoreRevision(revision, secret)) {
                                        services.show("Restored.")
                                        history = model.history(secret.id)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (model.canWrite) {
                item { PassSection { RowAction("Move to trash", Icons.Outlined.Delete, { confirmTrash = true }, destructive = true) } }
            }
        }
    }

    if (secret != null) {
        if (confirmTrash) {
            ConfirmDialog(
                title = "Move “${secret.name}” to the trash?",
                message = "It stays recoverable in the trash until an Admin deletes it for good.",
                confirm = "Move to trash",
                dismiss = { confirmTrash = false },
            ) {
                scope.launch {
                    if (model.trash(secret.id)) {
                        services.show("Moved to trash.")
                        back()
                    }
                }
            }
        }
        if (editing) {
            ItemEditorSheet(model, editing = secret, initialKind = SecretKind.of(secret.kind) ?: SecretKind.LOGIN, dismiss = { editing = false }) {
                services.show("Saved, encrypted on this phone.")
                history = null
            }
        }
        if (sharing) ShareSecretSheet(secret) { sharing = false }
    }
}

/** One field: masked until revealed when sensitive, a live code for a seed. */
@Composable
private fun FieldRow(
    kind: String,
    key: String,
    label: String,
    value: String,
    revealed: Boolean,
    toggle: () -> Unit,
    copy: () -> Unit,
    open: (() -> Unit)?,
) {
    val sensitive = SecretKind.isSensitive(kind, key)
    val totp = SecretKind.isTotpField(kind, key)
    val shown = !sensitive || revealed
    Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(if (totp) "One-time code" else label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
        if (totp) {
            TotpView(value)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (shown) value else "••••••••••••",
                    fontSize = 16.sp,
                    fontFamily = if (sensitive) FontFamily.Monospace else FontFamily.Default,
                    color = Palette.Ink,
                    maxLines = if (SecretKind.isMultiline(kind, key)) Int.MAX_VALUE else 2,
                    modifier = Modifier.weight(1f),
                )
                if (sensitive) {
                    RoundIconButton(
                        if (revealed) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                        if (revealed) "Hide $label" else "Reveal $label",
                        toggle,
                    )
                }
                if (open != null) RoundIconButton(Icons.AutoMirrored.Outlined.OpenInNew, "Open website", open)
                RoundIconButton(Icons.Outlined.ContentCopy, "Copy $label", copy)
            }
            if (key == "password" && shown) StrengthMeter(PasswordTools.strength(value))
        }
    }
}

/** The six (or eight) digits, refreshed every second, with a ring for the time left. */
@Composable
private fun TotpView(seed: String) {
    val services = LocalServices.current
    val params = remember(seed) { Totp.parse(seed) }
    if (params == null) {
        Text("Not a valid authenticator seed", fontSize = 14.sp, color = Palette.Danger)
        return
    }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(params) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000L - now % 1_000L)
        }
    }
    val code = Totp.code(params, now)
    val left = Totp.secondsRemaining(params.period, now)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            code.take(code.length / 2) + " " + code.drop(code.length / 2),
            fontSize = 26.sp,
            fontWeight = FontWeight.SemiBold,
            fontFamily = FontFamily.Monospace,
            color = Palette.Ink,
        )
        Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(
                progress = { left.toFloat() / params.period },
                color = if (left <= 5) Palette.Danger else Palette.Ink,
                trackColor = Palette.Sunken,
                strokeWidth = 3.dp,
                modifier = Modifier.size(26.dp),
            )
            Text("$left", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = Palette.InkSoft)
        }
        Spacer(Modifier.weight(1f))
        RoundIconButton(Icons.Outlined.ContentCopy, "Copy code") { services.copySecret(code, "Code") }
    }
}

@Composable
private fun RevisionRow(
    revision: Revision,
    kind: String,
    me: String?,
    canRestore: Boolean,
    restore: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "${revision.field.replace('_', ' ')} · ${stamp(revision.replacedAt)} · ${ItemView.who(revision.replacedBy, me)}",
                fontSize = 12.sp,
                color = Palette.Muted,
            )
            Text(
                when {
                    revision.unreadable -> "sealed under a key this phone never had"
                    SecretKind.isSensitive(kind, revision.field) -> "••••••••"
                    else -> revision.previous
                },
                fontSize = 14.sp,
                fontFamily = FontFamily.Monospace,
                color = Palette.Ink,
                maxLines = 2,
            )
        }
        if (!revision.unreadable && canRestore) SecondaryButton("Restore", restore, compact = true)
    }
}
