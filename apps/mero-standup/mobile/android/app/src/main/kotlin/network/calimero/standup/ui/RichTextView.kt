package network.calimero.standup.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.standup.core.RichText

/** Bullet lists, links and `code`, rendered as text: never as markup. */
@Composable
fun RichTextView(
    text: String,
    color: Color = Palette.ink,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (block in RichText.parse(text)) {
            when (block) {
                is RichText.Block.Paragraph -> Text(annotated(block.inlines), color = color, fontSize = 15.sp)
                is RichText.Block.ListBlock ->
                    for (item in block.items) {
                        Row(Modifier.padding(start = 2.dp)) {
                            Text("•  ", color = Palette.ink2, fontSize = 15.sp)
                            Text(annotated(item), color = color, fontSize = 15.sp)
                        }
                    }
            }
        }
    }
}

private fun annotated(inlines: List<RichText.Inline>): AnnotatedString =
    buildAnnotatedString {
        for (inline in inlines) {
            when (inline) {
                is RichText.Inline.Text -> append(inline.text)
                is RichText.Inline.Code ->
                    withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = Palette.sunken, fontSize = 14.sp)) { append(inline.text) }
                is RichText.Inline.Link ->
                    withLink(LinkAnnotation.Url(inline.url, TextLinkStyles(SpanStyle(textDecoration = TextDecoration.Underline)))) {
                        append(inline.url)
                    }
            }
        }
    }
