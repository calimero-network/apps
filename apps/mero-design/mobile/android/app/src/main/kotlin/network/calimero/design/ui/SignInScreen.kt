package network.calimero.design.ui

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
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Slideshow
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
    Box(Modifier.fillMaxSize().background(DesignTheme.ground).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize().padding(start = 24.dp, end = 24.dp, bottom = 16.dp)) {
            Spacer(Modifier.weight(1f))
            AppMark(64.dp)
            Text("Mero Design", style = DesignTheme.heading(34), modifier = Modifier.padding(top = 24.dp))
            Text(
                "Your team's boards, on your phone. View designs, present screens and leave comments.",
                style = DesignTheme.body(17, color = DesignTheme.muted),
                modifier = Modifier.padding(top = 10.dp),
            )
            Column(Modifier.padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Feature(Icons.Outlined.PanTool, "Pan and pinch around any board")
                Feature(Icons.Outlined.Slideshow, "Present screens full screen")
                Feature(Icons.Outlined.ChatBubbleOutline, "Read and add comments")
            }
            Spacer(Modifier.weight(1f))
            auth.error?.let {
                Text(it, style = DesignTheme.body(14, color = DesignTheme.danger), modifier = Modifier.padding(bottom = 12.dp))
            }
            PrimaryButton(onClick = onSignIn, enabled = !auth.isLoading) {
                if (auth.isLoading) {
                    CircularProgressIndicator(color = DesignTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                }
                Text(if (auth.isLoading) "Waiting for the wallet…" else "Sign in with Calimero", style = DesignTheme.body(16, FontWeight.SemiBold, DesignTheme.ink))
            }
            if (auth.isLoading) {
                TextButton(onClick = onCancel, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("Cancel", style = DesignTheme.body(14, FontWeight.Medium))
                }
            }
            Text(
                "Your boards stay on your team's nodes. This phone holds no node; it signs in through your account's relay.",
                style = DesignTheme.body(12, color = DesignTheme.faint),
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
                .background(DesignTheme.surface, RoundedCornerShape(10.dp))
                .border(DesignTheme.hairline, DesignTheme.line, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = DesignTheme.ink, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(text, style = DesignTheme.body(15))
    }
    Spacer(Modifier.height(0.dp))
}
