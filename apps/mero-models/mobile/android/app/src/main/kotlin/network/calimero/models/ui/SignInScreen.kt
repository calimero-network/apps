package network.calimero.models.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined._3dRotation
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import network.calimero.models.app.ModelsAppViewModel
import network.calimero.models.app.SignInMode
import network.calimero.models.core.ClusterTarget

/**
 * Sign in to the studio's Calimero cluster. Two ways in, one screen (Swift `SignInView`):
 *
 * - **Calimero Cloud**: the cluster's name (`eu-shared-1`, its nodes read from the node directory)
 *   or one of its nodes' addresses, then a passkey on this phone, or a new account.
 * - **Development node**: a `merod local` node by URL, trusting its mock attestation. The app keeps
 *   a soft passkey for that node and creates the account on the first sign-in.
 */
@Composable
fun SignInScreen(vm: ModelsAppViewModel) {
    val context = LocalContext.current
    var devName by remember { mutableStateOf("") }
    var showCreate by remember { mutableStateOf(false) }
    val busy = vm.busy

    Box(
        Modifier
            .fillMaxSize()
            .background(ModelsTheme.ground)
            .safeDrawingPadding()
            .imePadding(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
        ) {
            Spacer(Modifier.height(48.dp))
            AppMark(64.dp)
            Text("Mero Models", style = ModelsTheme.heading(34), modifier = Modifier.padding(top = 24.dp))
            Text(
                "Your studio's 3D scenes, on your phone. Look around every model and see who is working on what.",
                style = ModelsTheme.body(17, color = ModelsTheme.muted),
                modifier = Modifier.padding(top = 10.dp),
            )
            Column(Modifier.padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Feature(Icons.Outlined._3dRotation, "Orbit, zoom and pan any scene")
                Feature(Icons.Outlined.Lock, "See who has what checked out")
                Feature(Icons.Outlined.Share, "Share a scene with a link")
            }

            ModeSwitch(vm.mode, onSelect = vm::selectMode, modifier = Modifier.padding(top = 32.dp))

            Column(Modifier.padding(top = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (vm.mode == SignInMode.CLOUD) {
                    FieldLabel("Cluster")
                    Field(vm.cluster, { vm.cluster = it }, "eu-shared-1 or https://node.example.com", KeyboardType.Uri, "clusterField")
                    Hint("The name or a node address from Calimero Cloud's console. The app checks the node's attestation before it sends anything.")
                    val valid = ClusterTarget.parse(vm.cluster) != null
                    PrimaryButton(onClick = { vm.signInCloud(context, create = false) }, enabled = !busy && valid, modifier = Modifier.padding(top = 6.dp).testTag("signInButton")) {
                        ButtonContent(busy, Icons.Outlined.Key, if (busy) "Waiting for your passkey…" else "Sign in with a passkey")
                    }
                    SecondaryButton(onClick = { showCreate = true }, enabled = !busy && valid) { Text("Create an account") }
                } else {
                    FieldLabel("Node URL")
                    Field(vm.devNode, { vm.devNode = it }, ModelsAppViewModel.DEFAULT_DEV_NODE, KeyboardType.Uri, "devNodeField")
                    FieldLabel("Your name")
                    Field(devName, { devName = it }, "For a new account on this node", KeyboardType.Text, "devNameField")
                    Hint("For merod local: the node's mock attestation is trusted here only. Never use this for a real cluster.")
                    val valid = ClusterTarget.parse(vm.devNode) is ClusterTarget.Url
                    PrimaryButton(onClick = { vm.signInDev(devName) }, enabled = !busy && valid, modifier = Modifier.padding(top = 6.dp).testTag("devSignInButton")) {
                        ButtonContent(busy, Icons.Outlined.Dns, if (busy) "Signing in…" else "Sign in to this node")
                    }
                }
                vm.error?.let {
                    Text(it, style = ModelsTheme.body(14, color = ModelsTheme.danger), modifier = Modifier.padding(top = 4.dp).testTag("signInError"))
                }
            }
        }
    }

    if (showCreate) {
        CreateAccountSheet(onDismiss = { showCreate = false }) { name ->
            showCreate = false
            vm.signInCloud(context, create = true, name = name)
        }
    }
}

/** Calimero Cloud | Development node. */
@Composable
private fun ModeSwitch(
    mode: SignInMode,
    onSelect: (SignInMode) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = RoundedCornerShape(10.dp)
    Row(
        modifier
            .fillMaxWidth()
            .background(ModelsTheme.surface, shape)
            .border(ModelsTheme.hairline, ModelsTheme.line, shape)
            .padding(3.dp),
    ) {
        listOf(SignInMode.CLOUD to "Calimero Cloud", SignInMode.DEV to "Development node").forEach { (value, label) ->
            val selected = value == mode
            Box(
                Modifier
                    .weight(1f)
                    .background(if (selected) ModelsTheme.lime else ModelsTheme.surface, RoundedCornerShape(8.dp))
                    .clickable { onSelect(value) }
                    .padding(vertical = 9.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = ModelsTheme.body(14, if (selected) FontWeight.SemiBold else FontWeight.Medium, ModelsTheme.ink))
            }
        }
    }
}

@Composable
private fun ButtonContent(
    busy: Boolean,
    icon: ImageVector,
    text: String,
) {
    if (busy) {
        CircularProgressIndicator(color = ModelsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
    } else {
        Icon(icon, contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(18.dp))
    }
    Spacer(Modifier.width(10.dp))
    Text(text, style = ModelsTheme.body(16, FontWeight.SemiBold, ModelsTheme.ink))
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, style = ModelsTheme.body(13, FontWeight.Medium, ModelsTheme.muted))
}

@Composable
private fun Hint(text: String) {
    Text(text, style = ModelsTheme.body(12, color = ModelsTheme.faint))
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardType,
    tag: String,
) {
    Box(Modifier.fillMaxWidth().card(14.dp)) {
        if (value.isEmpty()) Text(placeholder, style = ModelsTheme.body(15, color = ModelsTheme.faint))
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = ModelsTheme.body(15, color = ModelsTheme.ink),
            cursorBrush = SolidColor(ModelsTheme.ink),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().testTag(tag),
        )
    }
}

/** A name for a new account, then a new passkey. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateAccountSheet(
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = ModelsTheme.ground) {
        Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Create an account", style = ModelsTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Text(
                "Your name is what your studio sees. A new passkey on this phone signs you in from now on.",
                style = ModelsTheme.body(15, color = ModelsTheme.muted),
            )
            Field(name, { name = it }, "Your name", KeyboardType.Text, "accountNameField")
            PrimaryButton(onClick = { onSubmit(name.trim()) }, enabled = name.isNotBlank()) {
                Text("Create the passkey", style = ModelsTheme.body(16, FontWeight.SemiBold, ModelsTheme.ink))
            }
        }
    }
}

@Composable
private fun Feature(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(36.dp)
                .background(ModelsTheme.surface, RoundedCornerShape(10.dp))
                .border(ModelsTheme.hairline, ModelsTheme.line, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = ModelsTheme.body(15))
    }
}
