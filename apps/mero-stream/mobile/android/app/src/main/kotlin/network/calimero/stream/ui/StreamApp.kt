package network.calimero.stream.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.stream.app.InvitationLanding
import network.calimero.stream.app.StreamViewModel
import network.calimero.stream.app.StreamsModel
import network.calimero.stream.core.StreamException
import network.calimero.stream.core.StreamInvitation

/** What the screens need from the activity. */
class Platform(
    val signIn: () -> Unit,
    val share: (title: String, text: String) -> Unit,
    val copy: (label: String, text: String) -> Unit,
    val openSettings: () -> Unit,
)

/** Signed out -> sign in; signed in -> streams, a stream's rooms, and the call on top. */
@Composable
fun StreamApp(
    vm: StreamViewModel,
    platform: Platform,
) {
    StreamTheme {
        val backend by vm.session.backend.collectAsState()
        val revision by vm.session.revision.collectAsState()
        val openStream by vm.openStream.collectAsState()
        val call by vm.call.collectAsState()
        val pending by vm.session.pendingInvitation.collectAsState()
        Box(Modifier.fillMaxSize().background(Palette.Ground)) {
            val current = backend
            if (current == null) {
                SignInScreen(vm, platform)
            } else {
                val streams = remember(current, revision) { StreamsModel(current) }
                val stream = openStream
                if (stream == null) {
                    StreamsScreen(vm, streams, platform)
                } else {
                    BackHandler { vm.openStream(null) }
                    RoomsScreen(vm, stream, current, platform)
                }
                val target = call
                if (target != null) {
                    BackHandler { vm.openCall(null) }
                    CallScreen(vm, target, current, platform)
                }
                val link = pending
                if (link != null) InvitationSheet(vm, streams, link)
            }
        }
    }
}

/** "Join this stream?" for an invitation link the system opened. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InvitationSheet(
    vm: StreamViewModel,
    model: StreamsModel,
    link: String,
) {
    val scope = rememberCoroutineScope()
    val busy by model.isWorking.collectAsState()
    val error by model.error.collectAsState()
    val invitation = remember(link) { StreamInvitation.parse(link) }
    val tap = rememberTap()
    ModalBottomSheet(onDismissRequest = { vm.session.dismissPendingInvitation() }, containerColor = Palette.Surface) {
        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            RowIcon(if (invitation?.opensRoom == true) Icons.Outlined.Videocam else Icons.Outlined.Layers)
            if (invitation != null) {
                Text(
                    if (invitation.opensRoom) "Join this call?" else "Join this stream?",
                    fontFamily = Display,
                    fontWeight = FontWeight.Bold,
                    fontSize = 26.sp,
                    color = Palette.Ink,
                )
                Text(summary(invitation), fontSize = 16.sp, color = Palette.InkSoft)
            } else {
                Text("This link can't be opened", fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 26.sp, color = Palette.Ink)
                Text(StreamException.notAnInvitation().message.orEmpty(), fontSize = 16.sp, color = Palette.InkSoft)
            }
            error?.let { NoticeBanner(it, onDismiss = { model.error.value = null }) }
            if (invitation != null) {
                PrimaryButton("Join", busy = busy, onClick = {
                    tap()
                    scope.launch {
                        val landing: InvitationLanding = model.join(invitation) ?: return@launch
                        vm.session.dismissPendingInvitation()
                        vm.didJoin()
                        vm.land(landing)
                    }
                })
            }
            SecondaryButton("Not now", onClick = { vm.session.dismissPendingInvitation() })
        }
    }
}

private fun summary(invitation: StreamInvitation): String {
    val stream = invitation.namespaceName?.let { "“$it”" } ?: "a stream"
    if (invitation.opensRoom) {
        val room = invitation.roomName?.let { "“$it”" } ?: "a room"
        return "You're invited to $room in $stream. Joining adds you to the stream and opens the call."
    }
    return "You're invited to $stream. Joining gives you every room in it, including rooms made later."
}
