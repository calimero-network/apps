package network.calimero.blocks.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.outlined.TouchApp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import network.calimero.blocks.app.BlocksConstants
import network.calimero.blocks.app.PlayerSettings
import java.util.Locale

/** Settings: the name other players see, look sensitivity, and the account. (iOS `SettingsScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    settings: PlayerSettings,
    account: String,
    onSignOut: () -> Unit,
    onBack: () -> Unit,
) {
    val name by settings.name.collectAsState()
    var confirming by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = BlocksColors.Ground,
        topBar = {
            TopAppBar(
                title = { Text("Settings", style = Type.heading(18)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = BlocksColors.Ink)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = BlocksColors.Ground),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Section("Player name", footer = "Shown above your head to everyone in the world.") {
                OutlinedTextField(
                    value = name,
                    onValueChange = { settings.setName(it.take(BlocksConstants.PLAYER_NAME_MAX)) },
                    placeholder = { Text(BlocksConstants.DEFAULT_PLAYER_NAME) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    colors = fieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Section(
                "Controls",
                footer = "Left thumb moves, drag on the right to look. Jump, break and place sit under your right thumb.",
            ) {
                Card { SensitivitySlider(settings) }
            }
            Section("Account") {
                Card {
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        AppMark(44.dp)
                        Column {
                            Text("Signed in", style = Type.heading(17))
                            Text("with your Calimero account", style = Type.body(13, color = BlocksColors.Muted))
                        }
                    }
                    HorizontalDivider(color = BlocksColors.Line)
                    Disclosure("Details") { DetailRow("Account", account) }
                }
                SecondaryButton(onClick = { confirming = true }, destructive = true) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                    ButtonLabel("Sign out")
                }
            }
            Section("Acknowledgements") {
                Text("3D engine: three.js, © 2010–2026 three.js authors, MIT License.", style = Type.body(13, color = BlocksColors.Muted))
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Sign out of Mero Blocks?") },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    onSignOut()
                }) { Text("Sign out", color = BlocksColors.Danger) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel", color = BlocksColors.Ink) } },
            containerColor = BlocksColors.Surface,
        )
    }
}

@Composable
private fun Section(
    title: String,
    footer: String? = null,
    content: @Composable () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title.uppercase(Locale.ROOT), style = Type.body(12, FontWeight.SemiBold, BlocksColors.Muted))
        content()
        footer?.let { Text(it, style = Type.body(13, color = BlocksColors.Muted)) }
    }
}

/** Look sensitivity, 0.3× to 3×. (iOS `SensitivitySlider`.) */
@Composable
fun SensitivitySlider(settings: PlayerSettings) {
    val value by settings.sensitivity.collectAsState()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Outlined.TouchApp, contentDescription = null, tint = BlocksColors.Ink, modifier = Modifier.size(20.dp))
            Text("Look sensitivity", style = Type.body(15), modifier = Modifier.weight(1f))
            Text(String.format(Locale.ROOT, "%.1f×", value), style = Type.mono)
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { settings.setSensitivity((it * STEPS).toInt() / STEPS.toDouble()) },
            valueRange = BlocksConstants.SENSITIVITY_MIN.toFloat()..BlocksConstants.SENSITIVITY_MAX.toFloat(),
            colors =
                SliderDefaults.colors(
                    thumbColor = BlocksColors.Ink,
                    activeTrackColor = BlocksColors.Ink,
                    inactiveTrackColor = BlocksColors.Line,
                ),
        )
    }
}

private const val STEPS = 10
