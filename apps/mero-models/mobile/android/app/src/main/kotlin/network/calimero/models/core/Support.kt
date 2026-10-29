package network.calimero.models.core

import com.calimero.mero.app.MeroAppBackend
import network.calimero.models.generated.ModelsClient
import java.io.IOException

/**
 * The generated client over this backend's contract, bound to one scene. The client is generated
 * with `--transport-import com.calimero.mero.app.ContextContractCalling`, so the SDK's bound
 * contract is its transport as is.
 */
fun MeroAppBackend.modelsClient(contextId: String): ModelsClient = ModelsClient(contract.bound(contextId))

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
