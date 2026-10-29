package network.calimero.design.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.design.R
import network.calimero.design.core.DesignFormat

/** The app mark: the web app's icon (a lime curve between two handles). */
@Composable
fun AppMark(size: Dp = 56.dp) {
    Image(
        painter = painterResource(R.mipmap.ic_launcher),
        contentDescription = null,
        modifier = Modifier.size(size).clip(RoundedCornerShape(size * 0.24f)),
    )
}

/** A round initials avatar in the member's colour. */
@Composable
fun Avatar(
    id: String,
    name: String,
    size: Dp = 32.dp,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.size(size).background(DesignTheme.memberColor(id), CircleShape).semantics { contentDescription = name },
        contentAlignment = Alignment.Center,
    ) {
        Text(DesignFormat.initials(name), color = Color.White, fontSize = (size.value * 0.38f).sp, fontWeight = FontWeight.SemiBold)
    }
}

/** An icon, a title, a line of help, and an optional action. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    dark: Boolean = false,
    actionTitle: String? = null,
    action: (() -> Unit)? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(64.dp).background(if (dark) Color.White.copy(alpha = 0.1f) else DesignTheme.sunken, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = if (dark) Color.White.copy(alpha = 0.6f) else DesignTheme.muted, modifier = Modifier.size(30.dp))
        }
        Text(title, style = DesignTheme.heading(18).copy(color = if (dark) Color.White else DesignTheme.ink))
        Text(message, style = DesignTheme.body(15, color = if (dark) Color.White.copy(alpha = 0.6f) else DesignTheme.muted), textAlign = TextAlign.Center)
        if (actionTitle != null && action != null) {
            SecondaryButton(onClick = action, fullWidth = false, modifier = Modifier.padding(top = 4.dp)) { Text(actionTitle) }
        }
    }
}

/** A failure, in words, with a way to try again. */
@Composable
fun ErrorState(
    message: String,
    retry: () -> Unit,
) = EmptyState(Icons.Outlined.WarningAmber, "Something went wrong", message, actionTitle = "Try again", action = retry)

/** Loading placeholder rows. */
@Composable
fun LoadingRows(count: Int = 3) {
    Column(Modifier.fillMaxWidth().padding(16.dp).semantics { contentDescription = "Loading" }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(count) {
            Box(Modifier.fillMaxWidth().height(76.dp).background(DesignTheme.sunken, DesignTheme.cardShape))
        }
    }
}

/** The uppercase section labels. */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text.uppercase(),
        modifier = modifier.padding(top = 8.dp, bottom = 4.dp),
        style = DesignTheme.body(12, FontWeight.SemiBold, DesignTheme.muted).copy(letterSpacing = 0.6.sp),
    )
}

/** Ids and other technical facts, folded away. */
@Composable
fun DetailsDisclosure(
    rows: List<Pair<String, String>>,
    modifier: Modifier = Modifier,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(modifier) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = DesignTheme.ink2, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(8.dp))
            Text("Details", style = DesignTheme.body(14, FontWeight.Medium))
            Spacer(Modifier.weight(1f))
            Icon(
                if (open) Icons.Outlined.KeyboardArrowDown else Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = DesignTheme.ink2,
            )
        }
        if (open) {
            SelectionContainer {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    rows.forEach { (label, value) ->
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(label, style = DesignTheme.body(12, FontWeight.Medium, DesignTheme.muted))
                            Text(value, style = DesignTheme.body(12).copy(fontFamily = FontFamily.Monospace))
                        }
                    }
                }
            }
        }
    }
}

/** The system share sheet for a link. */
fun shareLink(
    context: Context,
    link: String,
    title: String,
) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link).putExtra(Intent.EXTRA_SUBJECT, title)
    context.startActivity(Intent.createChooser(send, "Share board link"))
}
