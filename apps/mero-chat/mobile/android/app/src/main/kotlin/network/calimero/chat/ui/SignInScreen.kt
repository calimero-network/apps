package network.calimero.chat.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/**
 * Sign-in is the Calimero account only: the wallet certifies a key this device made, and the app
 * talks to the account's relay with it. No node URL, no username, no password.
 */
@Composable
fun SignInScreen(
    busy: Boolean,
    error: String?,
    cancelled: Boolean,
    onSignIn: () -> Unit,
    onCancel: () -> Unit,
) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Mero Chat", style = MaterialTheme.typography.headlineLarge)
            Spacer(Modifier.height(8.dp))
            Text(
                "Private workspaces that sync between everyone in them. Sign in with your Calimero account to start.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(32.dp))
            if (busy) {
                CircularProgressIndicator()
                Spacer(Modifier.height(12.dp))
                Text("Waiting for the Calimero wallet…", style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = onCancel) { Text("Cancel") }
            } else {
                Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth()) { Text("Continue with Calimero") }
            }
            if (error != null) {
                Spacer(Modifier.height(16.dp))
                Text(error, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            } else if (cancelled) {
                Spacer(Modifier.height(16.dp))
                Text("Sign-in was cancelled in the wallet.", textAlign = TextAlign.Center)
            }
        }
    }
}
