package network.calimero.models.core

import com.calimero.mero.app.MeroAppBackend
import network.calimero.models.generated.client.ModelsClient
import java.io.IOException

/** The generated client over this backend's contract, bound to one scene. */
fun MeroAppBackend.modelsClient(contextId: String): ModelsClient = ModelsClient(this, contextId)

/**
 * Mesh and texture bytes, stored as blobs on the scene's context. `MeroAppBackend` has no blob call
 * yet, so the app reads them through the signed-in client's admin surface (`getBlob(blobId,
 * contextId)`). (Swift `BlobLoading`.)
 */
fun interface BlobLoading {
    suspend fun blob(
        id: String,
        contextId: String,
    ): ByteArray
}

/** No blobs: meshes stay as placeholder boxes. */
val NoBlobs = BlobLoading { _, _ -> throw IOException("no blob store") }
