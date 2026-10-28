package network.calimero.docs.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.HideImage
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.docs.app.DocumentModel
import network.calimero.docs.app.personName
import network.calimero.docs.core.BlockAlignment
import network.calimero.docs.core.BlockKind
import network.calimero.docs.core.BlockNoteColors
import network.calimero.docs.core.DocBlock
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsFormat
import network.calimero.docs.core.LinkTarget

private const val HIGHLIGHT_MS = 2_500L
private const val TOAST_MS = 1_600L

/** One document, drawn natively and read-only, with its comments. */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DocumentScreen(
    model: DocumentModel,
    focusBlock: String?,
    onBack: () -> Unit,
    onOpenDoc: (DocTarget) -> Unit,
) {
    val phase by model.phase.collectAsState()
    val doc by model.doc.collectAsState()
    val blocks by model.blocks.collectAsState()
    val threads by model.threads.collectAsState()
    val contextId by model.contextId.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val list = rememberLazyListState()
    var comments by remember { mutableStateOf<CommentFocus?>(null) }
    var highlighted by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(model) {
        if (phase != DocumentModel.Phase.Ready) model.open()
        model.live()
    }
    LaunchedEffect(blocks.size) {
        val index = focusBlock?.let { id -> blocks.indexOfFirst { it.id == id } } ?: -1
        if (index >= 0 && highlighted == null) {
            highlighted = focusBlock
            list.animateScrollToItem(index + 1)
            delay(HIGHLIGHT_MS)
            highlighted = ""
        }
    }
    val counts = remember(threads) { model.countsByBlock }
    val commentCount = remember(threads) { model.commentCount }
    val copy = { link: String ->
        copyToClipboard(context, link)
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch {
            copied = true
            delay(TOAST_MS)
            copied = false
        }
        Unit
    }
    val openLink = { href: String ->
        when (val t = DocsFormat.linkTarget(href)) {
            is LinkTarget.Doc -> onOpenDoc(t.target)
            is LinkTarget.Web -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(t.url))) }
            else -> Unit
        }
        Unit
    }

    Scaffold(
        containerColor = DocsTheme.surface,
        topBar = {
            TopAppBar(
                title = { Text(model.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 17.sp) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = { comments = CommentFocus.All }, enabled = phase == DocumentModel.Phase.Ready) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = "Comments", modifier = Modifier.size(22.dp))
                            if (commentCount > 0) {
                                Spacer(Modifier.width(3.dp))
                                Text("$commentCount", style = DocsTheme.body(14, FontWeight.SemiBold, DocsTheme.ink))
                            }
                        }
                    }
                    IconButton(onClick = { shareLink(context, model.shareLink, model.title) }) {
                        Icon(Icons.Outlined.Share, contentDescription = "Share link")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DocsTheme.surface, scrolledContainerColor = DocsTheme.surface),
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            val p = phase
            when {
                p is DocumentModel.Phase.Loading && blocks.isEmpty() -> LoadingRows(5)
                p is DocumentModel.Phase.Failed -> ErrorState(p.message) { scope.launch { model.open() } }
                else ->
                    PullToRefreshBox(
                        isRefreshing = refreshing,
                        onRefresh = {
                            scope.launch {
                                refreshing = true
                                model.refresh()
                                refreshing = false
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        LazyColumn(state = list, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp)) {
                            item { Header(model, doc?.updatedAt ?: 0u, doc?.updatedBy.orEmpty(), doc?.archived == true) }
                            if (blocks.all { it.isBlank } && blocks.none { it.kind is BlockKind.Image }) {
                                item { Text("This document is empty.", style = DocsTheme.body(16, color = DocsTheme.faint), modifier = Modifier.padding(vertical = 24.dp)) }
                            }
                            items(blocks, key = { it.id }) { block ->
                                BlockRow(
                                    block = block,
                                    model = model,
                                    comments = counts[block.id] ?: 0,
                                    highlighted = highlighted == block.id,
                                    onComment = { comments = CommentFocus.Block(block.id) },
                                    onCopyLink = { copy(model.blockLink(block.id)) },
                                    onCopyText = { copyToClipboard(context, block.plainText) },
                                    onLink = openLink,
                                )
                            }
                            item {
                                DetailsDisclosure(
                                    listOf(
                                        "Document" to model.docId,
                                        "Folder" to model.folderId,
                                        "Docs context" to (contextId ?: "—"),
                                        "Workspace" to model.workspaceId,
                                        "Words" to "${model.wordCount}",
                                        "Created by" to (doc?.createdBy?.ifEmpty { null } ?: "—"),
                                    ),
                                    Modifier.padding(top = 32.dp).fillMaxWidth().card(),
                                )
                            }
                        }
                    }
            }
            AnimatedVisibility(copied, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 24.dp)) {
                Row(
                    Modifier.background(DocsTheme.lime, RoundedCornerShape(50)).padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Check, contentDescription = null, tint = DocsTheme.ink, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Link copied", style = DocsTheme.body(14, FontWeight.SemiBold, DocsTheme.ink))
                }
            }
        }
    }

    comments?.let { focus -> CommentsSheet(model = model, initialFocus = focus, onDismiss = { comments = null }) }
}

@Composable
private fun Header(
    model: DocumentModel,
    updatedAt: ULong,
    updatedBy: String,
    archived: Boolean,
) {
    Column(Modifier.padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(model.title, style = DocsTheme.heading(28))
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (model.folderName.isNotEmpty()) {
                Icon(Icons.Outlined.Folder, contentDescription = null, tint = DocsTheme.muted, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
                Text("${model.folderName} · ", style = DocsTheme.body(13, color = DocsTheme.muted), maxLines = 1)
            }
            if (updatedAt > 0u) {
                Text(
                    "Updated ${DocsFormat.relativeTime(updatedAt)} by ${personName(updatedBy, model.account)}",
                    style = DocsTheme.body(13, color = DocsTheme.muted),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (archived) {
            Row(Modifier.fillMaxWidth().background(DocsTheme.sunken, RoundedCornerShape(12.dp)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Archive, contentDescription = null, tint = DocsTheme.ink2, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("This document is archived.", style = DocsTheme.body(14, FontWeight.Medium))
            }
        }
    }
}

/** One block, with its comment count and a long-press menu. */
@Suppress("LongParameterList")
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BlockRow(
    block: DocBlock,
    model: DocumentModel,
    comments: Int,
    highlighted: Boolean,
    onComment: () -> Unit,
    onCopyLink: () -> Unit,
    onCopyText: () -> Unit,
    onLink: (String) -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    val wash =
        when {
            highlighted -> DocsTheme.commentWash
            comments > 0 -> DocsTheme.commentWash.copy(alpha = DocsTheme.commentWash.alpha * 0.35f)
            else -> Color.Transparent
        }
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(wash)
                .combinedClickable(onClick = {}, onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    menu = true
                })
                .padding(vertical = 2.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(Modifier.weight(1f)) { BlockView(block, model, onLink) }
            if (comments > 0) {
                Row(
                    Modifier
                        .padding(start = 8.dp, top = if (block.kind is BlockKind.Heading) 16.dp else 8.dp)
                        .clip(CircleShape)
                        .background(DocsTheme.lime)
                        .combinedClickable(onClick = onComment)
                        .padding(horizontal = 7.dp, vertical = 4.dp)
                        .semantics { contentDescription = if (comments == 1) "1 comment" else "$comments comments" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.ChatBubble, contentDescription = null, tint = DocsTheme.ink, modifier = Modifier.size(11.dp))
                    Spacer(Modifier.width(3.dp))
                    Text("$comments", style = DocsTheme.body(12, FontWeight.SemiBold, DocsTheme.ink))
                }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("Comment") },
                leadingIcon = { Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null) },
                onClick = {
                    menu = false
                    onComment()
                },
            )
            DropdownMenuItem(
                text = { Text("Copy link to block") },
                leadingIcon = { Icon(Icons.Outlined.Link, contentDescription = null) },
                onClick = {
                    menu = false
                    onCopyLink()
                },
            )
            if (block.plainText.isNotEmpty()) {
                DropdownMenuItem(
                    text = { Text("Copy text") },
                    leadingIcon = { Icon(Icons.Outlined.ContentCopy, contentDescription = null) },
                    onClick = {
                        menu = false
                        onCopyText()
                    },
                )
            }
        }
    }
}

/** A block, drawn by kind like the web's BlockNote schema. */
@Composable
private fun BlockView(
    block: DocBlock,
    model: DocumentModel,
    onLink: (String) -> Unit,
) {
    val indent = Modifier.padding(start = (block.depth * 22).dp)
    when (val kind = block.kind) {
        BlockKind.Paragraph ->
            if (block.isBlank) Spacer(Modifier.height(10.dp)) else RichText(block, 17, onLink = onLink, modifier = indent.padding(vertical = 5.dp))
        is BlockKind.Heading ->
            RichText(
                block,
                listOf(26, 21, 18)[kind.level - 1],
                FontWeight.SemiBold,
                onLink = onLink,
                modifier = indent.padding(top = if (kind.level == 1) 18.dp else 14.dp, bottom = 4.dp).semantics { heading() },
            )
        BlockKind.Bullet -> ListItem(block, if (block.depth % 2 == 0) "•" else "◦", indent, onLink)
        is BlockKind.Numbered -> ListItem(block, "${kind.index}.", indent, onLink)
        is BlockKind.Check ->
            Row(indent.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                Icon(
                    if (kind.checked) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank,
                    contentDescription = if (kind.checked) "Done" else "Not done",
                    tint = if (kind.checked) DocsTheme.ink else DocsTheme.muted,
                    modifier = Modifier.padding(top = 2.dp).size(20.dp),
                )
                Spacer(Modifier.width(10.dp))
                RichText(block, 17, strike = kind.checked, alpha = if (kind.checked) 0.6f else 1f, onLink = onLink)
            }
        BlockKind.Quote ->
            Row(indent.padding(vertical = 6.dp).height(IntrinsicSize.Min)) {
                Box(Modifier.width(3.dp).fillMaxHeight().background(DocsTheme.lineStrong, RoundedCornerShape(2.dp)))
                Spacer(Modifier.width(12.dp))
                RichText(block, 17, color = DocsTheme.ink2, onLink = onLink)
            }
        is BlockKind.Code ->
            Column(
                indent
                    .padding(vertical = 6.dp)
                    .fillMaxWidth()
                    .background(DocsTheme.codeGround, RoundedCornerShape(12.dp))
                    .border(DocsTheme.hairline, DocsTheme.line, RoundedCornerShape(12.dp))
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                kind.language?.let {
                    Text(it.uppercase(), style = DocsTheme.body(11, FontWeight.SemiBold, DocsTheme.muted).copy(letterSpacing = 0.5.sp))
                }
                Text(
                    block.plainText,
                    style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp, color = DocsTheme.ink),
                    softWrap = false,
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                )
            }
        is BlockKind.Image -> ImageBlock(kind, model, indent.padding(vertical = 8.dp))
        BlockKind.Divider ->
            Box(
                indent
                    .padding(vertical = 14.dp)
                    .fillMaxWidth()
                    .height(DocsTheme.hairline)
                    .background(DocsTheme.lineStrong),
            )
        is BlockKind.Unsupported ->
            Box(
                indent
                    .padding(vertical = 6.dp)
                    .fillMaxWidth()
                    .dashed(10.dp)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text("This block needs a newer version of Mero Docs.", style = DocsTheme.body(14, color = DocsTheme.muted))
            }
    }
}

@Composable
private fun ListItem(
    block: DocBlock,
    marker: String,
    modifier: Modifier,
    onLink: (String) -> Unit,
) {
    Row(modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
        Text(
            marker,
            style = DocsTheme.body(17, if (marker.length == 1) FontWeight.Bold else FontWeight.Normal, DocsTheme.ink2),
            textAlign = TextAlign.End,
            modifier = Modifier.widthIn(min = 16.dp),
        )
        Spacer(Modifier.width(10.dp))
        RichText(block, 17, onLink = onLink)
    }
}

@Suppress("LongParameterList")
@Composable
private fun RichText(
    block: DocBlock,
    size: Int,
    weight: FontWeight = FontWeight.Normal,
    color: Color = DocsTheme.ink,
    strike: Boolean = false,
    alpha: Float = 1f,
    onLink: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val align =
        when (block.alignment) {
            BlockAlignment.CENTER -> TextAlign.Center
            BlockAlignment.RIGHT -> TextAlign.End
            BlockAlignment.JUSTIFY -> TextAlign.Justify
            BlockAlignment.LEFT -> TextAlign.Start
        }
    val background = block.backgroundColor?.let { BlockNoteColors.background[it] }?.let { Color(0xFF000000 or it) } ?: Color.Transparent
    Text(
        annotated(block, size, weight, color, onLink),
        style =
            TextStyle(
                fontSize = size.sp,
                lineHeight = (size * 1.4f).sp,
                fontWeight = weight,
                color = color.copy(alpha = alpha),
                textAlign = align,
                textDecoration = if (strike) TextDecoration.LineThrough else null,
            ),
        modifier =
            modifier
                .fillMaxWidth()
                .background(background, RoundedCornerShape(6.dp))
                .padding(horizontal = if (block.backgroundColor == null) 0.dp else 6.dp),
    )
}

/** Runs as an annotated string: marks, links in the accent ink, colours. (Swift `RichText`.) */
private fun annotated(
    block: DocBlock,
    size: Int,
    weight: FontWeight,
    base: Color,
    onLink: (String) -> Unit,
): AnnotatedString =
    buildAnnotatedString {
        val blockColor = block.textColor?.let { BlockNoteColors.text[it] }?.let { Color(0xFF000000 or it) }
        for (run in block.runs) {
            val decorations =
                listOfNotNull(if (run.underline) TextDecoration.Underline else null, if (run.strike) TextDecoration.LineThrough else null)
            val style =
                SpanStyle(
                    color = run.textColor?.let { BlockNoteColors.text[it] }?.let { Color(0xFF000000 or it) } ?: blockColor ?: base,
                    background =
                        when {
                            run.code -> DocsTheme.codeGround
                            else -> run.backgroundColor?.let { BlockNoteColors.background[it] }?.let { Color(0xFF000000 or it) } ?: Color.Unspecified
                        },
                    fontWeight = if (run.bold) (if (weight == FontWeight.Normal) FontWeight.SemiBold else FontWeight.Bold) else weight,
                    fontStyle = if (run.italic) FontStyle.Italic else FontStyle.Normal,
                    fontFamily = if (run.code) FontFamily.Monospace else null,
                    fontSize = if (run.code) (size * 0.88f).sp else size.sp,
                    textDecoration = if (decorations.isEmpty()) null else TextDecoration.combine(decorations),
                )
            val href = run.link
            if (href == null) {
                withStyle(style) { append(run.text) }
            } else {
                val mention = DocsFormat.linkTarget(href) is LinkTarget.Member
                val linkStyle =
                    style.copy(
                        color = DocsTheme.link,
                        fontWeight = if (mention) FontWeight.SemiBold else style.fontWeight,
                        textDecoration = if (mention) null else TextDecoration.Underline,
                    )
                withLink(LinkAnnotation.Clickable(href, TextLinkStyles(linkStyle)) { onLink(href) }) { append(run.text) }
            }
        }
    }

/** An image block: the picture from its blob, or why it is not shown. */
@Composable
private fun ImageBlock(
    image: BlockKind.Image,
    model: DocumentModel,
    modifier: Modifier,
) {
    val images by model.images.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(image.blobId) { image.blobId?.let { model.loadImage(it) } }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val blobId = image.blobId
        val state = blobId?.let { images[it] }
        when {
            blobId == null -> ImageNotice("Image unavailable", "This image can't be shown.")
            state is DocumentModel.ImageState.Loaded -> {
                val bitmap = remember(state) { BitmapFactory.decodeByteArray(state.bytes, 0, state.bytes.size)?.asImageBitmap() }
                if (bitmap != null) {
                    Image(
                        bitmap,
                        contentDescription = image.name.ifEmpty { "Image" },
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.then(image.width?.let { Modifier.widthIn(max = it.dp) } ?: Modifier.fillMaxWidth()).clip(RoundedCornerShape(12.dp)),
                    )
                } else {
                    ImageNotice("Image unavailable", "This image can't be shown.")
                }
            }
            state == DocumentModel.ImageState.Unavailable ->
                ImageNotice("Image unavailable", "The member who added it may be offline.") { scope.launch { model.loadImage(blobId, retry = true) } }
            else -> ImageNotice("Loading image…", null, loading = true)
        }
        if (image.caption.isNotEmpty()) Text(image.caption, style = DocsTheme.body(14, color = DocsTheme.muted))
    }
}

@Composable
private fun ImageNotice(
    title: String,
    body: String?,
    loading: Boolean = false,
    retry: (() -> Unit)? = null,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 160.dp)
            .dashed(12.dp)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
    ) {
        if (loading) {
            CircularProgressIndicator(color = DocsTheme.muted, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
            Icon(Icons.Outlined.HideImage, contentDescription = null, tint = DocsTheme.muted, modifier = Modifier.size(22.dp))
        }
        Text(title, style = DocsTheme.body(14, FontWeight.Medium, DocsTheme.ink))
        body?.let { Text(it, style = DocsTheme.body(12, color = DocsTheme.muted), textAlign = TextAlign.Center) }
        retry?.let { SecondaryButton(onClick = it, fullWidth = false, modifier = Modifier.padding(top = 4.dp)) { Text("Try again") } }
    }
}

/** A sunken box with a dashed hairline, for notices in place of a block. */
private fun Modifier.dashed(radius: Dp): Modifier =
    this
        .background(DocsTheme.sunken.copy(alpha = 0.5f), RoundedCornerShape(radius))
        .drawBehind {
            val r = radius.toPx()
            drawRoundRect(
                color = DocsTheme.lineStrong,
                cornerRadius = CornerRadius(r, r),
                style = Stroke(width = 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 3.dp.toPx()))),
            )
        }

private fun copyToClipboard(
    context: Context,
    text: String,
) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Mero Docs", text))
}
