// The board's types, as the contract (`logic/res/abi.json`) answers them: first written by
// @calimero/abi-codegen from v1's ABI, kept since. The calls are the generated [DesignClient]
// (`scripts/mobile-codegen.sh` at the repo root), and so are the types the ABI describes
// ([BoardInfo], [LabelUpdate], [MemberRole]) aliased below. The ABI also describes `Element`,
// `ElementPatch`, `Comment`, `CursorState` and `Member` (their u64/i64 fields are JSON numbers,
// `#[abi(plain)]`), but the screens still use the types here, which read each answer's JSON
// ([network.calimero.design.core.toDesign]). Once the screens use the generated ones, this file goes.

package network.calimero.design.generated

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import network.calimero.design.generated.client.DesignClient

/** Board summary: name, description, counts and owner. */
typealias BoardInfo = DesignClient.BoardInfo

/** One element's new label in an `updateElementLabels` call; a null label clears it. */
typealias LabelUpdate = DesignClient.LabelUpdate

/** A member with their effective role (`admin`, `editor` or `viewer`). */
typealias MemberRole = DesignClient.MemberRole

/** A comment pinned at a canvas point, with its replies. */
@Serializable
data class Comment(
    /** Comment id, chosen by the caller. */
    val id: String,
    /** Pin position, canvas pixels. */
    val x: Long,
    /** Pin position, canvas pixels. */
    val y: Long,
    /** The comment text. */
    val content: String,
    /** The writer's member id, set by the contract. */
    val author: String,
    /** Unix milliseconds. */
    val createdAt: ULong,
    /** The thread, oldest first. */
    val replies: List<CommentReply>,
)

/** A reply in a comment thread. */
@Serializable
data class CommentReply(
    /** Reply id, chosen by the caller. */
    val id: String,
    /** The reply text. */
    val content: String,
    /** The writer's member id, set by the contract. */
    val author: String,
    /** Unix milliseconds; replies are listed in this order. */
    val createdAt: ULong,
)

/** A pointer's last reported position. */
@Serializable
data class CursorState(
    /** The device (context identity) this pointer belongs to. */
    val identity: String,
    /** The member id (account) behind that device. */
    val account: String,
    /** Canvas pixels. */
    val x: Long,
    /** Canvas pixels. */
    val y: Long,
    /** Unix milliseconds of the last move. */
    val updatedAt: ULong,
)

/** One element on the canvas. */
@Serializable
data class Element(
    /** Chosen by the caller; use a fresh UUID. Writing an existing id replaces that element. */
    val id: String,
    /** What the element is, tagged by `kind`. */
    val data: ElementData,
    /** Left edge, canvas pixels. */
    val x: Long,
    /** Top edge, canvas pixels. */
    val y: Long,
    /** Width in pixels. */
    val width: UInt,
    /** Height in pixels. */
    val height: UInt,
    /** Clockwise rotation in degrees. */
    val rotation: Int,
    /**
     * Fill colour as a CSS colour (`"#ef4444"`, `"transparent"`); on a plain text
     * element, the text colour.
     */
    val fill: String,
    /** Outline colour as a CSS colour. */
    val stroke: String,
    /** Outline width in pixels; 0 for none. */
    val strokeWidth: UInt,
    /** Opacity in percent, 0 to 100. */
    val opacity: UInt,
    /** Paint order; higher paints on top. */
    val layerIndex: UInt,
    /** The creator's member id, set by the contract; the value sent is ignored. */
    val createdBy: String,
    /** Creation time, unix milliseconds. */
    val createdAt: ULong,
    /**
     * Last change, unix milliseconds. Between concurrent writes to one element the
     * larger value wins, so every write must carry a newer one.
     */
    val updatedAt: ULong,
    /** Drop shadow colour as a CSS colour; `null` for no shadow. */
    val shadowColor: String? = null,
    /** Drop shadow horizontal offset in pixels. */
    val shadowOffsetX: Int? = null,
    /** Drop shadow vertical offset in pixels. */
    val shadowOffsetY: Int? = null,
    /** Drop shadow blur radius in pixels; `null` or 0 for no shadow. */
    val shadowBlur: UInt? = null,
    /**
     * Layer name, a `/`-separated path: the groups, then the name. May carry client
     * extras after a U+001F character; keep them when renaming.
     */
    val label: String? = null,
    /**
     * Corner radius in pixels for a `rect`, drawn at most half the shorter side; 0 or
     * omitted means square corners.
     */
    val cornerRadius: UInt? = null,
)

/**
 * What an element is, as a JSON object tagged by `kind`: `rect`, `circle`, `line`,
 * `arrow`, `path`, `text`, `image` or `svg`, plus that kind's own fields.
 */
@Serializable(with = ElementDataSerializer::class)
sealed class ElementData {
    /** A rectangle filling the element's box; `cornerRadius` rounds its corners. */
    object Rect : ElementData()

    /** An ellipse filling the element's box. */
    object Circle : ElementData()

    /** A straight line. */
    data class Line(val value: ElementData_Line) : ElementData()

    /** A straight line with an arrowhead at its second point. */
    data class Arrow(val value: ElementData_Arrow) : ElementData()

    /** A freehand stroke or a closed outline. */
    data class Path(val value: ElementData_Path) : ElementData()

    /** Text in the element's box. */
    data class Text(val value: ElementData_Text) : ElementData()

    /** A raster image stored as a blob on the node. */
    data class Image(val value: ElementData_Image) : ElementData()

    /** An SVG image stored as a blob on the node. */
    data class Svg(val value: ElementData_Svg) : ElementData()
}

internal object ElementDataSerializer : KSerializer<ElementData> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun serialize(encoder: Encoder, value: ElementData) {
        val json = (encoder as JsonEncoder).json
        val element = when (value) {
            ElementData.Rect -> JsonObject(mapOf("kind" to JsonPrimitive("rect")))
            ElementData.Circle -> JsonObject(mapOf("kind" to JsonPrimitive("circle")))
            is ElementData.Line -> JsonObject(json.encodeToJsonElement(serializer<ElementData_Line>(), value.value).jsonObject + ("kind" to JsonPrimitive("line")))
            is ElementData.Arrow -> JsonObject(json.encodeToJsonElement(serializer<ElementData_Arrow>(), value.value).jsonObject + ("kind" to JsonPrimitive("arrow")))
            is ElementData.Path -> JsonObject(json.encodeToJsonElement(serializer<ElementData_Path>(), value.value).jsonObject + ("kind" to JsonPrimitive("path")))
            is ElementData.Text -> JsonObject(json.encodeToJsonElement(serializer<ElementData_Text>(), value.value).jsonObject + ("kind" to JsonPrimitive("text")))
            is ElementData.Image -> JsonObject(json.encodeToJsonElement(serializer<ElementData_Image>(), value.value).jsonObject + ("kind" to JsonPrimitive("image")))
            is ElementData.Svg -> JsonObject(json.encodeToJsonElement(serializer<ElementData_Svg>(), value.value).jsonObject + ("kind" to JsonPrimitive("svg")))
        }
        encoder.encodeJsonElement(element)
    }

    override fun deserialize(decoder: Decoder): ElementData {
        val json = (decoder as JsonDecoder).json
        val element = decoder.decodeJsonElement()
        val fields = element.jsonObject
        val tag = fields["kind"]?.jsonPrimitive?.content
        return when (tag) {
            "rect" -> ElementData.Rect
            "circle" -> ElementData.Circle
            "line" -> ElementData.Line(json.decodeFromJsonElement(serializer<ElementData_Line>(), JsonObject(fields - "kind")))
            "arrow" -> ElementData.Arrow(json.decodeFromJsonElement(serializer<ElementData_Arrow>(), JsonObject(fields - "kind")))
            "path" -> ElementData.Path(json.decodeFromJsonElement(serializer<ElementData_Path>(), JsonObject(fields - "kind")))
            "text" -> ElementData.Text(json.decodeFromJsonElement(serializer<ElementData_Text>(), JsonObject(fields - "kind")))
            "image" -> ElementData.Image(json.decodeFromJsonElement(serializer<ElementData_Image>(), JsonObject(fields - "kind")))
            "svg" -> ElementData.Svg(json.decodeFromJsonElement(serializer<ElementData_Svg>(), JsonObject(fields - "kind")))
            else -> throw SerializationException("Unknown ElementData variant " + tag)
        }
    }
}

@Serializable
data class ElementData_Arrow(
    /**
     * The two end points, `"x1,y1 x2,y2"`, in pixels from the element's `x` and `y`;
     * the arrowhead is at the second.
     */
    val points: String,
)

@Serializable
data class ElementData_Image(
    /** The image's own width in pixels, before any scaling to the element's box. */
    val naturalWidth: UInt,
    /** The image's own height in pixels. */
    val naturalHeight: UInt,
    /**
     * Id of the uploaded blob holding the image; the contract announces it to the
     * board's members so their nodes fetch it.
     */
    val blobId: String,
)

@Serializable
data class ElementData_Line(
    /** The two end points, `"x1,y1 x2,y2"`, in pixels from the element's `x` and `y`. */
    val points: String,
)

@Serializable
data class ElementData_Path(
    /** SVG path data in pixels from the element's `x` and `y`, e.g. `"M 0 0 L 40 40 Z"`. */
    val points: String,
)

@Serializable
data class ElementData_Svg(
    /** The SVG's own width in pixels. */
    val naturalWidth: UInt,
    /** The SVG's own height in pixels. */
    val naturalHeight: UInt,
    /** Id of the uploaded blob holding the SVG markup; announced like an image's. */
    val blobId: String,
)

@Serializable
data class ElementData_Text(
    /** The text itself; may be empty. */
    val content: String,
    /** Font size in pixels. */
    val fontSize: UInt,
    /** A CSS font family, e.g. `"sans-serif"`. */
    val fontFamily: String,
    /** Bold weight. */
    val bold: Boolean,
    /** Italic style. */
    val italic: Boolean,
    /** Horizontal alignment: `"left"`, `"center"` or `"right"`; omitted means left. */
    @SerialName("text_align") val textAlign: String? = null,
    /** Vertical alignment inside the box: `"top"`, `"middle"` or `"bottom"`. */
    @SerialName("vertical_align") val verticalAlign: String? = null,
)

/**
 * One element's change in an `update_elements` call. Fields match `update_element`'s
 * arguments; an omitted or `null` field is left unchanged.
 */
@Serializable
data class ElementPatch(
    /** The element to change; an unknown id is skipped. */
    val id: String,
    /** New left edge, canvas pixels. */
    val x: Long? = null,
    /** New top edge, canvas pixels. */
    val y: Long? = null,
    /** New width in pixels. */
    val width: UInt? = null,
    /** New height in pixels. */
    val height: UInt? = null,
    /** New rotation in degrees. */
    val rotation: Int? = null,
    /** New fill colour. */
    val fill: String? = null,
    /** New outline colour. */
    val stroke: String? = null,
    /** New outline width in pixels. */
    @SerialName("stroke_width") val strokeWidth: UInt? = null,
    /** New opacity in percent, 0 to 100. */
    val opacity: UInt? = null,
    /** New corner radius in pixels; 0 squares the corners. */
    @SerialName("corner_radius") val cornerRadius: UInt? = null,
)

/** A board member: someone who has called `join`. */
@Serializable
data class Member(
    /** Member id: the member's account id (64 hex), the id roles and ownership name. */
    val id: String,
    /** Display name the member chose. */
    val username: String,
    /** Avatar URL, or `null`. */
    val avatar: String? = null,
    /** When the member joined, unix milliseconds from their own clock. */
    val joinedAt: ULong,
    /** Unix milliseconds of the last profile edit; the newest edit wins. */
    val usernameUpdatedAt: ULong,
)

@Serializable
data class MeroDesign(
    @SerialName("board_name") val boardName: String,
    @SerialName("board_description") val boardDescription: String,
    @SerialName("initial_name") val initialName: String,
    @SerialName("initial_description") val initialDescription: String,
    /**
     * The canvas. Writer-set guarded: only accounts holding a role mask
     * projected from `roles` (editors, admins) may write an entry, on every
     * node.
     */
    val elements: Map<String, Element>,
    /** One slot per account, written only by that account. */
    val members: Map<String, Member>,
    /** Guarded like `elements`. */
    val comments: Map<String, Comment>,
    /**
     * Every reply, keyed `"<comment>/<created_at:020>/<reply>"` so one
     * comment's thread is a prefix slice in order. Guarded like `elements`.
     */
    val replies: Map<String, CommentReply>,
    /**
     * Keyed by DEVICE: a pointer belongs to a screen. Each entry is owned by
     * the account that wrote it.
     */
    val cursors: Map<String, CursorState>,
    val roles: Map<String, Boolean>,
)
