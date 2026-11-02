package network.calimero.crm.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import network.calimero.crm.app.CrmViewModel
import network.calimero.crm.app.PipelineModel
import network.calimero.crm.app.WorkspacesModel

/** What the screens need from the activity. */
class Platform(
    /** Sign in on a Calimero Cloud cluster (name or node URL) with the device's passkey; `create` makes an account named `name`. */
    val signIn: (cluster: String, create: Boolean, name: String) -> Unit,
    val share: (title: String, text: String) -> Unit,
    val copy: (label: String, text: String) -> Unit,
    val open: (url: String) -> Unit,
)

/** Signed out: sign in. Signed in: the workspaces, or the open pipeline. */
@Composable
fun CrmApp(
    vm: CrmViewModel,
    platform: Platform,
) {
    CrmTheme {
        val backend by vm.backend.collectAsState()
        val revision by vm.revision.collectAsState()
        val open by vm.openPipeline.collectAsState()
        val pending by vm.pendingInvitation.collectAsState()
        Box(Modifier.fillMaxSize().background(Palette.background)) {
            val current = backend
            if (current == null) {
                SignInScreen(vm, platform)
            } else {
                val workspaces = remember(current, revision) { WorkspacesModel(current, vm.applicationId, vm.names) }
                val pipeline = open
                if (pipeline == null) {
                    WorkspacesScreen(vm, workspaces)
                } else {
                    val model = remember(current, revision, pipeline.contextId) { PipelineModel(pipeline, current) }
                    PipelineShell(vm, model, platform)
                }
                val raw = pending
                if (raw != null) InvitationSheet(vm, workspaces, raw)
            }
        }
    }
}
