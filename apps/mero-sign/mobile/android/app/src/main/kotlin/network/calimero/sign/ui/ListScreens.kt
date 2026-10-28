package network.calimero.sign.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.AddLink
import androidx.compose.material.icons.outlined.Apartment
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Draw
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderCopy
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PortableWifiOff
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.sign.SignViewModel
import network.calimero.sign.core.AgreementModel
import network.calimero.sign.core.AgreementRow
import network.calimero.sign.core.AgreementsModel
import network.calimero.sign.core.DocumentEntry
import network.calimero.sign.core.InboxBucket
import network.calimero.sign.core.InboxModel
import network.calimero.sign.core.LoadPhase
import network.calimero.sign.core.PersonRow
import network.calimero.sign.core.SignConstants
import network.calimero.sign.core.SignFormat
import network.calimero.sign.generated.PermissionLevel

// ---- shared pieces ---------------------------------------------------------------------------

/** Lime waiting on you, amber waiting on others, green complete. (iOS `StatusPill`.) */
@Composable
fun StatusPill(entry: DocumentEntry) {
    val (text, icon, colors) =
        when (entry.bucket) {
            InboxBucket.TO_SIGN -> Triple("Needs your signature", Icons.Outlined.Draw, Palette.Lime to Palette.Ink)
            InboxBucket.WAITING ->
                Triple(if (entry.iSigned) "You signed" else SignFormat.status(entry.document.status), Icons.Outlined.AccessTime, Palette.WaitSoft to Palette.Wait)
            InboxBucket.COMPLETED -> Triple("Signed", Icons.Outlined.Verified, Palette.GoodSoft to Palette.Good)
        }
    Row(
        Modifier.clip(CircleShape).background(colors.first).padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = colors.second, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(4.dp))
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = colors.second)
    }
}

/** A document in a list. (iOS `DocumentRowView`.) */
@Composable
fun DocumentRow(
    entry: DocumentEntry,
    showAgreement: Boolean = true,
    onClick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(14.dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .size(44.dp, 52.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (entry.isComplete) Palette.GoodSoft else Palette.Sunken),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Description, contentDescription = null, tint = if (entry.isComplete) Palette.Good else Palette.Ink)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(entry.document.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val whenText = SignFormat.whenText(entry.document.uploadedAt)
            Text(if (showAgreement) "${entry.agreement.name} · $whenText" else whenText, fontSize = 13.sp, color = Palette.Muted, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusPill(entry)
                if (!entry.isComplete && entry.progress.second > 0) {
                    Spacer(Modifier.width(8.dp))
                    Text(SignFormat.progress(entry), fontSize = 12.sp, color = Palette.Muted)
                }
            }
        }
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
    }
}

@Composable
fun SectionLabel(
    text: String,
    trailing: String? = null,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
        Text(text.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp, color = Palette.Muted, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Palette.Muted)
    }
}

@Composable
fun NoRelayBanner() {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Palette.WaitSoft)
            .padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(Icons.Outlined.PortableWifiOff, contentDescription = null, tint = Palette.Wait)
        Spacer(Modifier.width(10.dp))
        Text("No relay serves your account yet. Open an invitation link you were sent to get one.", fontSize = 14.sp, color = Palette.Ink)
    }
}

@Composable
fun Loading() =
    Box(Modifier.fillMaxWidth().padding(top = 60.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Palette.Ink)
    }

/** A card of rows with hairlines between them. */
@Composable
fun <T> CardList(
    items: List<T>,
    inset: Int = 72,
    row: @Composable (T) -> Unit,
) {
    Card {
        Column {
            items.forEachIndexed { index, item ->
                row(item)
                if (index < items.size - 1) Hairline(Modifier.padding(start = inset.dp))
            }
        }
    }
}

/** A scrolling screen with pull-to-refresh. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshingColumn(
    refresh: suspend () -> Unit,
    content: @Composable () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            scope.launch {
                refreshing = true
                refresh()
                refreshing = false
            }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) { content() }
    }
}

// ---- Inbox -----------------------------------------------------------------------------------

/** Every document across your agreements: To sign, Waiting, Completed. (iOS `InboxScreen`.) */
@Composable
fun InboxScreen(
    model: InboxModel,
    vm: SignViewModel,
    push: (Route) -> Unit,
    openInvitation: () -> Unit,
) {
    val phase by model.phase.collectAsState()
    val entries by model.entries.collectAsState()
    val unopened by model.unopened.collectAsState()
    val syncing by model.syncing.collectAsState()
    val bucket by model.bucket.collectAsState()
    val opening by model.opening.collectAsState()
    val notice by model.notice.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(model) { model.load() }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar("Inbox") { AccountMenu(vm, openInvitation) }
        NoticeBanner(notice) { model.notice.value = null }
        RefreshingColumn({ model.load() }) {
            if (!model.hasRelay) NoRelayBanner()
            BucketPicker(bucket, { model.bucket.value = it }) { b -> entries.count { it.bucket == b } }
            when (val p = phase) {
                LoadPhase.Loading -> Loading()
                is LoadPhase.Failed -> ErrorState(p.message) { scope.launch { model.load() } }
                LoadPhase.Loaded -> {
                    if (bucket == InboxBucket.TO_SIGN && unopened.isNotEmpty()) {
                        SectionLabel("New agreements")
                        CardList(unopened, inset = 66) { agreement ->
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Avatar(agreement.name, agreement.contextId, 40.dp, square = true, icon = Icons.Outlined.Folder)
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(agreement.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                                    Text(agreement.workspaceName, fontSize = 13.sp, color = Palette.Muted)
                                }
                                PrimaryButton("Open", { scope.launch { model.open(agreement) } }, compact = true, busy = opening == agreement.contextId, enabled = opening == null)
                            }
                        }
                    }
                    if (syncing.isNotEmpty()) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
                            CircularProgressIndicator(Modifier.size(14.dp), color = Palette.InkSoft, strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(
                                if (syncing.size == 1) "“${syncing[0].name}” is still syncing to your account." else "${syncing.size} agreements are still syncing to your account.",
                                fontSize = 14.sp,
                                color = Palette.InkSoft,
                            )
                        }
                    }
                    val list = model.entries(bucket)
                    if (list.isEmpty()) {
                        when (bucket) {
                            InboxBucket.TO_SIGN ->
                                EmptyState(
                                    Icons.Outlined.CheckCircle,
                                    "Nothing to sign",
                                    "When someone sends you an agreement, the documents waiting on your signature show up here.",
                                    action = "Open an invitation link",
                                    onAction = openInvitation,
                                )
                            InboxBucket.WAITING -> EmptyState(Icons.Outlined.AccessTime, "Nothing waiting", "Documents you signed that still need other signatures show up here.")
                            InboxBucket.COMPLETED -> EmptyState(Icons.Outlined.Verified, "No completed documents", "Once everyone has signed, the final signed version shows up here.")
                        }
                    } else {
                        CardList(list) { entry -> DocumentRow(entry) { push(Route.Document(entry.agreement, entry.document.id)) } }
                    }
                }
            }
        }
    }
}

/** To sign / Waiting / Completed, with counts. Lime marks the selected one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BucketPicker(
    selection: InboxBucket,
    select: (InboxBucket) -> Unit,
    count: (InboxBucket) -> Int,
) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        InboxBucket.entries.forEachIndexed { index, bucket ->
            val n = count(bucket)
            SegmentedButton(
                selected = bucket == selection,
                onClick = { select(bucket) },
                shape = SegmentedButtonDefaults.itemShape(index, InboxBucket.entries.size),
                icon = {},
                colors =
                    SegmentedButtonDefaults.colors(
                        activeContainerColor = Palette.Lime,
                        activeContentColor = Palette.Ink,
                        inactiveContainerColor = Palette.Surface,
                        inactiveContentColor = Palette.Ink,
                        activeBorderColor = Palette.Hairline,
                        inactiveBorderColor = Palette.Hairline,
                    ),
            ) {
                Text(if (n > 0) "${bucket.title} $n" else bucket.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

// ---- Agreements --------------------------------------------------------------------------------

/** Your workspaces and the agreements in each. (iOS `AgreementsScreen`.) */
@Composable
fun AgreementsScreen(
    model: AgreementsModel,
    push: (Route) -> Unit,
    openInvitation: () -> Unit,
) {
    val phase by model.phase.collectAsState()
    val sections by model.sections.collectAsState()
    val opening by model.opening.collectAsState()
    val notice by model.notice.collectAsState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(model) { model.load() }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar("Agreements") {
            IconButton(onClick = openInvitation) { Icon(Icons.Outlined.AddLink, contentDescription = "Open an invitation link", tint = Palette.Ink) }
        }
        NoticeBanner(notice) { model.notice.value = null }
        RefreshingColumn({ model.load() }) {
            if (!model.hasRelay) NoRelayBanner()
            when (val p = phase) {
                LoadPhase.Loading -> Loading()
                is LoadPhase.Failed -> ErrorState(p.message) { scope.launch { model.load() } }
                LoadPhase.Loaded ->
                    if (sections.isEmpty()) {
                        EmptyState(
                            Icons.Outlined.Folder,
                            "No agreements yet",
                            "Agreements are created and shared from Mero Sign on the web. Open the invitation link you were sent to join one.",
                            action = "Open an invitation link",
                            onAction = openInvitation,
                        )
                    } else {
                        sections.forEach { section ->
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                SectionLabel(section.name, "${section.agreements.size}")
                                if (section.agreements.isEmpty()) {
                                    Card { Text("No agreements in this workspace yet.", fontSize = 14.sp, color = Palette.Muted, modifier = Modifier.padding(14.dp)) }
                                } else {
                                    CardList(section.agreements, inset = 66) { row ->
                                        AgreementRowView(row, busy = opening == row.agreement.contextId, enabled = opening == null) {
                                            scope.launch { if (model.prepare(row)) push(Route.Agreement(row.agreement)) }
                                        }
                                    }
                                }
                            }
                        }
                    }
            }
        }
    }
}

@Composable
private fun AgreementRowView(
    row: AgreementRow,
    busy: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(row.agreement.name, row.agreement.contextId, 40.dp, square = true, icon = Icons.Outlined.FolderCopy)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(row.agreement.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
            Text(if (row.joined) "Open" else "Not opened yet — tap to join", fontSize = 13.sp, color = Palette.Muted)
        }
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), color = Palette.Ink, strokeWidth = 2.dp)
        } else {
            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = Palette.Muted)
        }
    }
}

/** One agreement: its documents and the people in it. (iOS `AgreementScreen`.) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgreementScreen(
    model: AgreementModel,
    back: () -> Unit,
    push: (Route) -> Unit,
) {
    val agreement by model.agreement.collectAsState()
    val snapshot by model.snapshot.collectAsState()
    val people by model.people.collectAsState()
    val phase by model.phase.collectAsState()
    val syncing by model.isSyncing.collectAsState()
    var tab by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(model) { model.load() }
    LaunchedEffect(syncing) {
        while (syncing) {
            delay(SignConstants.POLL_INTERVAL_MS)
            model.load()
        }
    }

    Column(Modifier.fillMaxSize().background(Palette.Ground)) {
        TopBar(agreement.name, back = back)
        RefreshingColumn({ model.load() }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(Palette.Lime), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Draw, contentDescription = null, tint = Palette.Ink)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(agreement.name, fontFamily = Display, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, color = Palette.Ink)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MetaChip(Icons.Outlined.Apartment, agreement.workspaceName)
                        snapshot?.let {
                            MetaChip(Icons.Outlined.People, "${it.details.participants.size}")
                            MetaChip(Icons.Outlined.Description, "${it.documents.size}")
                        }
                    }
                }
            }
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                listOf("Documents", "People").forEachIndexed { index, label ->
                    SegmentedButton(
                        selected = tab == index,
                        onClick = { tab = index },
                        shape = SegmentedButtonDefaults.itemShape(index, 2),
                        icon = {},
                        colors =
                            SegmentedButtonDefaults.colors(
                                activeContainerColor = Palette.Lime,
                                activeContentColor = Palette.Ink,
                                inactiveContainerColor = Palette.Surface,
                                inactiveContentColor = Palette.Ink,
                                activeBorderColor = Palette.Hairline,
                                inactiveBorderColor = Palette.Hairline,
                            ),
                    ) { Text(label, fontWeight = FontWeight.SemiBold) }
                }
            }
            when (val p = phase) {
                LoadPhase.Loading -> Loading()
                is LoadPhase.Failed -> ErrorState(p.message) { scope.launch { model.load() } }
                LoadPhase.Loaded ->
                    if (tab == 0) {
                        val documents = model.documents
                        when {
                            syncing && snapshot == null ->
                                EmptyState(Icons.Outlined.Sync, "Syncing", "This agreement is still reaching your account. It opens on its own once it arrives.")
                            documents.isEmpty() ->
                                EmptyState(Icons.Outlined.Description, "No documents yet", "Documents are uploaded from Mero Sign on the web. They appear here for you to sign.")
                            else -> CardList(documents) { entry -> DocumentRow(entry, showAgreement = false) { push(Route.Document(entry.agreement, entry.document.id)) } }
                        }
                    } else if (people.isEmpty()) {
                        EmptyState(Icons.Outlined.People, "Nobody yet", "People appear here once they join this agreement.")
                    } else {
                        CardList(people, inset = 66) { PersonRowView(it) }
                    }
            }
            Card {
                Column(Modifier.padding(horizontal = 14.dp)) {
                    DetailsDisclosure(
                        listOf(
                            "Agreement context" to agreement.contextId,
                            "Agreement group" to agreement.agreementId,
                            "Workspace" to agreement.namespaceId,
                            "Your account" to (snapshot?.me ?: ""),
                        ).filter { it.second.isNotEmpty() },
                    )
                }
            }
        }
    }
}

@Composable
private fun MetaChip(
    icon: ImageVector,
    text: String,
) {
    Icon(icon, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(14.dp))
    Spacer(Modifier.width(3.dp))
    Text(text, fontSize = 13.sp, color = Palette.Muted)
    Spacer(Modifier.width(10.dp))
}

@Composable
private fun PersonRowView(person: PersonRow) {
    val (level, description) = SignFormat.level(person.level)
    Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.Top) {
        Avatar(person.name ?: "", person.account, 40.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row {
                Text(person.displayName, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Palette.Ink)
                if (person.isMe) Text("  (you)", fontSize = 14.sp, color = Palette.Muted)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Badge(level, strong = person.level == PermissionLevel.Admin)
                Spacer(Modifier.width(6.dp))
                Text(description, fontSize = 13.sp, color = Palette.Muted, maxLines = 2)
            }
        }
    }
}
