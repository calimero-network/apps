package network.calimero.stream.ui

import android.Manifest
import android.content.pm.PackageManager
import android.view.ViewGroup
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewModelScope
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.stream.app.CallModel
import network.calimero.stream.app.CallTarget
import network.calimero.stream.app.StreamViewModel
import network.calimero.stream.core.People
import network.calimero.stream.core.Person
import network.calimero.stream.core.Slots
import network.calimero.stream.media.CallMedia

/**
 * The call, laid out like Google Meet on a phone (identical to iOS `CallView`): a dark stage with a
 * tile per person, the room and the broadcast slots on top, and the controls in a bottom bar (mic,
 * camera, people, more, leave).
 */
@Suppress("CyclomaticComplexMethod")
@Composable
fun CallScreen(
    vm: StreamViewModel,
    target: CallTarget,
    backend: MeroAppBackend,
    platform: Platform,
) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val tap = rememberTap()
    val model =
        remember(target.contextId) {
            // The view model's scope, not this screen's: leaving must still retract our slice.
            CallModel(target.room, target.contextId, backend, vm.mediaChannel(), vm.displayName.value, vm.viewModelScope)
        }
    val media = remember(model) { CallMedia(context.applicationContext, model, vm.viewModelScope) }
    DisposableEffect(model) {
        media.attach()
        model.start()
        onDispose {
            model.stop()
            media.detach()
        }
    }

    val joined by model.joined.collectAsState()
    val joinFailed by model.joinFailed.collectAsState()
    val slots by model.slots.collectAsState()
    val live by model.isLive.collectAsState()
    val mic by model.micOn.collectAsState()
    val yielded by model.yielded.collectAsState()
    val error by model.error.collectAsState()
    val name by model.name.collectAsState()
    val cameraOn by media.cameraOn.collectAsState()
    // Read so the roster recomposes with them.
    model.members.collectAsState().value
    model.peers.collectAsState().value
    val people = model.people()
    var showPeople by remember { mutableStateOf(false) }
    var showDetails by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf<String?>(null) }
    var nudged by remember { mutableStateOf(false) }

    val cameraPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) media.toggleCamera(lifecycle) else blocked = Manifest.permission.CAMERA
        }
    val micPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) media.toggleMic() else blocked = Manifest.permission.RECORD_AUDIO
        }

    fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    LaunchedEffect(joined) {
        // Like the web: someone who never picked a name is asked once.
        if (joined && !nudged && name.isBlank()) {
            nudged = true
            showPeople = true
        }
    }

    fun leave() {
        vm.openCall(null)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.Stage)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        // Top bar
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(target.room.title, fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Palette.StageText, maxLines = 1)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    CallTimer(model.startedAt)
                    Text("·", fontSize = 12.sp, color = Palette.StageFaint)
                    Text(target.stream.title, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.StageFaint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            SlotsPill(slots.occupied)
            if (cameraOn) {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(Palette.Control).clickable {
                        tap()
                        media.flipCamera()
                    },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Cameraswitch, contentDescription = "Switch camera", tint = Palette.StageText) }
            }
        }

        // Notices
        Column(Modifier.padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!joined && joinFailed == null) StageNotice(Icons.Outlined.HourglassEmpty, "Joining the room…")
            joinFailed?.let { StageNotice(Icons.Outlined.WarningAmber, "Could not join: $it", "Retry", model::retryJoin) }
            if (yielded) {
                StageNotice(
                    Icons.Filled.VideocamOff,
                    "All ${Slots.MAX_BROADCASTERS} camera slots were taken, so your camera stopped. You still see everyone; turn it on again when a slot frees up.",
                    "Dismiss",
                    model::clearYielded,
                )
            } else if (slots.full && !live && joined) {
                StageNotice(
                    Icons.Outlined.Groups,
                    "All ${Slots.MAX_BROADCASTERS} camera slots are taken. You can watch and talk; the camera turns on again when one frees up.",
                )
            }
            if (model.degraded) {
                StageNotice(Icons.Outlined.Info, "${slots.occupied} people are broadcasting, so every stream is choppier.", "Why?") { showDetails = true }
            }
            error?.let { StageNotice(Icons.Outlined.ErrorOutline, it, "Dismiss") { model.error.value = null } }
        }

        // Stage
        Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp)) {
            StageGrid(people, model, media, cameraOn, mic)
        }

        // Controls
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ControlButton(
                if (mic) Icons.Filled.Mic else Icons.Filled.MicOff,
                if (mic) "Mute" else "Unmute",
                active = mic,
                enabled = joined && model.channel != null,
            ) {
                tap()
                if (mic || granted(Manifest.permission.RECORD_AUDIO)) media.toggleMic() else micPermission.launch(Manifest.permission.RECORD_AUDIO)
            }
            ControlButton(
                if (cameraOn) Icons.Filled.Videocam else Icons.Filled.VideocamOff,
                if (cameraOn) "Turn off camera" else "Turn on camera",
                active = cameraOn,
                enabled = model.canGoLive || cameraOn,
            ) {
                tap()
                if (cameraOn || granted(Manifest.permission.CAMERA)) media.toggleCamera(lifecycle) else cameraPermission.launch(Manifest.permission.CAMERA)
            }
            ControlButton(Icons.Filled.Group, "People", badge = people.size) { showPeople = true }
            ControlButton(Icons.Filled.MoreHoriz, "Call details") { showDetails = true }
            Box(
                Modifier
                    .size(width = 64.dp, height = 52.dp)
                    .clip(CircleShape)
                    .background(Palette.Danger)
                    .clickable {
                        tap()
                        leave()
                    }.semantics { contentDescription = "Leave call" },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.CallEnd, contentDescription = null, tint = Color.White) }
        }
    }

    if (showPeople) {
        PeopleSheet(model, people, onDismiss = { showPeople = false }) { next ->
            vm.setDisplayName(next)
            scope.launch { model.rename(next) }
        }
    }
    if (showDetails) DetailsSheet(model, target, platform, onDismiss = { showDetails = false })
    blocked?.let { permission ->
        val camera = permission == Manifest.permission.CAMERA
        AlertDialog(
            onDismissRequest = { blocked = null },
            title = { Text(if (camera) "Camera access is off" else "Microphone access is off") },
            text = {
                Text(
                    if (camera) {
                        "Turn on camera access for Mero Stream in Settings to share your camera."
                    } else {
                        "Turn on microphone access for Mero Stream in Settings to talk in calls."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    blocked = null
                    platform.openSettings()
                }) { Text("Open Settings", color = Palette.Ink) }
            },
            dismissButton = { TextButton(onClick = { blocked = null }) { Text("Not now", color = Palette.Muted) } },
            containerColor = Palette.Surface,
        )
    }
}

/** The tiles: one person fills the stage, two stack, more go two across. */
@Composable
private fun StageGrid(
    people: List<Person>,
    model: CallModel,
    media: CallMedia,
    cameraOn: Boolean,
    mic: Boolean,
) {
    val peers by model.peers.collectAsState()
    val speaking by model.speaking.collectAsState()

    @Composable
    fun tile(
        person: Person,
        modifier: Modifier,
    ) {
        val peer = peers.firstOrNull { it.id == person.memberId }
        val video =
            when {
                person.isSelf -> if (cameraOn) TileVideo.PREVIEW else TileVideo.OFF
                peer == null -> TileVideo.OFF
                peer.decoding -> TileVideo.REMOTE
                else -> TileVideo.WAITING
            }
        PersonTile(person, video, !person.isSelf && person.memberId in speaking, person.isSelf && !mic, media, modifier)
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (people.size <= 2) {
            Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (person in people) tile(person, Modifier.weight(1f).fillMaxWidth())
            }
        } else {
            val rows = (people.size + 1) / 2
            val height = maxOf(160.dp, (maxHeight - 8.dp * (rows - 1)) / minOf(rows, 3))
            LazyVerticalGrid(
                columns = GridCells.Fixed(2),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(people, key = { it.memberId }) { person -> tile(person, Modifier.fillMaxWidth().height(height)) }
            }
        }
    }
}

private enum class TileVideo { OFF, PREVIEW, REMOTE, WAITING }

@Composable
private fun PersonTile(
    person: Person,
    video: TileVideo,
    speaking: Boolean,
    muted: Boolean,
    media: CallMedia,
    modifier: Modifier,
) {
    val shape = RoundedCornerShape(16.dp)
    val ring by animateColorAsState(if (speaking) Palette.Lime else Color.Transparent, label = "speaking")
    val lifecycle = LocalLifecycleOwner.current
    Box(modifier.clip(shape).background(Palette.Tile).border(3.dp, ring, shape)) {
        when (video) {
            TileVideo.PREVIEW ->
                AndroidView(
                    factory = { ctx ->
                        PreviewView(ctx).apply {
                            scaleType = PreviewView.ScaleType.FILL_CENTER
                            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                    update = { media.bindPreview(it, lifecycle) },
                    onRelease = { media.bindPreview(null, lifecycle) },
                )
            TileVideo.REMOTE ->
                AndroidView(
                    factory = { _ ->
                        val view = media.decoder(person.memberId).view
                        (view.parent as? ViewGroup)?.removeView(view)
                        view
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            TileVideo.WAITING, TileVideo.OFF ->
                Column(
                    Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically),
                ) {
                    Avatar(person.name, seed = person.memberId, size = 72)
                    if (video == TileVideo.WAITING) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            CircularProgressIndicator(Modifier.size(12.dp), color = Palette.StageFaint, strokeWidth = 1.5.dp)
                            Text("Waiting for a keyframe…", fontSize = 12.sp, color = Palette.StageFaint)
                        }
                    }
                }
        }
        Row(
            Modifier
                .align(Alignment.BottomStart)
                .padding(10.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (muted) {
                Icon(Icons.Filled.MicOff, contentDescription = "Muted", tint = Color.White, modifier = Modifier.size(13.dp))
            } else if (speaking) {
                Icon(Icons.Filled.GraphicEq, contentDescription = "Speaking", tint = Palette.Lime, modifier = Modifier.size(13.dp))
            }
            Text(
                if (person.isSelf) "${person.name} (you)" else person.name,
                color = Color.White,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ControlButton(
    icon: ImageVector,
    label: String,
    active: Boolean = false,
    enabled: Boolean = true,
    badge: Int? = null,
    onClick: () -> Unit,
) {
    Box {
        Box(
            Modifier
                .size(52.dp)
                .clip(CircleShape)
                .background(if (active) Palette.Lime else Palette.Control)
                .clickable(enabled = enabled, onClick = onClick)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = (if (active) Palette.Ink else Palette.StageText).copy(alpha = if (enabled) 1f else 0.4f),
            )
        }
        if (badge != null && badge > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 4.dp, y = (-4).dp)
                    .heightIn(min = 18.dp)
                    .clip(CircleShape)
                    .background(Palette.Lime)
                    .padding(horizontal = 5.dp),
                contentAlignment = Alignment.Center,
            ) { Text("$badge", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Palette.Ink) }
        }
    }
}

@Composable
private fun SlotsPill(occupied: Int) {
    Row(
        Modifier
            .height(28.dp)
            .clip(CircleShape)
            .background(Palette.Control)
            .padding(horizontal = 10.dp)
            .semantics { contentDescription = "$occupied of ${Slots.MAX_BROADCASTERS} camera slots in use" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(7.dp).clip(CircleShape).background(if (occupied > 0) Palette.Lime else Palette.StageFaint))
        Text("$occupied/${Slots.MAX_BROADCASTERS} on camera", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.StageText)
    }
}

@Composable
private fun StageNotice(
    icon: ImageVector,
    text: String,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.Tile)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Palette.Lime, modifier = Modifier.size(18.dp))
        Text(text, fontSize = 13.sp, color = Palette.StageText, modifier = Modifier.weight(1f))
        if (action != null) {
            Text(action, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.Lime, modifier = Modifier.clickable(onClick = onAction))
        }
    }
}

@Composable
private fun CallTimer(start: Long) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(start) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val seconds = maxOf(0L, (now - start) / 1000)
    val h = seconds / 3600
    val m = (seconds % 3600) / 60
    val s = seconds % 60
    Text(
        if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s),
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        color = Palette.StageFaint,
        fontFamily = FontFamily.Monospace,
    )
}

/** Your name, and who is in the room (the web's People dialog). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PeopleSheet(
    model: CallModel,
    people: List<Person>,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    val name by model.name.collectAsState()
    var draft by remember { mutableStateOf(name) }
    var saved by remember { mutableStateOf(false) }
    val trimmed = draft.trim().take(40)
    val dirty = trimmed.isNotEmpty() && trimmed != name
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.Surface) {
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { Text("People", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Palette.Ink) }
            item { SectionLabel("Your nickname") }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TextField(
                        value = draft,
                        onValueChange = {
                            draft = it
                            saved = false
                        },
                        placeholder = { Text("e.g. Ana", color = Palette.Muted) },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors =
                            TextFieldDefaults.colors(
                                focusedContainerColor = Palette.Sunken,
                                unfocusedContainerColor = Palette.Sunken,
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent,
                            ),
                        modifier = Modifier.weight(1f),
                    )
                    PrimaryButton("Save", compact = true, enabled = dirty, onClick = {
                        onSave(trimmed)
                        saved = true
                    })
                }
            }
            item {
                when {
                    saved ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Check, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
                            Text("Saved. Everyone sees it within a few seconds.", fontSize = 13.sp, color = Palette.Muted)
                        }
                    name.isBlank() -> Text("You have not picked a name yet, so your tile shows a placeholder.", fontSize = 13.sp, color = Palette.Muted)
                    else -> Text("This is the name on your tile, and what everyone else in the room sees.", fontSize = 13.sp, color = Palette.Muted)
                }
            }
            item { SectionLabel("In this room · ${people.size}") }
            items(people, key = { it.memberId }) { person ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(person.name, seed = person.memberId, size = 36)
                    Column(Modifier.weight(1f)) {
                        Text(if (person.isSelf) "${person.name} (you)" else person.name, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                        Text(People.shortId(person.memberId), fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = Palette.Muted)
                    }
                    if (person.live) {
                        Row(
                            Modifier.clip(CircleShape).background(Palette.Lime).padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Icon(Icons.Filled.Videocam, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(13.dp))
                            Text("on camera", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                        }
                    } else {
                        Text("watching", fontSize = 12.sp, color = Palette.Muted)
                    }
                }
            }
        }
    }
}

/** Call health and the ids behind the room (the web's "Call details"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DetailsSheet(
    model: CallModel,
    target: CallTarget,
    platform: Platform,
    onDismiss: () -> Unit,
) {
    val stats by model.stats.collectAsState()
    val slots by model.slots.collectAsState()
    val live by model.isLive.collectAsState()
    val encoding = model.encoding
    val rows =
        listOf(
            "On camera" to "${slots.occupied} of ${Slots.MAX_BROADCASTERS}",
            "Your camera" to if (live) "${encoding.fps} fps · ${encoding.bitrate / 1000} kbps" else "Off",
            "Codec" to (stats.lastCodec ?: "—"),
            "Frames sent" to "${stats.framesSent}",
            "Frames dropped (behind)" to "${stats.framesDropped}",
            "Publish time" to (stats.publishMs?.let { "${it.toInt()} ms" } ?: "—"),
            "Publish errors" to "${stats.publishErrors}",
            "Frames received" to "${stats.framesReceived}",
            "Latency" to (stats.latencyMs?.let { "${it.toInt()} ms" } ?: "—"),
            "Audio sent / received" to "${stats.audioPacketsSent} / ${stats.audioPacketsReceived}",
        )
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Palette.Surface) {
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
            item { Text("Call details", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Palette.Ink) }
            item { SectionLabel("This call") }
            items(rows) { (label, value) ->
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                    Text(label, fontSize = 15.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                    Text(value, fontSize = 15.sp, color = Palette.Muted)
                }
                HorizontalDivider(color = Palette.Hairline, thickness = 0.5.dp)
            }
            item { SectionLabel("Why it can be choppy") }
            item {
                Text(
                    "Video is H.264 carried on the room's ephemeral presence in ≤16 KiB slices, so nothing about the call is stored. " +
                        "With ${Slots.DEGRADED_FROM_BROADCASTERS} people on camera, each stream gets about ${Slots.DEGRADED_DELIVERY_PERCENT}% of its frames through: " +
                        "frame rate and bitrate are shared, and that is measured, not something the app can tune away. One person on camera at a time is smooth.",
                    fontSize = 14.sp,
                    color = Palette.Muted,
                    modifier = Modifier.padding(vertical = 6.dp),
                )
            }
            item {
                Spacer(Modifier.width(1.dp))
                DetailsDisclosure(
                    listOf(
                        "Room ID" to target.room.id,
                        "Context ID" to target.contextId,
                        "Stream ID" to target.stream.id,
                        "Your device key" to model.me,
                    ),
                    platform.copy,
                )
            }
        }
    }
}
