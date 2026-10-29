package network.calimero.updates.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Archive
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.SettingsModel
import network.calimero.updates.core.Catalog
import network.calimero.updates.core.Format
import network.calimero.updates.core.Limits
import network.calimero.updates.generated.CategoryView

/** Team only: how the company appears to investors, and how updates are filed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    audience: AudienceModel,
    onClose: () -> Unit,
) {
    val model = remember(audience) { SettingsModel(audience) }
    val companyName by model.companyName.collectAsState()
    val cadence by model.cadenceDays.collectAsState()
    val loaded by model.hasLoaded.collectAsState()
    val saving by model.isSaving.collectAsState()
    val saved by model.saved.collectAsState()
    val error by model.error.collectAsState()
    val categories by audience.categories.collectAsState()
    val scope = rememberCoroutineScope()
    var cadenceMenu by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<CategoryView?>(null) }
    var archive by remember { mutableStateOf<CategoryView?>(null) }

    LaunchedEffect(model) { model.load() }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.SemiBold, fontSize = 17.sp) },
                navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, contentDescription = "Done") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
            )
        },
    ) { padding ->
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize().padding(padding)) {
            item { SectionLabel("Company") }
            item {
                UpdatesCard {
                    InputField(companyName, { model.companyName.value = it }, "Acme Inc.", maxLength = Limits.COMPANY_NAME)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Update cadence", fontSize = 16.sp, modifier = Modifier.weight(1f))
                        Box {
                            Chip(Catalog.cadences.firstOrNull { it.days == cadence }?.label ?: "$cadence days", onClick = { cadenceMenu = true })
                            DropdownMenu(expanded = cadenceMenu, onDismissRequest = { cadenceMenu = false }) {
                                Catalog.cadences.forEach { c ->
                                    DropdownMenuItem(text = { Text(c.label) }, onClick = {
                                        cadenceMenu = false
                                        model.cadenceDays.value = c.days
                                    })
                                }
                            }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PrimaryButton(if (saving) "Saving…" else "Save", onClick = { scope.launch { model.save() } }, enabled = loaded, busy = saving, compact = true)
                        if (saved && !saving) {
                            Spacer(Modifier.width(12.dp))
                            Icon(Icons.Outlined.Check, contentDescription = null, tint = Palette.good, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Saved", color = Palette.good, fontSize = 14.sp)
                        }
                    }
                }
            }
            item {
                Text(
                    "The name is shown at the top of every update. The cadence drives the “next update due” reminder on the team's home screen. Regular beats long: investors trust the founder who writes every month, good news or not.",
                    color = Palette.ink2,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
            item { SectionLabel("Categories") }
            item {
                UpdatesCard(padding = 8.dp) {
                    categories.forEach { c -> CategoryRow(c, onEdit = { editing = c }, onArchive = { archive = c }) }
                    if (categories.isNotEmpty()) HorizontalDivider(color = Palette.hairline)
                    LinkButton("New category", color = Palette.ink, onClick = { adding = true })
                    if (categories.isEmpty()) {
                        SecondaryButton(
                            "Add starter set (Monthly, Fundraising, Product, Hiring, Board)",
                            onClick = { scope.launch { model.addStarters() } },
                            icon = Icons.Outlined.AutoAwesome,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            item {
                Text(
                    "File every update under one. Investors filter by category and can mute the ones they don't need.",
                    color = Palette.ink2,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
            if (error != null) item { UpdatesCard { ErrorLine(error) } }
        }
    }

    if (adding) {
        CategorySheet("New category", null, onDismiss = { adding = false }) { name, emoji, color -> model.createCategory(name, emoji, color) }
    }
    editing?.let { c ->
        CategorySheet("Edit category", c, onDismiss = { editing = null }) { name, emoji, color -> model.editCategory(c.id, name, emoji, color) }
    }
    archive?.let { c ->
        AlertDialog(
            onDismissRequest = { archive = null },
            title = { Text("Archive ${c.name}?") },
            text = { Text("Archiving is permanent. Existing updates keep the label.") },
            confirmButton = {
                LinkButton("Archive", color = Palette.danger, onClick = {
                    archive = null
                    scope.launch { model.archiveCategory(c.id) }
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { archive = null }) },
            containerColor = Palette.surface,
        )
    }
}

@Composable
private fun CategoryRow(
    category: CategoryView,
    onEdit: () -> Unit,
    onArchive: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CategoryChip(category)
        Spacer(Modifier.weight(1f))
        Text(Format.plural(category.updateCount, "update"), color = Palette.ink2, fontSize = 13.sp)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, contentDescription = "Category actions", tint = Palette.ink2) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Outlined.Edit, contentDescription = null) }, onClick = {
                    menu = false
                    onEdit()
                })
                DropdownMenuItem(
                    text = { Text("Archive", color = Palette.danger) },
                    leadingIcon = { Icon(Icons.Outlined.Archive, contentDescription = null, tint = Palette.danger) },
                    onClick = {
                        menu = false
                        onArchive()
                    },
                )
            }
        }
    }
}

/** Name, emoji and colour for a category. */
@Composable
private fun CategorySheet(
    title: String,
    initial: CategoryView?,
    onDismiss: () -> Unit,
    save: suspend (String, String, String) -> Boolean,
) {
    var name by remember { mutableStateOf(initial?.name.orEmpty()) }
    var emoji by remember { mutableStateOf(initial?.emoji.orEmpty()) }
    var color by remember { mutableStateOf(initial?.color?.ifEmpty { null } ?: Catalog.categoryColors.first()) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    UpdatesSheet(title, onDismiss) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            InputField(emoji, { emoji = it }, "Emoji", maxLength = Limits.EMOJI, modifier = Modifier.width(96.dp))
            InputField(name, { name = it }, "Category name", maxLength = Limits.CATEGORY_NAME, modifier = Modifier.weight(1f))
        }
        Text("Colour", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Catalog.categoryColors.forEach { swatch ->
                Box(
                    Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .then(if (color == swatch) Modifier.border(2.5.dp, Palette.ink, CircleShape) else Modifier)
                        .clickable { color = swatch }
                        .padding(4.dp),
                ) {
                    Box(Modifier.fillMaxSize().clip(CircleShape).background(cssColor(swatch)))
                }
            }
        }
        Column {
            PrimaryButton(
                if (saving) {
                    "Saving…"
                } else if (initial == null) {
                    "Add"
                } else {
                    "Save"
                },
                onClick = {
                    saving = true
                    scope.launch {
                        val ok = save(name, emoji, color)
                        saving = false
                        if (ok) onDismiss()
                    }
                },
                enabled = name.isNotBlank(),
                busy = saving,
                icon = if (initial == null) Icons.Outlined.Add else null,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
