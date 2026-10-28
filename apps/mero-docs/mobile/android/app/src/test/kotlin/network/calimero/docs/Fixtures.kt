package network.calimero.docs

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import network.calimero.docs.app.RecentDoc
import network.calimero.docs.app.RecentStore

/**
 * A scripted docs node behind `InMemoryAppBackend`: raw JSON per method, as the relay returns it
 * (booleans in span marks, nanosecond u64s). (Swift `FakeDocs`.)
 */
class FakeDocs {
    val backend = InMemoryAppBackend()
    private val answers = mutableMapOf<String, (com.calimero.mero.testkit.RecordedContractCall) -> String>()

    init {
        backend.recording.handler = { call ->
            val answer = synchronized(answers) { answers["${call.contextId}/${call.method}"] ?: answers["*/${call.method}"] }
            answer?.let { Json.parseToJsonElement(it(call)) } ?: JsonNull
        }
    }

    fun on(
        method: String,
        context: String = "*",
        json: String,
    ) = synchronized(answers) { answers["$context/$method"] = { json } }

    /** A workspace with `Product` (holding `Specs`) and `Notes`. */
    fun standardWorkspace() {
        backend.namespaces = listOf(AppNamespace(WS, "Acme", backend.applicationId, 3))
        backend.subgroups =
            mapOf(
                WS to listOf(AppSubgroup("g-product", "Product", listOf("c-product")), AppSubgroup("g-notes", "Notes", listOf("c-notes"))),
                "g-product" to listOf(AppSubgroup("g-specs", "Specs", listOf("c-specs"))),
            )
        backend.members = setOf("c-product", "c-notes")
        on("list_docs", "c-product", "[${doc("d1", "Roadmap", 300)}]")
        on("list_docs", "c-notes", "[${doc("d2", "Standup notes", 500)}]")
        on("list_docs", "c-specs", "[${doc("d3", "API spec", 100)}]")
    }

    companion object {
        val WS = "a1".repeat(32)
        val ME = "ab".repeat(32)
        val OTHER = "cd".repeat(32)

        fun doc(
            id: String,
            title: String,
            updated: Long,
            archived: Boolean = false,
        ) = """{"id":"$id","title":"$title","tags":[],"archived":$archived,"created_at":1700000000000000000,""" +
            """"updated_at":${1_700_000_000_000_000_000 + updated},"created_by":"$OTHER","updated_by":"$OTHER","can_delete":false}"""

        fun comment(
            id: String,
            body: String,
            author: String = OTHER,
            at: Long,
        ) = """{"id":"$id","author":"$author","doc_id":"d1","body":"$body","created_at":${1_700_000_000_000_000_000 + at}}"""

        /** A body as the node returns it: marks as JSON booleans, plain spans without `attributes`. */
        val BODY =
            """
            [
              {"id":"b1","kind":"heading","depth":0,"attrs":{"level":"2"},"spans":[{"text":"Plan"}],"ids":[]},
              {"id":"b2","kind":"paragraph","depth":0,"attrs":{},"spans":[
                {"text":"Ship "},{"text":"fast","attributes":{"bold":true,"italic":true}},
                {"text":" and ","attributes":{}},{"text":"read this","attributes":{"link":"https://example.com"}}],"ids":[]},
              {"id":"b3","kind":"numberedListItem","depth":0,"attrs":{},"spans":[{"text":"One"}],"ids":[]},
              {"id":"b4","kind":"numberedListItem","depth":0,"attrs":{},"spans":[{"text":"Two"}],"ids":[]},
              {"id":"b5","kind":"image","depth":0,"attrs":{"url":"blob:${"0f".repeat(32)}","caption":"Chart"},"spans":[],"ids":[]},
              {"id":"b6","kind":"table","depth":0,"attrs":{},"spans":[],"ids":[]}
            ]
            """.trimIndent()
    }
}

class MemoryRecents : RecentStore {
    val list = mutableMapOf<String, MutableList<RecentDoc>>()

    override fun recent(workspaceId: String) = list[workspaceId].orEmpty()

    override fun touch(
        workspaceId: String,
        folderId: String,
        docId: String,
        at: Long,
    ) {
        val l = list.getOrPut(workspaceId) { mutableListOf() }
        l.removeAll { it.folderId == folderId && it.docId == docId }
        l.add(0, RecentDoc(folderId, docId, at))
    }
}
