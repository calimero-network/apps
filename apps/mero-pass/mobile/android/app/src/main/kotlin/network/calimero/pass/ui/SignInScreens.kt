package network.calimero.pass.ui

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Drafts
import androidx.compose.material.icons.outlined.HowToReg
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch
import network.calimero.pass.PassViewModel
import network.calimero.pass.core.DeviceKeeper
import network.calimero.pass.core.InvitationDestination
import network.calimero.pass.core.InvitationModel
import network.calimero.pass.core.PassErrorText

/** The front door: what Mero Pass is, and one way in. */
@Composable
fun SignInScreen(
    vm: PassViewModel,
    invitedTo: String?,
    onSignIn: () -> Unit,
) {
    val state by vm.session.client.state
        .collectAsState()
    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.Ground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        HeroIcon(Icons.Filled.Key, 84)
        Spacer(Modifier.height(20.dp))
        Text("Mero Pass", fontWeight = FontWeight.SemiBold, fontSize = 34.sp, color = Palette.Ink)
        Spacer(Modifier.height(10.dp))
        Text(
            "Passwords shared with your team, encrypted on your phone before they leave it.",
            fontSize = 17.sp,
            color = Palette.Muted,
            textAlign = TextAlign.Center,
        )
        if (invitedTo != null) {
            Spacer(Modifier.height(20.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Palette.LimeSoft)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Drafts, contentDescription = null, tint = Palette.Ink)
                Spacer(Modifier.width(10.dp))
                Text("You're invited to join “$invitedTo”. Sign in to accept.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
            }
        }
        Spacer(Modifier.weight(1f))
        state.error?.let {
            Text(it, fontSize = 14.sp, color = Palette.Danger, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
        }
        PrimaryButton("Sign in with Calimero", onSignIn, busy = state.isLoading, icon = Icons.Outlined.HowToReg)
        if (state.isLoading) {
            TextButton(onClick = { vm.session.cancelSignIn() }) { Text("Cancel", color = Palette.Ink) }
        } else {
            Spacer(Modifier.height(12.dp))
            Text("You'll approve this device in your Calimero wallet.", fontSize = 13.sp, color = Palette.Muted)
        }
    }
}

@Composable
private fun HeroIcon(
    icon: ImageVector,
    size: Int,
) {
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape((size * 0.28f).dp)).background(Palette.Lime),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size((size * 0.42f).dp)) }
}

/** How this phone confirms it is you: what BiometricPrompt may use. */
object Biometry {
    /** Strong biometrics or the screen lock; before Android 11 that pairing needs weak biometrics. */
    val authenticators: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    fun available(activity: FragmentActivity): Boolean = BiometricManager.from(activity).canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS

    fun hasBiometrics(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity).canAuthenticate(BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

    /** iOS: "Face ID" / "Touch ID" / "your passcode". */
    fun name(activity: FragmentActivity): String = if (hasBiometrics(activity)) "your fingerprint or face" else "your screen lock"

    fun icon(activity: FragmentActivity): ImageVector = if (hasBiometrics(activity)) Icons.Filled.Fingerprint else Icons.Outlined.LockOpen
}

/**
 * Signed in, key not in memory: the fingerprint, face or screen lock opens it. The first unlock
 * on a phone makes its device key. With no screen lock set there is nothing to ask, as on iOS.
 */
@Composable
fun LockScreen(
    keeper: DeviceKeeper,
    activity: FragmentActivity,
) {
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val hasKey = remember { keeper.hasKey }

    fun open() {
        runCatching { keeper.unlock() }.onFailure { error = PassErrorText.describe(it) }
        busy = false
    }

    fun unlock() {
        if (busy) return
        busy = true
        error = null
        if (!Biometry.available(activity)) {
            open()
            return
        }
        val prompt =
            BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = open()

                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence,
                    ) {
                        busy = false
                        val cancelled =
                            errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                                errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                                errorCode == BiometricPrompt.ERROR_CANCELED
                        if (!cancelled) error = "Couldn't confirm it's you. Try again."
                    }
                },
            )
        prompt.authenticate(
            BiometricPrompt.PromptInfo
                .Builder()
                .setTitle("Unlock your vaults")
                .setAllowedAuthenticators(Biometry.authenticators)
                .build(),
        )
    }

    LaunchedEffect(Unit) { unlock() }

    Column(
        Modifier
            .fillMaxSize()
            .background(Palette.Ground)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))
        HeroIcon(Icons.Filled.Lock, 76)
        Spacer(Modifier.height(18.dp))
        Text(
            if (hasKey) "Mero Pass is locked" else "Protect this phone's key",
            fontWeight = FontWeight.SemiBold,
            fontSize = 26.sp,
            color = Palette.Ink,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            if (hasKey) {
                "Unlock to open your vaults. Every vault key is wrapped to this phone's key, kept in the Android Keystore on this device only."
            } else {
                "This phone gets its own key, kept in the Android Keystore on this device only and opened with ${Biometry.name(activity)}. Vault keys are wrapped to it."
            },
            fontSize = 16.sp,
            color = Palette.Muted,
            textAlign = TextAlign.Center,
        )
        error?.let {
            Spacer(Modifier.height(14.dp))
            ErrorBanner(it)
        }
        Spacer(Modifier.weight(1f))
        PrimaryButton(if (hasKey) "Unlock" else "Set up and unlock", { unlock() }, busy = busy, icon = Biometry.icon(activity))
    }
}

/** Join a team or vault from a link: ask, join, then say where it landed. */
@Composable
fun InvitationSheet(
    vm: PassViewModel,
    open: (InvitationDestination) -> Unit,
) {
    val stage by vm.invitation.stage.collectAsState()
    val scope = rememberCoroutineScope()
    val joining = stage is InvitationModel.Stage.Joining

    fun accept() {
        scope.launch { vm.invitation.accept(backend = { vm.session.backend.value }, didJoin = { vm.session.didJoinNamespace() }) }
    }

    PassSheet(dismiss = { vm.invitation.reset() }, locked = joining) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp).navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            when (val s = stage) {
                InvitationModel.Stage.Idle -> Unit
                is InvitationModel.Stage.Confirm -> {
                    SheetHeader(Icons.Outlined.Drafts, Palette.LimeSoft, "Join “${s.title}”?")
                    SheetText(
                        if (s.isVault) {
                            "This opens “${s.title}”, and the access it grants is the whole of ${s.teamName}: every open vault in the team."
                        } else {
                            "Joining gives you access to the team and every open vault in it."
                        },
                    )
                    PrimaryButton("Join", { accept() })
                    SecondaryButton("Not now", { vm.invitation.reset() })
                }
                is InvitationModel.Stage.Joining -> {
                    CircularProgressIndicator(color = Palette.Ink, modifier = Modifier.padding(top = 12.dp))
                    Text("Joining “${s.title}”…", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, textAlign = TextAlign.Center)
                    SheetText("This can take up to a minute when no other member is online.")
                }
                is InvitationModel.Stage.Joined -> {
                    val destination = s.destination
                    SheetHeader(Icons.Filled.Check, Palette.Lime, "You're in “${destination.vault?.vaultName ?: destination.teamName}”")
                    SheetText(
                        if (destination.vault == null) {
                            "Its vaults are on the next screen. Each one opens once a member who holds its key lets this phone in."
                        } else {
                            "The vault opens next. Its items appear once a member who holds the key lets this phone in."
                        },
                    )
                    PrimaryButton("Open", {
                        open(destination)
                        vm.invitation.reset()
                    })
                }
                is InvitationModel.Stage.Failed -> {
                    SheetHeader(Icons.Outlined.WarningAmber, Palette.DangerSoft, "Couldn't join")
                    SheetText(s.message)
                    if (vm.invitation.invitation != null) PrimaryButton("Try again", { accept() })
                    SecondaryButton("Close", { vm.invitation.reset() })
                }
            }
        }
    }
}

@Composable
private fun SheetHeader(
    icon: ImageVector,
    tone: Color,
    title: String,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(60.dp).clip(CircleShape).background(tone), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(26.dp))
        }
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, textAlign = TextAlign.Center)
    }
}

@Composable
private fun SheetText(text: String) {
    Text(text, fontSize = 16.sp, color = Palette.Muted, textAlign = TextAlign.Center)
}

/** An invitation link to share or copy, with what it grants. */
@Composable
fun InviteLinkSheet(
    title: String,
    link: String,
    hint: String,
    dismiss: () -> Unit,
) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    PassSheet(dismiss) {
        SheetBar(title, action = null, cancel = dismiss)
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(20.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(hint, fontSize = 15.sp, color = Palette.Muted)
            Text(
                link,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = Palette.Ink,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Palette.Sunken)
                        .padding(12.dp),
            )
            PrimaryButton("Share link", { Clipboard.share(context, link) }, icon = Icons.Outlined.Share)
            SecondaryButton(
                if (copied) "Copied" else "Copy link",
                {
                    Clipboard.copyPlain(context, "Invitation", link)
                    copied = true
                },
                icon = if (copied) Icons.Filled.Check else Icons.Outlined.ContentCopy,
            )
            Text(
                "An invitation never carries a secret: their phone or browser gets each vault's key from a member who holds it.",
                fontSize = 13.sp,
                color = Palette.Muted,
            )
        }
    }
}

/** Paste an invitation link someone sent. */
@Composable
fun JoinSheet(
    open: (String) -> Unit,
    dismiss: () -> Unit,
) {
    val context = LocalContext.current
    var text by remember { mutableStateOf("") }
    PassSheet(dismiss) {
        SheetBar("Join with a link", "Continue", cancel = dismiss, canAct = text.isNotBlank(), act = {
            dismiss()
            open(text)
        })
        Column(
            Modifier
                .fillMaxWidth()
                .padding(20.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            InputField("Invitation link or code", text, { text = it }, placeholder = "https://links.calimero.network/…", multiline = true)
            SecondaryButton("Paste", { Clipboard.paste(context)?.let { text = it } }, compact = true, icon = Icons.Outlined.ContentPaste)
            Text("Ask someone in the team to invite you from their Mero Pass.", fontSize = 14.sp, color = Palette.Muted)
        }
    }
}
