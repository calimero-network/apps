package network.calimero.pixart.core

import network.calimero.pixart.generated.Layer
import network.calimero.pixart.generated.TextProps

/** Where one layer's pixels come from. (Swift `LayerSource`.) */
sealed interface LayerSource {
    /** A PNG blob, drawn at the layer's top-left and clipped to its box. */
    data class Raster(
        val blobId: String,
    ) : LayerSource

    /** A solid colour over the whole box (an unpainted fill layer). */
    data class Fill(
        val color: Rgba,
    ) : LayerSource

    /** Lines of text in the box. */
    data class Text(
        val props: TextProps,
    ) : LayerSource
}

/** One draw of the composite: a layer's prepared pixels placed by its matrix (and warp), at its inherited opacity, with its blend mode. */
data class DrawOp(
    val layerId: String,
    val source: LayerSource,
    val maskBlobId: String?,
    val width: Int,
    val height: Int,
    val alpha: Double,
    val blend: BlendMode,
    val matrix: Affine,
    val warp: Warp?,
    val filter: ColorFilter?,
)

/**
 * The layer stack as the web's compositor reads it (`utils/compositor.ts`): every layer by ascending
 * `layerIndex`, folders contributing only inherited visibility and opacity. `overrides` are this phone's
 * own show/hide choices, which replace a layer's `visible` here and nowhere else. (Swift `LayerStack`.)
 */
object LayerStack {
    const val MAX_DEPTH = 32

    fun drawOps(
        layers: List<Layer>,
        overrides: Map<String, Boolean> = emptyMap(),
    ): List<DrawOp> {
        val map = layers.associateBy { it.id }
        return layers
            .withIndex()
            .sortedWith(compareBy({ it.value.layerIndex }, { it.index }))
            .map { it.value }
            .mapNotNull { layer ->
                if (!isVisible(layer, map, overrides)) return@mapNotNull null
                val alpha = opacity(layer, map)
                val source = source(layer)
                if (alpha <= 0 || source == null) return@mapNotNull null
                DrawOp(
                    layerId = layer.id,
                    source = source,
                    maskBlobId = layer.maskBlobId?.takeIf { it.isNotEmpty() },
                    width = maxOf(1, layer.width.toInt()),
                    height = maxOf(1, layer.height.toInt()),
                    alpha = alpha,
                    blend = BlendMode.of(layer.blendMode),
                    matrix = LayerGeometry.matrix(layer),
                    warp = Warp.parse(layer.warp),
                    filter = ColorFilter.from(layer.adjustments),
                )
            }
    }

    /** The pixels a layer draws, or null for folders, adjustment layers and rasters with nothing painted yet. */
    fun source(layer: Layer): LayerSource? =
        when (layer.kind) {
            "group", "adjustment" -> null
            "text" -> layer.text?.let { LayerSource.Text(it) }
            "fill" ->
                if (layer.blobId.isNotEmpty()) {
                    LayerSource.Raster(layer.blobId)
                } else {
                    LayerSource.Fill(Rgba.parse(layer.fill) ?: Rgba(0.0, 0.0, 0.0))
                }
            else -> if (layer.blobId.isEmpty()) null else LayerSource.Raster(layer.blobId)
        }

    fun visible(
        layer: Layer,
        overrides: Map<String, Boolean>,
    ): Boolean = overrides[layer.id] ?: layer.visible

    /** Visible only if it and every folder above it are. */
    fun isVisible(
        layer: Layer,
        map: Map<String, Layer>,
        overrides: Map<String, Boolean>,
    ): Boolean {
        var cur: Layer? = layer
        val seen = HashSet<String>()
        while (cur != null && seen.size < MAX_DEPTH) {
            if (!visible(cur, overrides)) return false
            // Up to the parent, unless this layer was already passed (a cycle).
            cur = cur.parentId?.takeIf { seen.add(cur!!.id) }?.let { map[it] }
        }
        return true
    }

    /** Opacity multiplied down the folder chain, 0…1. */
    fun opacity(
        layer: Layer,
        map: Map<String, Layer>,
    ): Double {
        var o = layer.opacity.toDouble() / 100
        var cur = layer.parentId?.let { map[it] }
        val seen = hashSetOf(layer.id)
        while (cur != null && cur.id !in seen && seen.size < MAX_DEPTH) {
            o *= cur.opacity.toDouble() / 100
            seen += cur.id
            cur = cur.parentId?.let { map[it] }
        }
        return o.coerceIn(0.0, 1.0)
    }

    /** Every blob the composite needs: pixels and masks. */
    fun blobIds(ops: List<DrawOp>): List<String> {
        val out = LinkedHashSet<String>()
        for (op in ops) {
            (op.source as? LayerSource.Raster)?.let { out += it.blobId }
            op.maskBlobId?.let { out += it }
        }
        return out.toList()
    }
}

/** A row of the layer list: front-most first, folders before their contents. (Swift `LayerRow`.) */
data class LayerRow(
    val layer: Layer,
    val depth: Int,
    /** This layer's own visibility on this phone. */
    val visible: Boolean,
    /** A folder above it is hidden, so it is hidden too. */
    val hiddenByFolder: Boolean,
    /** This phone shows or hides it differently from the document. */
    val overridden: Boolean,
) {
    val id: String get() = layer.id
}

/** The folder tree (the web's `buildTree`): a layer whose parent is missing, not a folder, or would close a cycle sits at the top level. */
object LayerTree {
    fun rows(
        layers: List<Layer>,
        overrides: Map<String, Boolean> = emptyMap(),
    ): List<LayerRow> {
        val map = layers.associateBy { it.id }
        val children = HashMap<String, MutableList<Layer>>()
        val roots = ArrayList<Layer>()
        for (l in layers) {
            val p = effectiveParent(l, map)
            if (p != null) children.getOrPut(p) { ArrayList() } += l else roots += l
        }
        val out = ArrayList<LayerRow>()

        fun walk(
            list: List<Layer>,
            depth: Int,
            folderHidden: Boolean,
        ) {
            for (l in list.sortedByDescending { it.layerIndex }) {
                val own = LayerStack.visible(l, overrides)
                out += LayerRow(l, depth, own, folderHidden, overrides[l.id]?.let { it != l.visible } ?: false)
                val kids = children[l.id]
                if (depth < LayerStack.MAX_DEPTH && kids != null) walk(kids, depth + 1, folderHidden || !own)
            }
        }
        walk(roots, 0, false)
        return out
    }

    private fun effectiveParent(
        layer: Layer,
        map: Map<String, Layer>,
    ): String? {
        val pid = layer.parentId?.takeIf { it != layer.id && map[it]?.kind == "group" } ?: return null
        // Walk up from the parent: meeting this layer means the edge closes a cycle.
        var cur: Layer? = map[pid]
        var depth = 0
        while (cur != null && depth < LayerStack.MAX_DEPTH) {
            if (cur.id == layer.id) return null
            cur = cur.parentId?.let { map[it] }
            depth++
        }
        return pid
    }
}
