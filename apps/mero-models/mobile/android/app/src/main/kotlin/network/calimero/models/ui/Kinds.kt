package network.calimero.models.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.CropSquare
import androidx.compose.material.icons.outlined.FlashlightOn
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Hexagon
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.ViewInAr
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The Material icon for an object kind; iOS's `Theme.kindIcon` maps the same kinds to SF Symbols. */
fun kindIcon(kind: String): ImageVector =
    when (kind) {
        "cube" -> Icons.Outlined.ViewInAr
        "sphere", "icosphere" -> Icons.Outlined.Circle
        "cylinder", "cone", "torus", "capsule" -> Icons.Outlined.Category
        "plane" -> Icons.Outlined.CropSquare
        "mesh" -> Icons.Outlined.Hexagon
        "group" -> Icons.Outlined.Folder
        "point_light" -> Icons.Outlined.Lightbulb
        "spot_light" -> Icons.Outlined.FlashlightOn
        "directional_light" -> Icons.Outlined.WbSunny
        "texture" -> Icons.Outlined.Image
        else -> Icons.Outlined.ViewInAr
    }

/** An object kind's icon on a tinted tile. */
@Composable
fun KindTile(
    kind: String,
    size: Dp = 32.dp,
) {
    Box(
        Modifier.size(size).background(ModelsTheme.sunken, RoundedCornerShape(size * 0.28f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(kindIcon(kind), contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(size * 0.5f))
    }
}

/** A role as a small pill: Admin, Editor, Viewer. */
@Composable
fun RoleBadge(role: String) {
    val admin = role == "admin"
    Text(
        role.replaceFirstChar { it.uppercase() },
        style = ModelsTheme.body(12, FontWeight.SemiBold, if (admin) ModelsTheme.ink else ModelsTheme.ink2),
        modifier =
            Modifier
                .background(if (admin) ModelsTheme.lime else ModelsTheme.sunken, RoundedCornerShape(50))
                .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}
