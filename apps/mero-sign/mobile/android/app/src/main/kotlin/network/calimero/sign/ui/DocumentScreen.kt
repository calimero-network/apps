package network.calimero.sign.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.GppMaybe
import androidx.compose.material.icons.outlined.Pageview
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import kotlinx.coroutines.launch
import network.calimero.sign.core.DocumentEntry
import network.calimero.sign.core.DocumentModel
import network.calimero.sign.core.LoadPhase
import network.calimero.sign.core.SignFormat
import network.calimero.sign.core.SignIds
import network.calimero.sign.core.hex
import network.calimero.sign.generated.PermissionLevel
import java.io.File

/** One document: where it stands, who signs it, your part, and its file. (iOS `DocumentScreen`.) */
@Composable
fun DocumentScreen(
    model: DocumentModel,
    back: () -> Unit,
) {
    val entry by model.entry.collectAsState()
    val phase by model.phase.collectAsState()
    val signers by model.signers.collectAsState()
    val pdf by model.pdf.collectAsState()
    val integrity by model.integrityWarning.collectAsState()
    val error by model.error.collectAsState()
    var viewer by remember { mutableStateOf<Boolean?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    LaunchedEffect(model) {
        model.load()
        model.loadPdf()
    }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar("Document", back = back) {
            val current = entry
            val bytes = pdf
            if (current != null && bytes != null) {
                IconButton(onClick = { sharePdf(context, bytes, SignFormat.fileName(current.document.name, current.signatures.isNotEmpty())) }) {
                    Icon(Icons.Outlined.Share, contentDescription = "Share the document", tint = Palette.Ink)
                }
            }
        }
        if (viewer == null) NoticeBanner(error) { model.error.value = null }
        RefreshingColumn({ model.load() }) {
            val current = entry
            when {
                current == null && phase is LoadPhase.Failed -> ErrorState((phase as LoadPhase.Failed).message) { scope.launch { model.load() } }
                current == null -> Loading()
                else -> {
                    Summary(current)
                    integrity?.let {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Palette.DangerSoft)
                                .padding(12.dp),
                        ) {
                            Icon(Icons.Outlined.GppMaybe, contentDescription = null, tint = Palette.Danger)
                            Spacer(Modifier.width(10.dp))
                            Text(it, fontSize = 14.sp, color = Palette.Ink)
                        }
                    }
                    YourPart(current, sign = { viewer = true }, view = { viewer = false })
                    SectionLabel("Signers", SignFormat.progress(current))
                    if (signers.isEmpty()) {
                        Card { Text("Nobody was asked to sign this document.", fontSize = 14.sp, color = Palette.Muted, modifier = Modifier.padding(14.dp)) }
                    } else {
                        CardList(signers, inset = 64) { signer ->
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Avatar(signer.name ?: "", signer.account, 38.dp)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Row {
                                        Text(signer.displayName, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                                        if (signer.isMe) Text("  (you)", fontSize = 14.sp, color = Palette.Muted)
                                    }
                                    val signedAt = signer.signedAt
                                    Text(
                                        if (signedAt != null) {
                                            "Signed ${SignFormat.whenText(signedAt)}"
                                        } else if (current.isComplete) {
                                            "Not required"
                                        } else {
                                            "Hasn't signed yet"
                                        },
                                        fontSize = 13.sp,
                                        color = Palette.Muted,
                                    )
                                }
                                Icon(
                                    if (signer.signedAt != null) Icons.Outlined.CheckCircle else Icons.Outlined.AccessTime,
                                    contentDescription = if (signer.signedAt != null) "Signed" else "Waiting",
                                    tint = if (signer.signedAt != null) Palette.Good else Palette.Wait,
                                )
                            }
                        }
                    }
                    Card {
                        Column(Modifier.padding(horizontal = 14.dp)) {
                            DetailsDisclosure(
                                listOf(
                                    "Document" to current.document.id,
                                    "Fingerprint (SHA-256)" to current.document.hash,
                                    "File" to SignIds.blobHex(current.document.pdfBlobId),
                                    "Size" to SignFormat.size(current.document.size),
                                    "Uploaded by" to current.document.uploadedBy.hex,
                                    "Agreement context" to current.agreement.contextId,
                                ).filter { it.second.isNotEmpty() },
                            )
                        }
                    }
                }
            }
        }
    }
    viewer?.let { signing -> ViewerDialog(model, startSigning = signing, dismiss = { viewer = null }) }
}

@Composable
private fun Summary(entry: DocumentEntry) {
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(
                    Modifier.size(54.dp, 64.dp).clip(RoundedCornerShape(12.dp)).background(if (entry.isComplete) Palette.GoodSoft else Palette.Sunken),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.Description, contentDescription = null, tint = if (entry.isComplete) Palette.Good else Palette.Ink, modifier = Modifier.size(28.dp)) }
                Spacer(Modifier.width(14.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(entry.document.name, fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = Palette.Ink)
                    Text("${entry.agreement.name} · ${SignFormat.whenText(entry.document.uploadedAt)}", fontSize = 13.sp, color = Palette.Muted)
                    StatusPill(entry)
                }
            }
            val (signed, required) = entry.progress
            if (required > 0) {
                LinearProgressIndicator(
                    progress = { signed.toFloat() / required },
                    modifier = Modifier.fillMaxWidth().clip(CircleShape),
                    color = if (entry.isComplete) Palette.Good else Palette.Ink,
                    trackColor = Palette.Sunken,
                )
                Text(SignFormat.progress(entry), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Palette.InkSoft)
            }
        }
    }
}

@Composable
private fun YourPart(
    entry: DocumentEntry,
    sign: () -> Unit,
    view: () -> Unit,
) {
    val icon =
        when {
            entry.canSign -> Icons.Outlined.Draw
            entry.isComplete -> Icons.Outlined.Verified
            entry.iSigned -> Icons.Outlined.Check
            else -> Icons.Outlined.Visibility
        }
    val text =
        when {
            entry.isComplete -> "Everyone has signed. The version below carries every signature."
            entry.iSigned -> {
                val left = entry.progress.second - entry.progress.first
                if (left > 0) "You signed. Waiting on $left more ${if (left == 1) "signer" else "signers"}." else "You signed. Waiting on the others."
            }
            entry.canSign -> "This document is waiting on your signature."
            entry.myLevel == PermissionLevel.Read -> "You can read this document. Viewers aren't asked to sign."
            else -> "You're not a signer of this agreement."
        }
    Card {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.size(36.dp).clip(CircleShape).background(if (entry.canSign) Palette.Lime else Palette.Sunken), contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Your part", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted)
                    Text(text, fontSize = 15.sp, color = Palette.Ink)
                }
            }
            if (entry.canSign) PrimaryButton("Review and sign", sign, icon = Icons.Outlined.Draw)
            SecondaryButton(if (entry.isComplete) "View signed document" else "View document", view, icon = Icons.Outlined.Pageview)
        }
    }
}

/** Share the current version as a PDF, through the app's FileProvider. */
fun sharePdf(
    context: Context,
    pdf: ByteArray,
    name: String,
) {
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val file = File(dir, name).apply { writeBytes(pdf) }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send =
        Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    context.startActivity(Intent.createChooser(send, null))
}
