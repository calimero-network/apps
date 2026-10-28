package network.calimero.chess.ui

import android.view.HapticFeedbackConstants
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.chess.app.Board
import network.calimero.chess.app.Piece
import network.calimero.chess.app.TableState

/**
 * The board: flat squares, the contract's legal moves as dots and rings, tap-tap to move.
 * (iOS `BoardView`.)
 *
 * Tap-to-select rather than drag: it works the same with a finger and TalkBack, and a slipped drop
 * cannot send a move nobody meant. Every square it offers comes from the contract's legal-move list;
 * there is no engine here.
 */
@Composable
fun BoardView(
    state: TableState,
    onTap: (String) -> Unit,
) {
    val view = LocalView.current
    val squares = state.squares
    val order = Board.displayOrder(state.flipped)
    val targets = state.targets
    val movable = state.movable
    val last = state.lastMove
    val check = state.inCheck
    val leftFile = if (state.flipped) 7 else 0
    val bottomRank = if (state.flipped) 7 else 0
    val shape = RoundedCornerShape(12.dp)

    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(shape)
            .border(Hairline, ChessColors.Line, shape)
            .semantics { contentDescription = "Chess board" },
    ) {
        val side = maxWidth / 8
        Column {
            order.chunked(8).forEach { row ->
                Row {
                    row.forEach { index ->
                        val name = Board.squareName(index)
                        val piece = squares[index]
                        Square(
                            index = index,
                            piece = piece,
                            side = side,
                            selected = state.selected == name,
                            target = name in targets,
                            last = last?.let { it.first == name || it.second == name } ?: false,
                            checked = piece?.kind == 'k' && piece.color == check,
                            rankLabel = if (index % 8 == leftFile) "${index / 8 + 1}" else null,
                            fileLabel = if (index / 8 == bottomRank) "${Board.FILES[index % 8]}" else null,
                            label = piece?.let { "$name, ${it.spokenName}" } ?: name,
                            onClick = {
                                if (state.interactive) {
                                    if (name in movable || name in targets || state.selected != null) {
                                        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                                    }
                                    onTap(name)
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Square(
    index: Int,
    piece: Piece?,
    side: Dp,
    selected: Boolean,
    target: Boolean,
    last: Boolean,
    checked: Boolean,
    rankLabel: String?,
    fileLabel: String?,
    label: String,
    onClick: () -> Unit,
) {
    val dark = Board.isDark(index)
    Box(
        modifier =
            Modifier
                .size(side)
                .background(if (dark) ChessColors.SquareDark else ChessColors.SquareLight)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
                .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (last) Box(Modifier.fillMaxSize().background(ChessColors.SquareLast))
        if (selected) Box(Modifier.fillMaxSize().background(ChessColors.SquareSelected))
        if (checked) {
            Box(
                Modifier.fillMaxSize().background(
                    Brush.radialGradient(listOf(ChessColors.SquareCheck, ChessColors.SquareCheck.copy(alpha = 0f))),
                ),
            )
        }
        if (piece != null) PieceImage(piece.assetName, Modifier.fillMaxSize().padding(side * 0.06f))
        if (target) {
            Canvas(Modifier.fillMaxSize()) {
                if (piece == null) {
                    drawCircle(ChessColors.SquareHint, radius = size.minDimension * 0.15f)
                } else {
                    val stroke = size.minDimension * 0.08f
                    drawCircle(
                        ChessColors.SquareHint,
                        radius = size.minDimension / 2 - stroke / 2 - size.minDimension * 0.02f,
                        center = Offset(size.width / 2, size.height / 2),
                        style = Stroke(stroke),
                    )
                }
            }
        }
        val coordColor = if (dark) ChessColors.SquareLight else ChessColors.SquareDark
        val coordSize = maxOf(8f, side.value * 0.2f).sp
        rankLabel?.let {
            Text(
                it,
                fontSize = coordSize,
                fontWeight = FontWeight.SemiBold,
                color = coordColor,
                modifier = Modifier.align(Alignment.TopStart).padding(side * 0.05f),
            )
        }
        fileLabel?.let {
            Text(
                it,
                fontSize = coordSize,
                fontWeight = FontWeight.SemiBold,
                color = coordColor,
                modifier = Modifier.align(Alignment.BottomEnd).padding(side * 0.05f),
            )
        }
    }
}
