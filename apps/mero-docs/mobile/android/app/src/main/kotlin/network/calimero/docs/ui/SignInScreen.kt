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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.calimero.mero.compose.MeroAuthState

/** Sign in with a Calimero account: the wallet certifies this phone's key. */
@Composable
fun SignInScreen(
    auth: MeroAuthState,
    onSignIn: () -> Unit,
    onCancel: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(DocsTheme.ground).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize().padding(start = 24.dp, end = 24.dp, bottom = 16.dp)) {
            Spacer(Modifier.weight(1f))
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
            Spacer(Modifier.weight(1f))
            auth.error?.let {
                Text(it, style = DocsTheme.body(14, color = DocsTheme.danger), modifier = Modifier.padding(bottom = 12.dp))
            }
            PrimaryButton(onClick = onSignIn, enabled = !auth.isLoading) {
                if (auth.isLoading) {
                    CircularProgressIndicator(color = DocsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                }
                Text(if (auth.isLoading) "Waiting for the wallet…" else "Sign in with Calimero", style = DocsTheme.body(16, FontWeight.SemiBold, DocsTheme.ink))
            }
            if (auth.isLoading) {
                TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("Cancel", style = DocsTheme.body(14, FontWeight.Medium))
                }
            }
            Text(
                "Your documents stay end-to-end encrypted on your workspace's nodes. This phone holds no node; it signs in through your account's relay.",
                style = DocsTheme.body(12, color = DocsTheme.faint),
                modifier = Modifier.padding(top = 14.dp),
            )
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
