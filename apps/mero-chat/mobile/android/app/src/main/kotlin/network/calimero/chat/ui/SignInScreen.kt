package network.calimero.chat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import network.calimero.chat.app.ChatAppViewModel
import network.calimero.chat.app.ClusterTarget
import network.calimero.chat.app.SignInMode

/**
 * Sign in to a Calimero 1.0 cluster. Two ways in, one screen (Swift `SignInView`):
 *
 * - **Calimero Cloud**: the cluster's name (`eu-shared-1`, its nodes read from the node directory)
 *   or one of its nodes' addresses, then this device's passkey, or a new account.
 * - **Development node**: a `merod local` node by URL, trusting its mock attestation. The app keeps
 *   a software passkey for that node and creates the account on the first sign-in.
 */
@Suppress("LongMethod")
@Composable
fun SignInScreen(
    vm: ChatAppViewModel,
    busy: Boolean,
    error: String?,
) {
    val context = LocalContext.current
    val mode by vm.mode.collectAsStateWithLifecycle()
    val cluster by vm.cluster.collectAsStateWithLifecycle()
    val devNode by vm.devNode.collectAsStateWithLifecycle()
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }

    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Spacer(Modifier.height(24.dp))
            Text("Mero Chat", style = MaterialTheme.typography.headlineLarge)
            Text(
                "Channels, threads and direct messages on your own Calimero cluster.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf(SignInMode.CLOUD to "Calimero Cloud", SignInMode.DEV to "Development node").forEachIndexed { i, (value, label) ->
                    SegmentedButton(
                        selected = mode == value,
                        onClick = { vm.selectMode(value) },
                        shape = SegmentedButtonDefaults.itemShape(i, 2),
                    ) { Text(label) }
                }
            }
            if (mode == SignInMode.CLOUD) {
                OutlinedTextField(
                    value = cluster,
                    onValueChange = { vm.cluster.value = it },
                    label = { Text("Cluster") },
                    placeholder = { Text("eu-shared-1 or https://node.example.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().testTag("clusterField"),
                )
                if (creating) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it },
                        label = { Text("Your name") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                val valid = ClusterTarget.parse(cluster) != null && (!creating || name.isNotBlank())
                Button(
                    onClick = { vm.signInCloud(context, create = creating, name = name.trim()) },
                    enabled = !busy && valid,
                    modifier = Modifier.fillMaxWidth().testTag("signInButton"),
                ) {
                    ButtonContent(busy, Icons.Outlined.Lock, if (creating) "Create account" else "Sign in with a passkey")
                }
                OutlinedButton(onClick = { creating = !creating }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (creating) "I have an account" else "Create an account")
                }
                Hint("The name or a node address from Calimero Cloud's console. The node's attestation is checked before anything is sent.")
            } else {
                OutlinedTextField(
                    value = devNode,
                    onValueChange = { vm.devNode.value = it },
                    label = { Text("Node URL") },
                    placeholder = { Text(ChatAppViewModel.DEFAULT_DEV_NODE) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().testTag("devNodeField"),
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Your name") },
                    placeholder = { Text("For a new account on this node") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { vm.signInDev(name.trim()) },
                    enabled = !busy && ClusterTarget.parse(devNode) is ClusterTarget.Url,
                    modifier = Modifier.fillMaxWidth().testTag("devSignInButton"),
                ) {
                    ButtonContent(busy, Icons.Outlined.Build, "Connect")
                }
                Hint("For merod local: mock attestation is trusted for this node only, and a passkey is kept on this device for it.")
            }
            if (error != null) {
                Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("signInError"))
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
    Row {
        if (busy) {
            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        } else {
            Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(10.dp))
        Text(text)
    }
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
