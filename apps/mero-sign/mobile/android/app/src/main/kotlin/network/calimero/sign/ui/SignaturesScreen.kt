package network.calimero.sign.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Gesture
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.sign.SignViewModel
import network.calimero.sign.core.LoadPhase
import network.calimero.sign.core.SavedSignature
import network.calimero.sign.core.SignaturesModel

/** Your signature library, kept in your private context. (iOS `SignaturesScreen`.) */
@Composable
fun SignaturesScreen(
    model: SignaturesModel,
    vm: SignViewModel,
) {
    val phase by model.phase.collectAsState()
    val signatures by model.signatures.collectAsState()
    val saving by model.isSaving.collectAsState()
    val notice by model.notice.collectAsState()
    var drawing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<SavedSignature?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(model) { model.load() }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar("Signatures") { AccountMenu(vm) }
        NoticeBanner(notice) { model.notice.value = null }
        RefreshingColumn({ model.load() }) {
            Text(
                "The drawings you sign documents with. They're stored in your own private context and never shared.",
                fontSize = 15.sp,
                color = Palette.Muted,
            )
            PrimaryButton("Draw a new signature", { drawing = true }, busy = saving, icon = Icons.Outlined.Gesture)
            when (val p = phase) {
                LoadPhase.Loading -> Loading()
                is LoadPhase.Failed -> ErrorState(p.message) { scope.launch { model.load() } }
                LoadPhase.Loaded ->
                    if (signatures.isEmpty()) {
                        EmptyState(Icons.Outlined.Draw, "No signatures yet", "Draw one now, or keep the one you draw when you next sign a document.")
                    } else {
                        // Two per row, inside the page's scroll.
                        signatures.chunked(2).forEach { pair ->
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                pair.forEach { signature ->
                                    Box(Modifier.weight(1f)) {
                                        SignatureTile(signature, menu = { TileMenu(signature) { deleting = it } })
                                    }
                                }
                                if (pair.size == 1) Box(Modifier.weight(1f))
                            }
                        }
                    }
            }
        }
    }
    if (drawing) {
        SignaturePadSheet("Save signature", back = { drawing = false }) { png ->
            drawing = false
            scope.launch { model.save(png) }
        }
    }
    deleting?.let { signature ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Delete ${signature.name}?") },
            text = { Text("Documents you already signed with it keep it.") },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    scope.launch { model.delete(signature) }
                }) { Text("Delete", color = Palette.Danger) }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text("Cancel", color = Palette.Ink) } },
            containerColor = Palette.Surface,
        )
    }
}

@Composable
private fun TileMenu(
    signature: SavedSignature,
    delete: (SavedSignature) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Outlined.MoreHoriz, contentDescription = "More for ${signature.name}", tint = Palette.InkSoft)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Palette.Surface) {
            DropdownMenuItem(
                text = { Text("Delete", color = Palette.Danger) },
                leadingIcon = { Icon(Icons.Outlined.DeleteOutline, contentDescription = null, tint = Palette.Danger) },
                onClick = {
                    open = false
                    delete(signature)
                },
            )
        }
    }
}
