package network.calimero.docs.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import network.calimero.docs.app.DocsAppViewModel

/** Sign in with a Calimero account: a passkey on your Calimero Cloud cluster, or a development node. */
@Composable
fun SignInScreen(vm: DocsAppViewModel) {
    Box(Modifier.fillMaxSize().background(DocsTheme.ground).safeDrawingPadding()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 16.dp),
        ) {
            Spacer(Modifier.height(48.dp))
            AppMark(64.dp)
            Text("Mero Docs", style = DocsTheme.heading(34), modifier = Modifier.padding(top = 24.dp))
            Text(
                "Your workspace's documents, on your phone. Read them, search them and talk them through in comments.",
                style = DocsTheme.body(17, color = DocsTheme.muted),
                modifier = Modifier.padding(top = 10.dp),
            )
            Column(Modifier.padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Feature(Icons.AutoMirrored.Outlined.Article, "Read documents as they were written")
                Feature(Icons.Outlined.Search, "Search every folder at once")
                Feature(Icons.Outlined.ChatBubbleOutline, "Comment on any paragraph")
            }
            Spacer(Modifier.height(36.dp))
            CloudSignInPanel(vm)
        }
    }
}

@Composable
private fun Feature(
    icon: ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(36.dp)
                .background(DocsTheme.surface, RoundedCornerShape(10.dp))
                .border(DocsTheme.hairline, DocsTheme.line, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = DocsTheme.ink, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = DocsTheme.body(15))
    }
    Spacer(Modifier.height(0.dp))
}
