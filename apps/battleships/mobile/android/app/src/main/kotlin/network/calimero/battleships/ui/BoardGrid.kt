package network.calimero.battleships.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.battleships.core.BoardGeometry
import network.calimero.battleships.core.Cell
import network.calimero.battleships.core.Coordinate
import network.calimero.battleships.core.FleetLayout

/** How one square looks: a flat fill and, for a shot, a marker icon. (iOS `SquareLook`.) */
data class SquareLook(
    val fill: Color = Palette.Water,
    val icon: ImageVector? = null,
    val tint: Color = Color.White,
    val iconScale: Float = 0.5f,
    val spoken: String = "water",
) {
    companion object {
        val Water = SquareLook()
        val Ship = SquareLook(fill = Palette.Ship, spoken = "ship")
        val SelectedShip = SquareLook(fill = Palette.Lime, spoken = "selected ship")
        val Hit = SquareLook(Palette.Hit, Icons.Filled.Close, Color.White, 0.6f, "hit")
        val Sunk = SquareLook(Palette.Sunk, Icons.Filled.Close, Color.White, 0.6f, "sunk")
        val Miss = SquareLook(Palette.Water, Icons.Filled.Circle, Palette.Miss, 0.26f, "miss")
        val Pending = SquareLook(Palette.PendingSoft, Icons.Outlined.HourglassEmpty, Palette.Pending, 0.55f, "waiting for an answer")
        val Aim = SquareLook(Palette.Lime, Icons.Filled.GpsFixed, Palette.Ink, 0.62f, "aimed")
    }
}

/** The 10x10 board: column letters across the top, row numbers down the side, flat cells. */
@Composable
fun BoardGrid(
    looks: List<SquareLook>,
    compact: Boolean = false,
    onTap: ((Coordinate) -> Unit)? = null,
) {
    val gap = if (compact) 2.dp else 3.dp
    val label = if (compact) 14.dp else 18.dp
    val labelSize = if (compact) 9.sp else 11.sp
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
        Row(horizontalArrangement = Arrangement.spacedBy(gap), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(label))
            for (x in 0 until BoardGeometry.SIZE) {
                Text(
                    Coordinate.columnLabel(x),
                    fontSize = labelSize,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.Muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        for (y in 0 until BoardGeometry.SIZE) {
            Row(horizontalArrangement = Arrangement.spacedBy(gap), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${y + 1}",
                    fontSize = labelSize,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.Muted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.width(label),
                )
                for (x in 0 until BoardGeometry.SIZE) {
                    val cell = Coordinate(x, y)
                    Square(looks.getOrElse(cell.index) { SquareLook.Water }, cell, compact, onTap, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun Square(
    look: SquareLook,
    cell: Coordinate,
    compact: Boolean,
    onTap: ((Coordinate) -> Unit)?,
    modifier: Modifier,
) {
    BoxWithConstraints(
        modifier =
            modifier
                .aspectRatio(1f)
                .clip(RoundedCornerShape(if (compact) 2.5.dp else 4.dp))
                .background(look.fill)
                .let { if (onTap != null) it.clickable { onTap(cell) } else it }
                .semantics { contentDescription = "${cell.label}, ${look.spoken}" },
        contentAlignment = Alignment.Center,
    ) {
        val icon = look.icon
        if (icon != null) Icon(icon, contentDescription = null, tint = look.tint, modifier = Modifier.size(maxWidth * look.iconScale))
    }
}

/** A legend swatch: one square's look, small. */
@Composable
fun Swatch(look: SquareLook) {
    Box(Modifier.size(16.dp).clip(RoundedCornerShape(3.dp)).background(look.fill), contentAlignment = Alignment.Center) {
        val icon = look.icon
        if (icon != null) Icon(icon, contentDescription = null, tint = look.tint, modifier = Modifier.size(16.dp * look.iconScale))
    }
}

/** The grids a match shows, as looks. (iOS `BoardLooks`.) */
object BoardLooks {
    /** Placement: your ships, the selected one in lime. */
    fun placement(
        layout: FleetLayout,
        selected: Int?,
    ): List<SquareLook> {
        val looks = MutableList(BoardGeometry.CELL_COUNT) { SquareLook.Water }
        layout.ships.forEachIndexed { index, ship ->
            ship?.cells?.forEach { looks[it.index] = if (index == selected) SquareLook.SelectedShip else SquareLook.Ship }
        }
        return looks
    }

    /** Their waters: your shots, with the ships you have certainly sunk and where you are aiming. */
    fun enemy(
        shots: List<Int>,
        sunk: List<List<Coordinate>>,
        aim: Coordinate?,
    ): List<SquareLook> {
        val sunkCells = sunk.flatten().toSet()
        return Coordinate.all.map { cell ->
            if (cell == aim) return@map SquareLook.Aim
            when (shots.getOrElse(cell.index) { Cell.EMPTY }) {
                Cell.HIT -> if (cell in sunkCells) SquareLook.Sunk else SquareLook.Hit
                Cell.MISS -> SquareLook.Miss
                Cell.PENDING -> SquareLook.Pending
                else -> SquareLook.Water
            }
        }
    }

    /** Your fleet: your ships, with the opponent's answered shots over them. */
    fun own(
        board: List<Int>,
        sunk: List<List<Coordinate>>,
    ): List<SquareLook> {
        val sunkCells = sunk.flatten().toSet()
        return Coordinate.all.map { cell ->
            when (board.getOrElse(cell.index) { Cell.EMPTY }) {
                Cell.SHIP -> SquareLook.Ship
                Cell.HIT -> if (cell in sunkCells) SquareLook.Sunk else SquareLook.Hit
                Cell.MISS -> SquareLook.Miss
                Cell.PENDING -> SquareLook.Pending
                else -> SquareLook.Water
            }
        }
    }
}
