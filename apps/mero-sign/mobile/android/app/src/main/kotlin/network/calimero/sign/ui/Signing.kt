package network.calimero.sign.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Gesture
import androidx.compose.material.icons.outlined.OpenInFull
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import network.calimero.sign.core.ConsentText
import network.calimero.sign.core.DocumentModel
import network.calimero.sign.core.SavedSignature
import network.calimero.sign.core.SignFormat
import network.calimero.sign.core.SignatureInk
import network.calimero.sign.core.SignaturePlacement
import network.calimero.sign.core.SigningStep
import network.calimero.sign.pdf.InkRenderer
import network.calimero.sign.pdf.PdfPages
import kotlin.math.roundToInt
import network.calimero.sign.core.Box as PageBox

/**
 * The document, full screen, and — when it waits on you — signing it: consent, choose a
 * signature, place it, finish. (iOS `DocumentViewerScreen`.)
 */
@Composable
fun ViewerDialog(
    model: DocumentModel,
    startSigning: Boolean,
    dismiss: () -> Unit,
) {
    val entry by model.entry.collectAsState()
    val pdf by model.pdf.collectAsState()
    val pdfError by model.pdfError.collectAsState()
    val step by model.step.collectAsState()
    val chosen by model.chosenSignature.collectAsState()
    val chosenIsNew by model.chosenIsNew.collectAsState()
    val error by model.error.collectAsState()
    var placement by remember { mutableStateOf<SignaturePlacement?>(null) }
    var saveToLibrary by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val pages by produceState<PdfPages?>(null, pdf) {
        val bytes = pdf
        value = if (bytes == null) null else withContext(Dispatchers.IO) { runCatching { PdfPages.open(context, bytes) }.getOrNull() }
    }
    DisposableEffect(pages) { onDispose { pages?.close() } }
    LaunchedEffect(Unit) {
        model.loadPdf()
        if (startSigning && model.entry.value?.canSign == true && model.step.value == SigningStep.IDLE) model.beginSigning()
    }
    LaunchedEffect(step, pages, chosen) {
        when (step) {
            SigningStep.PLACING -> {
                val p = pages
                val png = chosen
                if (placement == null && p != null && png != null) {
                    val image = BitmapFactory.decodeByteArray(png, 0, png.size)
                    val (w, h) = p.sizes[0]
                    placement = SignaturePlacement.initial(0, w, h, image.width.toFloat() / image.height)
                }
            }
            SigningStep.DONE -> haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            SigningStep.CHOOSE, SigningStep.IDLE -> placement = null
            else -> Unit
        }
    }
    val close = {
        model.cancelSigning()
        dismiss()
    }

    Dialog(onDismissRequest = { if (step != SigningStep.SUBMITTING) close() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Palette.Sunken)) {
            TopBar(entry?.document?.name ?: "Document", back = null) {
                val bytes = pdf
                val current = entry
                if (bytes != null && current != null && (step == SigningStep.IDLE || step == SigningStep.DONE)) {
                    IconButton(onClick = { sharePdf(context, bytes, SignFormat.fileName(current.document.name, current.signatures.isNotEmpty())) }) {
                        Icon(Icons.Outlined.Share, contentDescription = "Share", tint = Palette.Ink)
                    }
                }
                IconButton(onClick = close, enabled = step != SigningStep.SUBMITTING) { Icon(Icons.Outlined.Close, contentDescription = "Close", tint = Palette.Ink) }
            }
            NoticeBanner(error) { model.error.value = null }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                ViewerBody(
                    model = model,
                    pages = pages,
                    pdfError = pdfError,
                    step = step,
                    documentName = entry?.document?.name,
                    complete = entry?.isComplete == true,
                    chosen = chosen,
                    placement = placement,
                    place = { placement = it },
                )
            }
            SigningBar(
                model = model,
                step = step,
                canSign = entry?.canSign == true && pdf != null,
                chosenIsNew = chosenIsNew,
                saveToLibrary = saveToLibrary,
                setSaveToLibrary = { saveToLibrary = it },
                placement = placement,
                done = dismiss,
            )
        }
        if (step == SigningStep.CONSENT) ConsentDialog(model)
        if (step == SigningStep.CHOOSE) ChooserDialog(model)
    }
}

@Composable
private fun BottomBar(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Palette.Surface)) {
        Hairline()
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).navigationBarsPadding()) { content() }
    }
}

/** Every page, rendered by PdfRenderer, top to bottom. */
@Composable
private fun PageList(pages: PdfPages) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val widthPx = with(LocalDensity.current) { (maxWidth - 32.dp).toPx().roundToInt() }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding =
                androidx.compose.foundation.layout
                    .PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(pages.count) { index ->
                val (w, h) = pages.sizes[index]
                val bitmap by produceState<Bitmap?>(null, index, widthPx) { value = withContext(Dispatchers.IO) { pages.render(index, widthPx * 2) } }
                Box(
                    Modifier.fillMaxWidth().height(with(LocalDensity.current) { (widthPx * h / w).toDp() }).background(androidx.compose.ui.graphics.Color.White),
                ) {
                    bitmap?.let { Image(it.asImageBitmap(), contentDescription = "Page ${index + 1}", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds) }
                }
            }
        }
    }
}

/** One page with the signature on it: drag to move, drag the corner to resize, arrows to change page. */
@Composable
private fun PlacementView(
    pages: PdfPages,
    signature: ByteArray,
    placement: SignaturePlacement,
    update: (SignaturePlacement) -> Unit,
) {
    val image = remember(signature) { BitmapFactory.decodeByteArray(signature, 0, signature.size).asImageBitmap() }
    val density = LocalDensity.current
    var current by remember { mutableStateOf(placement) }
    current = placement
    Column(Modifier.fillMaxSize().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
            val (pw, ph) = pages.sizes[placement.pageIndex]
            val availW = with(density) { maxWidth.toPx() }
            val availH = with(density) { maxHeight.toPx() }
            val scale = minOf(availW / pw, availH / ph)
            val shownW = pw * scale
            val shownH = ph * scale
            val bitmap by produceState<Bitmap?>(null, placement.pageIndex, shownW) {
                value = withContext(Dispatchers.IO) { pages.render(placement.pageIndex, (shownW * 1.5f).roundToInt()) }
            }
            Box(Modifier.size(with(density) { shownW.toDp() }, with(density) { shownH.toDp() }).background(androidx.compose.ui.graphics.Color.White)) {
                bitmap?.let { Image(it.asImageBitmap(), contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds) }
                val r = placement.rect
                Box(
                    Modifier
                        .offset { IntOffset((r.x * scale).roundToInt(), (r.y * scale).roundToInt()) }
                        .size(with(density) { (r.width * scale).toDp() }, with(density) { (r.height * scale).toDp() })
                        .border(1.5.dp, Palette.Ink)
                        .pointerInput(scale, pw, ph) {
                            detectDragGestures { change, drag ->
                                change.consume()
                                val now = current.rect
                                update(current.copy(rect = now.copy(x = now.x + drag.x / scale, y = now.y + drag.y / scale)).clamped(pw, ph))
                            }
                        },
                ) {
                    Image(image, contentDescription = "Your signature. Drag to move.", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
                }
                Box(
                    Modifier
                        .offset { IntOffset(((r.right) * scale - 13.dp.toPx()).roundToInt(), ((r.bottom) * scale - 13.dp.toPx()).roundToInt()) }
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(Palette.Lime)
                        .border(1.5.dp, Palette.Ink, CircleShape)
                        .pointerInput(scale, pw, ph) {
                            detectDragGestures { change, drag ->
                                change.consume()
                                val now = current.rect
                                val aspect = if (now.height > 0) now.width / now.height else 3f
                                val width = now.width + drag.x / scale
                                update(current.copy(rect = PageBox(now.x, now.y, width, width / aspect)).clamped(pw, ph))
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.OpenInFull, contentDescription = "Resize signature", tint = Palette.Ink, modifier = Modifier.size(13.dp)) }
            }
        }
        if (pages.count > 1) {
            Spacer(Modifier.height(10.dp))
            Row(
                Modifier.clip(CircleShape).background(Palette.Surface).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                fun move(page: Int) {
                    val (w, h) = pages.sizes[page]
                    val start = SignaturePlacement.initial(page, w, h, placement.rect.width / placement.rect.height)
                    update(start.copy(rect = start.rect.copy(width = placement.rect.width, height = placement.rect.height)).clamped(w, h))
                }
                IconButton(onClick = { move(placement.pageIndex - 1) }, enabled = placement.pageIndex > 0) {
                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, contentDescription = "Previous page", tint = Palette.Ink)
                }
                Text("Page ${placement.pageIndex + 1} of ${pages.count}", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                IconButton(onClick = { move(placement.pageIndex + 1) }, enabled = placement.pageIndex < pages.count - 1) {
                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = "Next page", tint = Palette.Ink)
                }
            }
        }
    }
}

@Composable
private fun DoneCard(complete: Boolean) {
    Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(Palette.Lime), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Done, contentDescription = null, tint = Palette.Ink, modifier = Modifier.size(34.dp))
        }
        Text("Signed", fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, color = Palette.Ink)
        Text(
            if (complete) "Everyone has signed. The final version is ready to share." else "Your signature is recorded. The others see the signed version as it syncs to them.",
            fontSize = 15.sp,
            color = Palette.Muted,
            textAlign = TextAlign.Center,
        )
    }
}

/** A full-screen sheet with a title bar. */
@Composable
private fun FullSheet(
    title: String,
    leading: Pair<String, () -> Unit>?,
    back: (() -> Unit)? = null,
    trailing: Pair<String, () -> Unit>? = null,
    content: @Composable () -> Unit,
) {
    Dialog(onDismissRequest = { leading?.second?.invoke() ?: back?.invoke() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Palette.Ground).statusBarsPadding()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Palette.Surface)
                    .height(56.dp)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                when {
                    back != null -> IconButton(onClick = back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back", tint = Palette.Ink) }
                    leading != null -> TextButton(onClick = leading.second) { Text(leading.first, color = Palette.Ink, fontSize = 16.sp) }
                }
                Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, modifier = Modifier.weight(1f).padding(start = 8.dp), maxLines = 1)
                trailing?.let { TextButton(onClick = it.second) { Text(it.first, color = Palette.Ink, fontSize = 16.sp) } }
            }
            Hairline()
            Box(Modifier.weight(1f)) { content() }
        }
    }
}

/** Consent to sign electronically: the web's disclosure, a checkbox, and `set_consent`. */
@Composable
private fun ConsentDialog(model: DocumentModel) {
    var agreed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var reading by remember { mutableStateOf(false) }
    val error by model.error.collectAsState()
    val scope = rememberCoroutineScope()
    FullSheet(ConsentText.TITLE, leading = "Cancel" to { model.cancelSigning() }) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                IconCircle(Icons.Outlined.VerifiedUser, Palette.LimeSoft)
                Text(ConsentText.INTRO, fontSize = 16.sp, color = Palette.Ink)
                Text(ConsentText.READ_LINK, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, modifier = Modifier.clickable { reading = true })
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Palette.Sunken)
                        .clickable { agreed = !agreed }
                        .padding(14.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Icon(if (agreed) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank, contentDescription = null, tint = Palette.Ink)
                    Spacer(Modifier.width(12.dp))
                    Text(ConsentText.CHECKBOX, fontSize = 15.sp, color = Palette.Ink)
                }
                error?.let { Text(it, fontSize = 14.sp, color = Palette.Danger) }
            }
            BottomBar {
                PrimaryButton(ConsentText.ACTION, {
                    busy = true
                    scope.launch {
                        model.giveConsent()
                        busy = false
                    }
                }, enabled = agreed, busy = busy)
            }
        }
    }
    if (reading) {
        FullSheet(ConsentText.DISCLOSURE_TITLE, leading = null, trailing = "Close" to { reading = false }) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(ConsentText.LEAD, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
                ConsentText.ITEMS.forEachIndexed { index, item ->
                    Row {
                        Text("${index + 1}.", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.InkSoft)
                        Spacer(Modifier.width(10.dp))
                        Text(item, fontSize = 15.sp, color = Palette.Ink)
                    }
                }
            }
        }
    }
}

/** Draw a new signature or reuse one from your library. */
@Composable
private fun ChooserDialog(model: DocumentModel) {
    val saved by model.savedSignatures.collectAsState()
    val loading by model.libraryLoading.collectAsState()
    var drawing by remember { mutableStateOf(false) }
    if (drawing) {
        SignaturePadSheet("Use signature", back = { drawing = false }) { png -> model.choose(png, isNew = true) }
        return
    }
    FullSheet("Choose a signature", leading = "Cancel" to { model.cancelSigning() }) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Card(onClick = { drawing = true }) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(48.dp).clip(CircleShape).background(Palette.Lime), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Gesture, contentDescription = null, tint = Palette.Ink)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Draw a signature", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                        Text("With your finger, on a signature pad.", fontSize = 13.sp, color = Palette.Muted)
                    }
                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
                }
            }
            SectionLabel("Your signatures", if (saved.isEmpty()) null else "${saved.size}")
            when {
                loading && saved.isEmpty() -> Loading()
                saved.isEmpty() -> Text("No saved signatures yet. Draw one and keep it for next time.", fontSize = 14.sp, color = Palette.Muted)
                else ->
                    LazyVerticalGrid(GridCells.Fixed(2), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(saved, key = { it.id.toString() }) { signature ->
                            SignatureTile(signature) { signature.png?.let { model.choose(it, isNew = false) } }
                        }
                    }
            }
        }
    }
}

/** A saved signature on paper white. */
@Composable
fun SignatureTile(
    signature: SavedSignature,
    menu: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val bitmap = remember(signature.blobId) { signature.png?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
    Card(onClick = onClick) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(74.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(androidx.compose.ui.graphics.Color.White)
                    .border(0.5.dp, Palette.Hairline, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (bitmap != null) {
                    Image(bitmap, contentDescription = signature.name, modifier = Modifier.fillMaxSize().padding(6.dp), contentScale = ContentScale.Fit)
                } else {
                    Icon(Icons.Outlined.Draw, contentDescription = null, tint = Palette.Muted)
                }
                menu?.let { Box(Modifier.align(Alignment.TopEnd)) { it() } }
            }
            Text(signature.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text(SignFormat.whenText(signature.createdAt), fontSize = 12.sp, color = Palette.Muted)
        }
    }
}

/** The signature pad: draw with a finger, undo a stroke, clear, use it. (iOS `SignaturePadScreen`.) */
@Composable
fun SignaturePadSheet(
    actionTitle: String,
    back: () -> Unit,
    use: (ByteArray) -> Unit,
) {
    val ink = remember { SignatureInk() }
    var version by remember { mutableIntStateOf(0) }
    var padSize by remember { mutableStateOf(0f to 0f) }
    val density = LocalDensity.current
    val haptics = LocalHapticFeedback.current
    FullSheet("Draw your signature", leading = null, back = back) {
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Sign inside the box.", fontSize = 15.sp, color = Palette.Muted)
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(androidx.compose.ui.graphics.Color.White)
                    .border(1.5.dp, Palette.Hairline, RoundedCornerShape(14.dp)),
            ) {
                Box(
                    Modifier
                        .align(Alignment.BottomStart)
                        .padding(start = 28.dp, end = 28.dp, bottom = 48.dp)
                        .fillMaxWidth()
                        .height(1.5.dp)
                        .background(Palette.Hairline),
                )
                Icon(Icons.Outlined.Close, contentDescription = null, tint = Palette.Muted, modifier = Modifier.align(Alignment.BottomStart).padding(start = 22.dp, bottom = 52.dp).size(16.dp))
                if (version >= 0 && ink.isEmpty) {
                    Text("Sign here", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.Muted, modifier = Modifier.align(Alignment.Center))
                }
                Canvas(
                    Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectDragGestures(
                                onDragStart = { o ->
                                    ink.begin(SignatureInk.Point(o.x / density.density, o.y / density.density, System.currentTimeMillis()))
                                    version++
                                },
                                onDrag = { change, _ ->
                                    change.consume()
                                    ink.add(SignatureInk.Point(change.position.x / density.density, change.position.y / density.density, System.currentTimeMillis()))
                                    version++
                                },
                            )
                        },
                ) {
                    padSize = (size.width / density.density) to (size.height / density.density)
                    if (version < 0) return@Canvas
                    drawIntoCanvas { InkRenderer.draw(it.nativeCanvas, ink, density.density) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Undo", {
                    ink.undo()
                    version++
                }, compact = true, icon = Icons.AutoMirrored.Outlined.Undo)
                SecondaryButton("Clear", {
                    ink.clear()
                    version++
                }, compact = true, icon = Icons.Outlined.DeleteOutline)
            }
            Spacer(Modifier.weight(1f))
            PrimaryButton(actionTitle, {
                InkRenderer.png(ink, padSize.first, padSize.second, density.density)?.let {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    use(it)
                }
            }, enabled = version >= 0 && !ink.isEmpty, icon = Icons.Outlined.Done)
            Spacer(Modifier.navigationBarsPadding())
        }
    }
}

/** The viewer's bottom bar: sign, place and finish, or done. */
@Composable
private fun SigningBar(
    model: DocumentModel,
    step: SigningStep,
    canSign: Boolean,
    chosenIsNew: Boolean,
    saveToLibrary: Boolean,
    setSaveToLibrary: (Boolean) -> Unit,
    placement: SignaturePlacement?,
    done: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    BottomBar {
        when (step) {
            SigningStep.IDLE, SigningStep.CHECKING, SigningStep.CONSENT, SigningStep.CHOOSE ->
                if (canSign) {
                    PrimaryButton("Sign this document", { scope.launch { model.beginSigning() } }, enabled = step != SigningStep.CHECKING, icon = Icons.Outlined.Draw)
                }
            SigningStep.PLACING, SigningStep.SUBMITTING ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Drag your signature into place. Drag the corner to resize.", fontSize = 13.sp, color = Palette.Muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                    if (chosenIsNew) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Save to my signatures", fontSize = 15.sp, color = Palette.Ink, modifier = Modifier.weight(1f))
                            Switch(saveToLibrary, setSaveToLibrary, colors = SwitchDefaults.colors(checkedTrackColor = Palette.Ink, checkedThumbColor = Palette.Lime))
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SecondaryButton("Change", { model.backToChoose() }, modifier = Modifier.width(120.dp))
                        PrimaryButton(
                            "Finish signing",
                            {
                                placement?.let {
                                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    scope.launch { model.submit(it, saveToLibrary) }
                                }
                            },
                            modifier = Modifier.weight(1f),
                            enabled = placement != null && step != SigningStep.SUBMITTING,
                            icon = Icons.Outlined.Done,
                        )
                    }
                }
            SigningStep.DONE ->
                PrimaryButton("Done", {
                    model.finish()
                    done()
                })
        }
    }
}

/** What fills the viewer: loading, the pages, the placement view, or "Signed". */
@Composable
private fun ViewerBody(
    model: DocumentModel,
    pages: PdfPages?,
    pdfError: String?,
    step: SigningStep,
    documentName: String?,
    complete: Boolean,
    chosen: ByteArray?,
    placement: SignaturePlacement?,
    place: (SignaturePlacement) -> Unit,
) {
    val scope = rememberCoroutineScope()
    when {
        pdfError != null -> ErrorState(pdfError) { scope.launch { model.loadPdf(force = true) } }
        pages == null ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = Palette.Ink)
                Spacer(Modifier.height(12.dp))
                Text("Loading ${documentName ?: "the document"}…", fontSize = 15.sp, color = Palette.Muted)
            }
        step == SigningStep.DONE -> DoneCard(complete)
        (step == SigningStep.PLACING || step == SigningStep.SUBMITTING) && chosen != null && placement != null ->
            PlacementView(pages, chosen, placement, place)
        else -> PageList(pages)
    }
    if (step == SigningStep.CHECKING || step == SigningStep.SUBMITTING) {
        Column(
            Modifier.clip(RoundedCornerShape(16.dp)).background(Palette.Surface).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            CircularProgressIndicator(color = Palette.Ink)
            Spacer(Modifier.height(12.dp))
            Text(if (step == SigningStep.SUBMITTING) "Signing…" else "Checking your consent…", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Palette.Ink)
        }
    }
}
