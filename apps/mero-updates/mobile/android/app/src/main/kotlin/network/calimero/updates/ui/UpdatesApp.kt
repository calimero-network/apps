package network.calimero.updates.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.CompaniesModel
import network.calimero.updates.app.CompanyModel
import network.calimero.updates.app.UpdatesViewModel
import network.calimero.updates.core.UpdatesInvitation

/** What the screens need from the activity. */
class Platform(
    /** Sign in (or, with `create`, sign up as `name`) to a Calimero Cloud cluster with the device's passkey. */
    val signInCloud: (cluster: String, create: Boolean, name: String) -> Unit,
    val share: (title: String, text: String) -> Unit,
    val copy: (label: String, text: String) -> Unit,
)

/** Signed out: sign in. Signed in: companies → a company's audiences, or the open audience with its tabs. */
@Composable
fun UpdatesApp(
    vm: UpdatesViewModel,
    platform: Platform,
) {
    UpdatesTheme {
        val backend by vm.backend.collectAsState()
        val revision by vm.revision.collectAsState()
        val audience by vm.audience.collectAsState()
        val company by vm.company.collectAsState()
        Box(Modifier.fillMaxSize().background(Palette.background)) {
            val current = backend
            val open = audience
            val contextId = open?.contextId
            val route = company
            when {
                current == null -> SignInScreen(vm, platform)
                open != null && contextId != null ->
                    key(contextId, revision) {
                        val model = remember(current, contextId) { AudienceModel(open, contextId, current) }
                        AudienceScreen(vm, model, platform)
                    }
                route != null ->
                    key(route, revision) {
                        val model = remember(current, route) { CompanyModel(route.company, current, UpdatesInvitation.PACKAGE_NAME, route.justJoined) }
                        BackHandler { vm.openCompany(null) }
                        CompanyScreen(vm, model, platform)
                    }
                else ->
                    key(revision) {
                        val model = remember(current) { CompaniesModel(current) }
                        CompaniesScreen(vm, model)
                    }
            }
            if (current != null) InvitationPrompt(vm, current)
        }
    }
}
