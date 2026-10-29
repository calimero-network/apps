package network.calimero.pass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Password
import androidx.compose.material.icons.outlined.Restore
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import androidx.fragment.app.FragmentActivity
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.pass.PassViewModel
import network.calimero.pass.core.PassConstants
import network.calimero.pass.core.SecurityModel
import network.calimero.pass.core.VaultDirectory

private fun minutesLabel(minutes: Int) = if (minutes == 60) "1 hour" else "$minutes minute${if (minutes == 1) "" else "s"}"

/** How this phone guards its key, how you get back in if you lose it, and your account (the web's `SecurityPage`). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecurityScreen(
    vm: PassViewModel,
    backend: MeroAppBackend,
) {
    val services = LocalServices.current
    val activity = LocalContext.current as? FragmentActivity
    val model = remember { SecurityModel(vm.preferences) }
    val status by model.status.collectAsState()
    val error by model.error.collectAsState()
    val busy by model.busy.collectAsState()
    val shownCode by model.shownCode.collectAsState()
    val recovery by model.recovery.collectAsState()
    val autoLock by model.autoLockMinutes.collectAsState()
    val device by vm.keeper.device.collectAsState()
    val scope = rememberCoroutineScope()
    var restoreCode by remember { mutableStateOf("") }
    var confirmSignOut by remember { mutableStateOf(false) }
    var confirmReplace by remember { mutableStateOf(false) }
    var lockMenu by remember { mutableStateOf(false) }
    val directory = remember(backend) { VaultDirectory(backend) }

    fun createRecovery() {
        val pair = device ?: return
        scope.launch { model.createRecoveryKey(directory, pair, services.deviceLabel) }
    }

    fun restore() {
        val pair = device ?: return
        scope.launch { if (model.restore(restoreCode, directory, pair, services.deviceLabel) > 0) restoreCode = "" }
    }

    Scaffold(containerColor = Palette.Ground, topBar = { PassTopBar("Security") }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
            item {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SectionLabel("This phone")
                    Text("Security", fontSize = 28.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                    Text("How this phone guards its key, how you get back in if you lose it, and your account.", fontSize = 15.sp, color = Palette.Muted)
                }
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    error?.let { ErrorBanner(it) { model.dismissError() } }
                    status?.let { Banner(Tone.INFO, if (busy) Icons.Outlined.HourglassEmpty else Icons.Outlined.VerifiedUser, it) }
                }
            }
            item {
                PassSection(
                    header = "This phone",
                    footer = "Leaving the app for longer than this clears every vault key from memory. Copied passwords leave the clipboard after ${PassConstants.CLIPBOARD_SECONDS} seconds regardless.",
                ) {
                    Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.Top) {
                        Icon(activity?.let { Biometry.icon(it) } ?: Icons.Outlined.Lock, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(
                            "Its key is sealed by the Android Keystore on this device only, never backed up or synced, and opened with ${activity?.let { Biometry.name(it) } ?: "your screen lock"}.",
                            fontSize = 14.sp,
                            color = Palette.InkSoft,
                        )
                    }
                    RowDivider()
                    Box {
                        Row(Modifier.fillMaxWidth().clickable { lockMenu = true }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Lock after", fontSize = 16.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                            Text(minutesLabel(autoLock), fontSize = 16.sp, color = Palette.Muted)
                            Icon(Icons.Outlined.UnfoldMore, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(18.dp))
                        }
                        DropdownMenu(expanded = lockMenu, onDismissRequest = { lockMenu = false }, containerColor = Palette.Surface) {
                            PassConstants.AUTO_LOCK_CHOICES.forEach { minutes ->
                                DropdownMenuItem(text = { Text(minutesLabel(minutes)) }, onClick = {
                                    lockMenu = false
                                    model.setAutoLockMinutes(minutes)
                                })
                            }
                        }
                    }
                    RowDivider()
                    RowAction("Lock now", Icons.Outlined.Lock, { vm.keeper.lock() })
                    RowDivider()
                    DetailsDisclosure(listOf("Device key" to vm.keeper.fingerprint.orEmpty()))
                }
            }
            item {
                PassSection(header = "Recovery key") {
                    Text(
                        "A code that opens every vault it was given, from a phone or browser that has nothing else. Write it down or keep it in another password manager: whoever reads it can do the same.",
                        fontSize = 14.sp,
                        color = Palette.InkSoft,
                        modifier = Modifier.padding(vertical = 10.dp),
                    )
                    val code = shownCode
                    if (code != null) {
                        Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Banner(Tone.WARN, Icons.Outlined.Visibility, "Store it now; it is not kept anywhere.", title = "Shown once.")
                            Text(
                                code,
                                fontSize = 17.sp,
                                fontWeight = FontWeight.SemiBold,
                                fontFamily = FontFamily.Monospace,
                                color = Palette.Ink,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Palette.LimeSoft)
                                        .padding(14.dp),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                SecondaryButton("Copy", { services.copySecret(code, "Recovery code") }, compact = true, icon = Icons.Outlined.ContentCopy)
                                PrimaryButton("I have stored it", { model.dismissCode() }, compact = true)
                            }
                        }
                    } else {
                        Text(
                            recovery?.let {
                                "One is set up (${it.fingerprint.take(12)}…); vaults you open here get it automatically. Creating a new one replaces it in every vault."
                            } ?: "None is set up from this phone.",
                            fontSize = 13.sp,
                            color = Palette.Muted,
                        )
                        RowAction(
                            if (recovery == null) "Create recovery key" else "Replace recovery key",
                            Icons.Outlined.Password,
                            { if (recovery == null) createRecovery() else confirmReplace = true },
                            enabled = !busy,
                        )
                    }
                }
            }
            item {
                PassSection(header = "Restore this phone", footer = "Lost every other device? Your recovery code hands this phone the keys of every vault it was given.") {
                    Column(Modifier.padding(vertical = 10.dp)) {
                        InputField("Recovery code", restoreCode, { restoreCode = it }, placeholder = "XXXX-XXXX-…", monospaced = true)
                    }
                    RowAction("Restore my vaults", Icons.Outlined.Restore, { restore() }, enabled = restoreCode.isNotBlank() && !busy)
                }
            }
            item {
                PassSection(header = "Account") {
                    RowAction("Sign out", Icons.AutoMirrored.Outlined.Logout, { confirmSignOut = true }, destructive = true)
                    RowDivider()
                    DetailsDisclosure(listOf("Account" to backend.account, "Relay" to if (backend.hasRelay) "Connected" else "None yet"))
                }
            }
        }
    }

    if (confirmReplace) {
        ConfirmDialog("Replace your recovery key?", "The old code stops opening your vaults.", "Replace in every vault", dismiss = { confirmReplace = false }) {
            createRecovery()
        }
    }
    if (confirmSignOut) {
        ConfirmDialog(
            "Sign out of Mero Pass?",
            "Forgetting this phone deletes its device key: next time it has to be approved again, or restored with your recovery key.",
            "Sign out and forget this phone",
            dismiss = { confirmSignOut = false },
            other =
                "Sign out" to {
                    vm.keeper.lock()
                    scope.launch { vm.session.signOut() }
                },
        ) {
            runCatching { vm.keeper.reset() }
            scope.launch { vm.session.signOut(forgetDevice = true) }
        }
    }
}
