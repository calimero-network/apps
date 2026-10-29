package network.calimero.pass.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import network.calimero.pass.core.FieldSpec
import network.calimero.pass.core.PassConstants
import network.calimero.pass.core.PassErrorText
import network.calimero.pass.core.PasswordTools
import network.calimero.pass.core.Secret
import network.calimero.pass.core.SecretDraft
import network.calimero.pass.core.SecretKind
import network.calimero.pass.core.ShareLink
import network.calimero.pass.core.VaultModel

/**
 * New or edit item (the web's `SecretForm`): name, kind, the kind's fields, the password
 * generator, tags. Encrypted on the phone before it is saved.
 */
@Composable
fun ItemEditorSheet(
    model: VaultModel,
    editing: Secret?,
    initialKind: SecretKind,
    dismiss: () -> Unit,
    onSaved: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(editing?.name.orEmpty()) }
    var kind by remember { mutableStateOf(editing?.let { SecretKind.of(it.kind) } ?: initialKind) }
    var values by remember { mutableStateOf(editing?.fields ?: emptyMap()) }
    var tags by remember { mutableStateOf(editing?.tags?.joinToString(", ").orEmpty()) }
    var length by remember { mutableFloatStateOf(PasswordTools.GENERATOR_DEFAULT.toFloat()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var kindMenu by remember { mutableStateOf(false) }

    fun save() {
        if (busy) return
        busy = true
        error = null
        val draft = SecretDraft(kind.wire, name, tags.split(',').map { it.trim() }.filter { it.isNotEmpty() }, values)
        scope.launch {
            runCatching { model.save(draft, editing) }
                .onSuccess {
                    onSaved(it)
                    dismiss()
                }.onFailure { error = PassErrorText.describe(it) }
            busy = false
        }
    }

    PassSheet(dismiss, locked = busy) {
        SheetBar(
            if (editing == null) "New item" else "Edit item",
            if (editing == null) "Add" else "Save",
            cancel = dismiss,
            canAct = name.isNotBlank(),
            busy = busy,
            act = { save() },
        )
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(20.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            error?.let { ErrorBanner(it) }
            InputField("Name", name, { name = it }, placeholder = "GitHub, Stripe, the office wifi…")
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Kind", fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
                Box {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Palette.Sunken)
                            .clickable(enabled = editing == null) { kindMenu = true }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(KindIcon.of(kind.wire), contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(kind.label, fontSize = 16.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                        if (editing == null) Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Palette.Muted)
                    }
                    DropdownMenu(expanded = kindMenu, onDismissRequest = { kindMenu = false }, containerColor = Palette.Surface) {
                        SecretKind.entries.forEach { k ->
                            DropdownMenuItem(
                                text = { Text(k.label) },
                                leadingIcon = { Icon(KindIcon.of(k.wire), null) },
                                onClick = {
                                    kind = k
                                    kindMenu = false
                                },
                            )
                        }
                    }
                }
            }
            kind.fields.forEach { field ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    InputField(
                        field.label,
                        values[field.key].orEmpty(),
                        { values = values + (field.key to it) },
                        secure = field.secret && !field.multiline,
                        multiline = field.multiline,
                        monospaced = field.secret,
                    )
                    if (field.generate) {
                        Generator(field, values[field.key].orEmpty(), length, { length = it }) {
                            values = values + (field.key to PasswordTools.generate(length.toInt()))
                        }
                    }
                }
            }
            InputField("Tags", tags, { tags = it }, placeholder = "work, infra (comma separated)")
            Text(
                "Encrypted on this phone before it is saved. Every member of this vault who holds its key can read it, and Editors can change it.",
                fontSize = 13.sp,
                color = Palette.Muted,
            )
        }
    }
}

@Composable
private fun Generator(
    field: FieldSpec,
    value: String,
    length: Float,
    setLength: (Float) -> Unit,
    generate: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, Palette.Hairline, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (value.isEmpty()) {
            Text("No ${field.label.lowercase()} yet", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
        } else {
            StrengthMeter(PasswordTools.strength(value))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Length", fontSize = 13.sp, color = Palette.Muted)
            Spacer(Modifier.width(8.dp))
            Slider(
                value = length,
                onValueChange = { setLength(it.toInt().toFloat()) },
                valueRange = PasswordTools.GENERATOR_MIN.toFloat()..PasswordTools.GENERATOR_MAX.toFloat(),
                colors = SliderDefaults.colors(thumbColor = Palette.Ink, activeTrackColor = Palette.Ink, inactiveTrackColor = Palette.Sunken),
                modifier = Modifier.weight(1f),
            )
            Text("${length.toInt()}", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, modifier = Modifier.width(28.dp))
        }
        SecondaryButton("Generate", generate, compact = true, icon = Icons.Outlined.Autorenew)
    }
}

/** Share one item with someone outside the team (the web's `ShareModal`): a self-contained link for the web's share page. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSecretSheet(
    secret: Secret,
    dismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var include by remember { mutableStateOf(secret.fields.filter { it.key != "notes" && it.value.isNotEmpty() }.keys) }
    var expiry by remember { mutableIntStateOf(1) }
    var usePassphrase by remember { mutableStateOf(true) }
    var passphrase by remember { mutableStateOf("") }
    var link by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }

    fun create() {
        error = null
        if (usePassphrase && passphrase.length < PassConstants.MIN_SHARE_PASSPHRASE) {
            error = "Use a passphrase of at least 6 characters, and tell it to them another way."
            return
        }
        busy = true
        val payload =
            ShareLink.Payload(
                name = secret.name,
                kind = secret.kind,
                fields = secret.fields.filterKeys { it in include },
                expiresAt = System.currentTimeMillis() + PassConstants.SHARE_EXPIRIES[expiry].second * 1000L,
            )
        val pass = if (usePassphrase) passphrase else null
        scope.launch {
            // 600,000 PBKDF2 rounds: off the main thread.
            runCatching { withContext(Dispatchers.Default) { ShareLink.url(ShareLink.createFragment(payload, pass)) } }
                .onSuccess { link = it }
                .onFailure { error = PassErrorText.describe(it) }
            busy = false
        }
    }

    PassSheet(dismiss, locked = busy) {
        SheetBar("Share “${secret.name}”", if (link == null) "Create link" else null, cancel = dismiss, canAct = include.isNotEmpty(), busy = busy, act = { create() })
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(20.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                "The link carries the item itself, encrypted, after the # (the part a browser never sends to any server). It needs no account and no invitation. It cannot be revoked once sent: if it reaches the wrong person, change the password.",
                fontSize = 14.sp,
                color = Palette.Muted,
            )
            error?.let { ErrorBanner(it) }
            val made = link
            if (made != null) {
                SectionLabel("Link")
                Text(
                    made,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(Palette.Sunken)
                            .padding(12.dp),
                )
                PrimaryButton("Share link", { Clipboard.share(context, made) }, icon = Icons.Outlined.Share)
                SecondaryButton(
                    if (copied) "Copied" else "Copy link",
                    {
                        copyLink(context, made)
                        copied = true
                    },
                    icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy,
                )
                if (usePassphrase) Text("Tell them the passphrase another way: by phone, or in person.", fontSize = 13.sp, color = Palette.Muted)
            } else {
                SectionLabel("Include")
                secret.fields.keys.sorted().forEach { key ->
                    SwitchRow(key.replace('_', ' ').replaceFirstChar { it.uppercase() }, key in include) {
                        include = if (it) include + key else include - key
                    }
                }
                SectionLabel("Stops opening after")
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    PassConstants.SHARE_EXPIRIES.forEachIndexed { index, option ->
                        SegmentedButton(
                            selected = expiry == index,
                            onClick = { expiry = index },
                            shape = SegmentedButtonDefaults.itemShape(index, PassConstants.SHARE_EXPIRIES.size),
                            colors =
                                SegmentedButtonDefaults.colors(
                                    activeContainerColor = Palette.Lime,
                                    activeContentColor = Palette.Ink,
                                    inactiveContainerColor = Palette.Surface,
                                    inactiveContentColor = Palette.Ink,
                                ),
                        ) { Text(option.first) }
                    }
                }
                SwitchRow("Require a passphrase", usePassphrase, "Recommended: then the link alone is useless.") { usePassphrase = it }
                if (usePassphrase) InputField("Passphrase you will tell them separately", passphrase, { passphrase = it }, secure = true)
            }
        }
    }
}

private fun copyLink(
    context: Context,
    link: String,
) {
    // The link carries the item: it expires from the clipboard like a password.
    Clipboard.copySecret(context, "Share link", link)
}

@Composable
private fun SwitchRow(
    title: String,
    checked: Boolean,
    subtitle: String? = null,
    onChange: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = if (subtitle != null) FontWeight.Medium else FontWeight.Normal, color = Palette.Ink)
            if (subtitle != null) Text(subtitle, fontSize = 13.sp, color = Palette.Muted)
        }
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = Palette.Ink, checkedThumbColor = Palette.Lime),
        )
    }
}
