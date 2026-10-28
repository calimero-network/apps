package network.calimero.updates.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.core.AskKind
import network.calimero.updates.core.ErrorText
import network.calimero.updates.core.Format
import network.calimero.updates.core.People
import network.calimero.updates.generated.AskView
import network.calimero.updates.generated.OfferView

/** One ask: what is asked, and either the investor's "I can help" or the team's triage of the offers. */
@Composable
fun AskCard(
    ask: AskView,
    audience: AudienceModel,
    isTeam: Boolean,
    onOpenPost: ((String) -> Unit)? = null,
) {
    var offering by remember(ask.id) { mutableStateOf(false) }
    var note by remember(ask.id) { mutableStateOf("") }
    var busy by remember(ask.id) { mutableStateOf<String?>(null) }
    var error by remember(ask.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val isOpen = ask.status == "open"

    fun run(
        key: String,
        body: suspend () -> Unit,
    ) {
        busy = key
        error = null
        scope.launch {
            try {
                body()
            } catch (e: Exception) {
                error = ErrorText.describe(e)
            } finally {
                busy = null
            }
        }
    }

    UpdatesCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Glyphs.askKind(ask.kind), contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
            Text(AskKind.of(ask.kind).label, color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            if (!isOpen) {
                Spacer(Modifier.width(8.dp))
                Badge("Resolved", BadgeTone.GOOD)
            }
            Spacer(Modifier.weight(1f))
            Icon(Icons.Outlined.PanTool, contentDescription = null, tint = if (ask.offerCount > 0uL) Palette.ink else Palette.ink3, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(4.dp))
            Text(
                "${ask.offerCount} offer${if (ask.offerCount == 1uL) "" else "s"}",
                color = if (ask.offerCount > 0uL) Palette.ink else Palette.ink3,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Text(ask.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        if (ask.detail.isNotEmpty()) Text(ask.detail, color = Palette.ink2, fontSize = 15.sp)
        if (onOpenPost != null) {
            Row(
                Modifier.clip(RoundedCornerShape(6.dp)).clickable { onOpenPost(ask.postId) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.AutoMirrored.Outlined.Article, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    "From ${ask.postTitle} · ${Format.timeAgo(ask.createdAt)}",
                    color = Palette.ink2,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        if (isTeam) {
            if (ask.offers.isNotEmpty()) {
                ask.offers.forEach { offer ->
                    OfferRow(offer, enabled = busy == null) { status ->
                        run("offer:${offer.account}") { audience.setOfferStatus(ask.id, offer.account, status) }
                    }
                }
            } else if (isOpen) {
                Text("No offers yet.", color = Palette.ink3, fontSize = 13.sp)
            }
            LinkButton(if (isOpen) "Mark resolved" else "Re-open", enabled = busy == null, onClick = {
                run("status") { audience.setAskStatus(ask.id, isOpen) }
            })
        } else if (isOpen) {
            val mine = ask.myOffer
            when {
                mine != null && !offering -> {
                    Badge(
                        when (mine.status) {
                            "accepted" -> "The team accepted your offer"
                            "declined" -> "The team has this covered — thank you"
                            else -> "You offered to help"
                        },
                        BadgeTone.GOOD,
                        if (mine.status == "declined") null else Icons.Outlined.Check,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        LinkButton("Edit note", onClick = {
                            note = mine.note
                            offering = true
                        })
                        LinkButton("Withdraw", color = Palette.danger, enabled = busy == null, onClick = {
                            run("withdraw") { audience.withdrawOffer(ask.id) }
                        })
                    }
                }
                offering -> {
                    InputField(
                        note,
                        { note = it },
                        "How can you help? e.g. “I know their VP Finance — happy to intro.”",
                        singleLine = false,
                        minLines = 2,
                        maxLines = 5,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
                        SecondaryButton("Cancel", onClick = { offering = false }, compact = true)
                        PrimaryButton(if (busy == "offer") "Sending…" else "Send offer", compact = true, enabled = busy == null, onClick = {
                            run("offer") {
                                audience.offerHelp(ask.id, note)
                                offering = false
                            }
                        })
                    }
                }
                else ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PrimaryButton(
                            if (busy == "offer") "Sending…" else "I can help",
                            icon = Icons.Outlined.PanTool,
                            compact = true,
                            enabled = busy == null,
                            onClick = { run("offer") { audience.offerHelp(ask.id, "") } },
                        )
                        SecondaryButton("Help with a note", compact = true, onClick = {
                            note = ""
                            offering = true
                        })
                    }
            }
        }
        ErrorLine(error)
    }
}

@Composable
private fun OfferRow(
    offer: OfferView,
    enabled: Boolean,
    onStatus: (String) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.background)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(offer.account, offer.name, size = 26.dp)
            Spacer(Modifier.width(8.dp))
            Text(People.label(offer.name, offer.account), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            if (offer.firm.isNotEmpty()) Text(" · ${offer.firm}", color = Palette.ink2, fontSize = 13.sp, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.weight(1f))
            Text(Format.timeAgo(offer.createdAt), color = Palette.ink3, fontSize = 12.sp)
        }
        if (offer.note.isNotEmpty()) Text(offer.note, fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (offer.status == "offered") {
                PrimaryButton("Accept", compact = true, enabled = enabled, onClick = { onStatus("accepted") })
                SecondaryButton("Decline", compact = true, enabled = enabled, onClick = { onStatus("declined") })
            } else {
                Badge(if (offer.status == "accepted") "Accepted" else "Declined", if (offer.status == "accepted") BadgeTone.GOOD else BadgeTone.MUTED)
                LinkButton("Undo", enabled = enabled, onClick = { onStatus("offered") })
            }
        }
    }
}
