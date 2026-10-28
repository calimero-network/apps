package network.calimero.crm.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.PersonSearch
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.crm.app.Notice
import network.calimero.crm.core.Company
import network.calimero.crm.core.ContactDraft
import network.calimero.crm.core.DealDraft
import network.calimero.crm.core.Insights
import network.calimero.crm.core.Money
import network.calimero.crm.generated.ContactView

/** The address book: people, and the companies their organizations make. */
@Composable
fun PeopleScreen() {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    var companiesMode by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }

    Screen(
        "People",
        large = true,
        actions = { IconButton(onClick = { creating = true }) { Icon(Icons.Outlined.PersonAdd, contentDescription = "New person") } },
    ) {
        LoadGate {
            val companies = model.companies()
            Refreshable {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { SearchBox(query, { query = it }, if (companiesMode) "Search companies" else "Search people") }
                    item {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Chip("People", selected = !companiesMode, count = state.contacts.size) { companiesMode = false }
                            Chip("Companies", selected = companiesMode, count = companies.size) { companiesMode = true }
                        }
                    }
                    if (!companiesMode) {
                        val rows = state.contacts.filter { Insights.contactMatches(it, query) }
                        if (rows.isEmpty()) {
                            item {
                                EmptyState(Icons.Outlined.People, if (query.isEmpty()) "No people yet" else "Nobody matches “$query”", "Add the people you sell to, then link them to deals.")
                            }
                        }
                        items(rows, key = { it.id }) { c -> CrmCard(padding = 12.dp) { ContactRow(c) } }
                    } else {
                        val rows = companies.filter { Insights.companyMatches(it, query) }
                        if (rows.isEmpty()) {
                            item {
                                EmptyState(
                                    Icons.Outlined.Business,
                                    if (query.isEmpty()) "No companies yet" else "No company matches “$query”",
                                    "Companies appear here from the organization on people and deals.",
                                )
                            }
                        }
                        items(rows, key = { it.id }) { company -> CrmCard(padding = 12.dp) { CompanyRow(company) } }
                    }
                }
            }
        }
    }
    if (creating) ContactEditorSheet(onDismiss = { creating = false })
}

@Composable
private fun CompanyRow(company: Company) {
    val model = LocalModel.current
    val nav = LocalNav.current
    Row(Modifier.fillMaxWidth().clickable { nav.push(Route.Company(company.id)) }, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(9.dp)).background(Palette.limeSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Business, contentDescription = null, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(company.name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(
                "${company.people.size} ${if (company.people.size == 1) "person" else "people"} · ${company.openDeals.size} open",
                fontSize = 13.sp,
                color = Palette.ink2,
            )
        }
        if (company.openValue > 0uL) Text(Money.format(company.openValue, model.currency, compact = true), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

@Composable
fun ContactRow(contact: ContactView) {
    val model = LocalModel.current
    val nav = LocalNav.current
    Row(Modifier.fillMaxWidth().clickable { nav.push(Route.Contact(contact.id)) }, verticalAlignment = Alignment.CenterVertically) {
        Avatar(contact.name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(contact.name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            val sub = listOf(contact.jobTitle, contact.organization).filter { it.isNotEmpty() }.joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, fontSize = 13.sp, color = Palette.ink2, maxLines = 1)
        }
        Column(horizontalAlignment = Alignment.End) {
            if (contact.openDeals > 0u) Text("${contact.openDeals} open", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            if (contact.wonValue > 0uL) Text("${Money.format(contact.wonValue, model.currency, compact = true)} won", fontSize = 12.sp, color = Palette.good)
        }
    }
}

/** One person: how to reach them, their deals and what is scheduled with them. */
@Composable
fun ContactDetailScreen(contactId: String) {
    val model = LocalModel.current
    val nav = LocalNav.current
    val platform = LocalPlatform.current
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var newDeal by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val c = state.contacts.firstOrNull { it.id == contactId }

    Screen(
        c?.name ?: "Person",
        back = true,
        actions = {
            if (c != null) {
                Box {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreHoriz, contentDescription = "Person actions") }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = {
                            menu = false
                            editing = true
                        })
                        if (model.isMe(c.createdBy)) {
                            DropdownMenuItem(
                                text = { Text("Delete person", color = Palette.danger) },
                                leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = Palette.danger) },
                                onClick = {
                                    menu = false
                                    confirmDelete = true
                                },
                            )
                        }
                    }
                }
            }
        },
    ) {
        if (c == null) {
            Column(Modifier.padding(16.dp)) { CrmCard { EmptyState(Icons.Outlined.PersonSearch, "This person no longer exists") } }
        } else {
            val deals = state.deals.filter { it.contactId == c.id }.sortedByDescending { it.createdAt }
            val todos = state.activities.filter { it.contactId == c.id && !it.done }.sortedBy { it.dueAt }
            Refreshable {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(c.name, size = 56.dp)
                            Spacer(Modifier.width(14.dp))
                            Column {
                                Text(c.name, fontWeight = FontWeight.Bold, fontSize = 24.sp)
                                val sub = listOf(c.jobTitle, c.organization).filter { it.isNotEmpty() }.joinToString(" at ")
                                if (sub.isNotEmpty()) Text(sub, fontSize = 15.sp, color = Palette.ink2)
                            }
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (c.email.isNotEmpty()) SecondaryButton("Email", onClick = { platform.open("mailto:${c.email}") }, icon = Icons.Outlined.Email, compact = true, modifier = Modifier.weight(1f))
                            if (c.phone.isNotEmpty()) {
                                SecondaryButton("Call", onClick = { platform.open("tel:${c.phone.filter { !it.isWhitespace() }}") }, icon = Icons.Outlined.Phone, compact = true, modifier = Modifier.weight(1f))
                            }
                            SecondaryButton("Deal", onClick = { newDeal = true }, icon = Icons.Outlined.Add, compact = true, enabled = state.stages.isNotEmpty(), modifier = Modifier.weight(1f))
                        }
                    }
                    item {
                        CrmCard {
                            CardTitle("Contact")
                            InfoRow("Email", c.email.ifEmpty { "—" })
                            InfoRow("Phone", c.phone.ifEmpty { "—" })
                            InfoRow("Organization", c.organization.ifEmpty { "—" })
                            InfoRow("Job title", c.jobTitle.ifEmpty { "—" })
                            InfoRow("Open deals", "${c.openDeals}")
                            InfoRow("Won", if (c.wonValue > 0uL) Money.format(c.wonValue, model.currency) else "—")
                        }
                    }
                    item {
                        CrmCard {
                            CardTitle("Deals", trailing = "${deals.size}")
                            if (deals.isEmpty()) Text("No deals with ${c.name} yet.", fontSize = 15.sp, color = Palette.ink2)
                            deals.forEachIndexed { i, d ->
                                DealRow(d)
                                if (i < deals.lastIndex) Divider()
                            }
                        }
                    }
                    if (todos.isNotEmpty()) {
                        item {
                            CrmCard {
                                CardTitle("Scheduled", trailing = "${todos.size} open")
                                todos.forEachIndexed { i, a ->
                                    ActivityRow(a, showDeal = true)
                                    if (i < todos.lastIndex) Divider()
                                }
                            }
                        }
                    }
                    item {
                        DetailsDisclosure(listOf("Person id" to c.id, "Created by" to c.createdBy)) {
                            platform.copy("Value", it)
                            model.notice.value = Notice("Copied")
                        }
                    }
                }
            }
        }
    }
    if (c != null) {
        if (editing) ContactEditorSheet(editing = c, onDismiss = { editing = false })
        if (newDeal) DealEditorSheet(initial = DealDraft(contactId = c.id, organization = c.organization), onDismiss = { newDeal = false })
        if (confirmDelete) {
            AlertDialog(
                onDismissRequest = { confirmDelete = false },
                text = { Text("Delete ${c.name}? Their deals stay, without a contact person.") },
                confirmButton = {
                    LinkButton("Delete person", color = Palette.danger, onClick = {
                        confirmDelete = false
                        scope.launch { if (model.deleteContact(c)) nav.pop() }
                    })
                },
                dismissButton = { LinkButton("Cancel", onClick = { confirmDelete = false }) },
            )
        }
    }
}

/** A company: its people and deals, and what they are worth. */
@Composable
fun CompanyDetailScreen(key: String) {
    val model = LocalModel.current
    val state by model.state.collectAsState()
    var newDeal by remember { mutableStateOf(false) }
    var newPerson by remember { mutableStateOf(false) }
    val company = remember(state.version, key) { model.companies().firstOrNull { it.id == key } }

    Screen(company?.name ?: "Company", back = true) {
        if (company == null) {
            Column(Modifier.padding(16.dp)) { CrmCard { EmptyState(Icons.Outlined.Business, "Nothing here any more") } }
        } else {
            Refreshable {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(Palette.limeSoft), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Business, contentDescription = null, modifier = Modifier.size(26.dp))
                            }
                            Spacer(Modifier.width(14.dp))
                            Text(company.name, fontWeight = FontWeight.Bold, fontSize = 24.sp)
                        }
                    }
                    item {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            StatPill(Money.format(company.openValue, model.currency), "open")
                            StatPill(Money.format(company.wonValue, model.currency), "won")
                            StatPill("${company.people.size}", if (company.people.size == 1) "person" else "people")
                        }
                    }
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SecondaryButton("Deal", onClick = { newDeal = true }, icon = Icons.Outlined.Add, compact = true, enabled = state.stages.isNotEmpty(), modifier = Modifier.weight(1f))
                            SecondaryButton("Person", onClick = { newPerson = true }, icon = Icons.Outlined.PersonAdd, compact = true, modifier = Modifier.weight(1f))
                        }
                    }
                    item {
                        CrmCard {
                            CardTitle("People", trailing = "${company.people.size}")
                            if (company.people.isEmpty()) Text("Nobody at ${company.name} yet.", fontSize = 15.sp, color = Palette.ink2)
                            company.people.forEachIndexed { i, c ->
                                ContactRow(c)
                                if (i < company.people.lastIndex) Divider()
                            }
                        }
                    }
                    item {
                        CrmCard {
                            CardTitle("Deals", trailing = "${company.deals.size}")
                            if (company.deals.isEmpty()) Text("No deals with ${company.name} yet.", fontSize = 15.sp, color = Palette.ink2)
                            company.deals.forEachIndexed { i, d ->
                                DealRow(d)
                                if (i < company.deals.lastIndex) Divider()
                            }
                        }
                    }
                }
            }
        }
    }
    if (newDeal) DealEditorSheet(initial = DealDraft(organization = company?.name.orEmpty()), onDismiss = { newDeal = false })
    if (newPerson) ContactEditorSheet(organization = company?.name.orEmpty(), onDismiss = { newPerson = false })
}

/** New person, or edit one. */
@Composable
fun ContactEditorSheet(
    editing: ContactView? = null,
    organization: String = "",
    onDismiss: () -> Unit,
) {
    val model = LocalModel.current
    val scope = rememberCoroutineScope()
    var draft by remember { mutableStateOf(editing?.let { ContactDraft.of(it) } ?: ContactDraft(organization = organization)) }
    var busy by remember { mutableStateOf(false) }
    CrmSheet(
        if (editing == null) "New person" else "Edit person",
        onDismiss,
        action = if (editing == null) "Add person" else "Save",
        busy = busy,
        enabled = draft.isValid,
        onAction = {
            busy = true
            scope.launch {
                val ok = if (editing == null) model.createContact(draft) != null else model.updateContact(editing.id, draft)
                busy = false
                if (ok) onDismiss()
            }
        },
    ) {
        Field("Name", draft.name, { draft = draft.copy(name = it) }, "Full name", capitalization = KeyboardCapitalization.Words)
        Field("Organization", draft.organization, { draft = draft.copy(organization = it) }, "Company")
        Field("Job title", draft.jobTitle, { draft = draft.copy(jobTitle = it) }, "e.g. Head of Operations")
        Field("Email", draft.email, { draft = draft.copy(email = it) }, "name@company.com", keyboard = KeyboardType.Email, capitalization = KeyboardCapitalization.None)
        Field("Phone", draft.phone, { draft = draft.copy(phone = it) }, "+1 555 0100", keyboard = KeyboardType.Phone, capitalization = KeyboardCapitalization.None)
    }
}
