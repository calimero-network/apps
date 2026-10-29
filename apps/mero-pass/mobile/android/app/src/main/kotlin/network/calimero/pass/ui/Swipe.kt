package network.calimero.pass.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** One swipe action: what it says, its icon and colour, and what it does. (iOS `swipeActions`.) */
class SwipeAction(
    val label: String,
    val icon: ImageVector,
    val color: Color,
    val run: () -> Unit,
)

/**
 * A row with iOS's swipe actions: [start] when swiped right (leading), [end] when swiped left
 * (trailing). The action runs and the row springs back; nothing is dismissed by the swipe itself.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeRow(
    start: SwipeAction? = null,
    end: SwipeAction? = null,
    content: @Composable () -> Unit,
) {
    if (start == null && end == null) {
        content()
        return
    }
    val state =
        rememberSwipeToDismissBoxState(confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> start?.run?.invoke()
                SwipeToDismissBoxValue.EndToStart -> end?.run?.invoke()
                SwipeToDismissBoxValue.Settled -> Unit
            }
            false
        })
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = start != null,
        enableDismissFromEndToStart = end != null,
        backgroundContent = {
            val action = if (state.dismissDirection == SwipeToDismissBoxValue.StartToEnd) start else end
            if (action != null && state.dismissDirection != SwipeToDismissBoxValue.Settled) {
                val leading = state.dismissDirection == SwipeToDismissBoxValue.StartToEnd
                Row(
                    Modifier.fillMaxSize().background(action.color).padding(horizontal = 20.dp),
                    horizontalArrangement = if (leading) Arrangement.Start else Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(action.icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(action.label, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }
            }
        },
        content = { content() },
    )
}
