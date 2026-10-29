package network.calimero.docs

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.docs.app.DocumentModel
import network.calimero.docs.app.FolderNotReadyException
import network.calimero.docs.app.LoadState
import network.calimero.docs.app.Workspace
import network.calimero.docs.app.WorkspaceModel
import network.calimero.docs.app.WorkspacesModel
import network.calimero.docs.app.personName
import network.calimero.docs.core.BlobLoading
import network.calimero.docs.core.BlockAlignment
import network.calimero.docs.core.BlockKind
import network.calimero.docs.core.CommentBody
import network.calimero.docs.core.DocComment
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsFormat
import network.calimero.docs.core.DocumentReader
import network.calimero.docs.core.LinkTarget
import network.calimero.docs.core.WireBlock
import network.calimero.docs.core.WireSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** (Swift `DocsCoreTests.swift`; the same cases.) */
class DocumentReaderTest {
    private fun rows() = Json.parseToJsonElement(FakeDocs.BODY).jsonArray.map { WireBlock.from(it) }

    @Test fun decodesTheNodesSpanShape() {
        val rows = rows()
        assertEquals(6, rows.size)
        assertEquals(listOf(WireSpan("Plan")), rows[0].spans)
        assertEquals(mapOf("bold" to "true", "italic" to "true"), rows[1].spans[1].attributes)
    }

    @Test fun blocksCarryKindsMarksAndNumbers() {
        val blocks = DocumentReader.blocks(rows())
        assertEquals(BlockKind.Heading(2), blocks[0].kind)
        assertEquals(listOf("Ship ", "fast", " and ", "read this"), blocks[1].runs.map { it.text })
        assertTrue(blocks[1].runs[1].bold && blocks[1].runs[1].italic)
        assertEquals("https://example.com", blocks[1].runs[3].link)
        assertEquals(BlockKind.Numbered(1), blocks[2].kind)
        assertEquals(BlockKind.Numbered(2), blocks[3].kind)
        assertEquals(BlockKind.Image("0f".repeat(32), "Chart", "", null), blocks[4].kind)
        assertEquals(BlockKind.Unsupported("table"), blocks[5].kind)
        assertEquals(9, DocumentReader.wordCount(blocks))
    }

    @Test fun numberingRestartsAfterAnotherBlockAndNestsByDepth() {
        val rows =
            listOf(
                WireBlock("1", "numberedListItem"),
                WireBlock("2", "numberedListItem", 1),
                WireBlock("3", "numberedListItem", 1),
                WireBlock("4", "numberedListItem"),
                WireBlock("5", "paragraph"),
                WireBlock("6", "numberedListItem"),
            )
        assertEquals(
            listOf(BlockKind.Numbered(1), BlockKind.Numbered(1), BlockKind.Numbered(2), BlockKind.Numbered(2), BlockKind.Paragraph, BlockKind.Numbered(1)),
            DocumentReader.blocks(rows).map { it.kind },
        )
    }

    @Test fun adjacentRunsWithTheSameMarksJoin() {
        val runs = DocumentReader.runs(listOf(WireSpan("a"), WireSpan("b"), WireSpan(""), WireSpan("c", mapOf("code" to "true"))))
        assertEquals(listOf("ab", "c"), runs.map { it.text })
        assertTrue(runs[1].code)
    }

    @Test fun onlyBlobReferencesAreImages() {
        assertNull(DocumentReader.blobId("https://example.com/a.png"))
        assertNull(DocumentReader.blobId("blob:abc"))
        assertEquals("a".repeat(64), DocumentReader.blobId("blob:" + "a".repeat(64)))
    }

    @Test fun blockAttrsDefaultsAndColours() {
        val blocks =
            DocumentReader.blocks(
                listOf(
                    WireBlock("1", "checkListItem", attrs = mapOf("checked" to "true", "textAlignment" to "center", "textColor" to "default")),
                    WireBlock("2", "heading"),
                    WireBlock("3", "codeBlock", attrs = mapOf("language" to "rust", "backgroundColor" to "blue")),
                ),
            )
        assertEquals(BlockKind.Check(true), blocks[0].kind)
        assertEquals(BlockAlignment.CENTER, blocks[0].alignment)
        assertNull(blocks[0].textColor)
        assertEquals(BlockKind.Heading(1), blocks[1].kind)
        assertEquals(BlockKind.Code("rust"), blocks[2].kind)
        assertEquals("blue", blocks[2].backgroundColor)
    }
}

class CommentTest {
    @Test fun bodiesRoundTrip() {
        assertEquals("[[block:b1]] hi", CommentBody.encode("  hi ", blockId = "b1"))
        assertEquals("[[reply:c1]] ok", CommentBody.encode("ok", replyTo = "c1"))
        assertEquals("doc-wide", CommentBody.encode("doc-wide"))
        assertEquals(CommentBody.Parsed("hi", blockId = "b1"), CommentBody.parse("[[block:b1]] hi"))
        assertEquals("c1", CommentBody.parse("[[reply:c1]] ok").replyTo)
        assertEquals("[[weird]] x", CommentBody.parse("[[weird]] x").text)
        assertEquals("plain", CommentBody.parse("plain").text)
    }

    @Test fun threadsGroupRepliesUnderTheirRoot() {
        val c =
            listOf(
                DocComment("r1", "a", 1u, "root", blockId = "b1"),
                DocComment("x", "b", 2u, "re", replyTo = "r1"),
                DocComment("y", "a", 3u, "re re", replyTo = "x"),
                DocComment("r2", "b", 4u, "doc"),
                DocComment("z", "b", 5u, "orphan", replyTo = "gone"),
            )
        val threads = CommentBody.threads(c.reversed())
        assertEquals(listOf("r1", "r2", "z"), threads.map { it.id })
        assertEquals(listOf("x", "y"), threads[0].replies.map { it.id })
        assertEquals(mapOf("b1" to 3), CommentBody.countsByBlock(threads))
    }
}

class FormatTest {
    @Test fun docLinksMatchTheWebAndParseBack() {
        val t = DocTarget("ws1", "g1", "d1", "b9")
        val link = DocsFormat.docLink(t)
        assertEquals("https://mero-docs.vercel.app/app/ws1/f/g1/d/d1#b=b9", link)
        assertEquals(t, DocsFormat.parseDocLink(link))
        assertEquals(DocTarget("ws1", "g1", "d1"), DocsFormat.parseDocLink("http://localhost:2428/1.2.0/app/ws1/f/g1/d/d1"))
        assertNull(DocsFormat.parseDocLink("https://mero-docs.vercel.app/app/ws1/f/g1"))
    }

    @Test fun linkTargets() {
        assertEquals(LinkTarget.Member("ab".repeat(32)), DocsFormat.linkTarget("/app/ws1/m/" + "AB".repeat(32)))
        assertEquals(LinkTarget.Web("https://example.com"), DocsFormat.linkTarget("https://example.com"))
        assertEquals(LinkTarget.None, DocsFormat.linkTarget("javascript:alert(1)"))
    }

    @Test fun snippetPieces() {
        val pieces = DocsFormat.snippetPieces("a <b>match</b> &amp; <i>x</i>")
        assertEquals(listOf("a ", "match", " & ", "x"), pieces.map { it.first })
        assertEquals(listOf(false, true, false, false), pieces.map { it.second })
    }

    @Test fun relativeTime() {
        val now = 1_700_000_000_000L
        assertEquals("just now", DocsFormat.relativeTime(1_699_999_990_000_000_000UL, now))
        assertEquals("1h ago", DocsFormat.relativeTime(1_699_996_400_000_000_000UL, now))
        assertEquals("", DocsFormat.relativeTime(0UL, now))
    }
}

class ModelTest {
    private fun ws() = Workspace(FakeDocs.WS, "Acme", 3)

    private fun RecordedContractCall.arg(key: String) = (args as kotlinx.serialization.json.JsonObject)[key]?.jsonPrimitive?.content

    @Test fun workspacesAreNamedAndSorted() =
        runTest {
            val fake = FakeDocs()
            fake.backend.namespaces = listOf(AppNamespace("z", "Zeta", "a"), AppNamespace("f".repeat(64), " ", "a"))
            val model = WorkspacesModel(fake.backend)
            model.load()
            assertEquals(listOf("Workspace ffff…ffff", "Zeta"), model.workspaces.value.map { it.name })
            assertEquals(LoadState.Loaded, model.state.value)
        }

    @Test fun workspaceWalksTheTreeJoinsOpenFoldersAndListsDocs() =
        runTest {
            val fake = FakeDocs()
            fake.standardWorkspace()
            val model = WorkspaceModel(fake.backend, ws(), MemoryRecents())
            model.load()
            assertEquals(LoadState.Loaded, model.state.value)
            assertEquals(listOf("Notes", "Product"), model.folders(null).map { it.name })
            assertEquals(listOf("Specs"), model.folders("g-product").map { it.name })
            assertEquals(listOf("Standup notes", "Roadmap", "API spec"), model.recentlyUpdated.map { it.title })
            assertTrue("joinContext c-specs" in fake.backend.log)
            assertEquals("c-specs", model.docs("g-specs").first().contextId)
        }

    @Test fun aFolderThatFailsIsReportedNotFatal() =
        runTest {
            val fake = FakeDocs()
            fake.standardWorkspace()
            fake.on("list_docs", "c-notes", """{"oops":1}""")
            val model = WorkspaceModel(fake.backend, ws(), MemoryRecents())
            model.load()
            assertEquals(LoadState.Loaded, model.state.value)
            assertNotNull(model.issues.value["g-notes"])
            assertEquals(2, model.docs.value.size)
        }

    @Test fun searchRanksIndexHitsThenTitleMatches() =
        runTest {
            val fake = FakeDocs()
            fake.standardWorkspace()
            fake.on("search_docs", "c-specs", """{"hits":[{"id":"d3","title":"API spec","snippet":"the <b>road</b>","score":2.0,"archived":false}],"total":1,"next_cursor":null}""")
            fake.on("search_docs", json = """{"hits":[],"total":0}""")
            val model = WorkspaceModel(fake.backend, ws(), MemoryRecents())
            model.load()
            model.search("road")
            assertEquals(listOf("API spec", "Roadmap"), model.results.value.map { it.row.title })
            assertEquals(
                "the <b>road</b>",
                model.results.value
                    .first()
                    .snippet,
            )
            val call =
                fake.backend.recording
                    .calls("search_docs")
                    .first()
            assertEquals("road", call.arg("query"))
            assertEquals(RecordedContractCall.Path.QUERY, call.path)
            model.search("")
            assertTrue(model.results.value.isEmpty())
        }

    @Test fun documentOpensReadsBodyAndCommentsAndRecordsRecent() =
        runTest {
            val fake = FakeDocs()
            fake.standardWorkspace()
            fake.on("get_doc", json = FakeDocs.doc("d1", "Roadmap", 1))
            fake.on("get_document", json = FakeDocs.BODY)
            fake.on(
                "list_comments",
                json = "[${FakeDocs.comment("c1", "[[block:b2]] Why fast?", at = 1)},${FakeDocs.comment("c2", "[[reply:c1]] Because", FakeDocs.ME, 2)}]",
            )
            val recents = MemoryRecents()
            val model = DocumentModel(fake.backend, FakeDocs.WS, "g-product", "d1", recents = recents)
            model.open()
            assertEquals(DocumentModel.Phase.Ready, model.phase.value)
            assertEquals("c-product", model.contextId.value)
            assertEquals("Roadmap", model.title)
            assertEquals(6, model.blocks.value.size)
            assertEquals(1, model.threads.value.size)
            assertEquals(
                "b2",
                model.threads.value[0]
                    .root.blockId,
            )
            assertEquals(mapOf("b2" to 2), model.countsByBlock)
            assertEquals(
                "You",
                personName(
                    model.threads.value[0]
                        .replies[0]
                        .author,
                    model.account,
                ),
            )
            assertEquals("d1", recents.recent(FakeDocs.WS).first().docId)
            assertEquals("https://mero-docs.vercel.app/app/${FakeDocs.WS}/f/g-product/d/d1", model.shareLink)
            // Reads only: opening a document writes nothing.
            assertTrue(
                fake.backend.recording.calls
                    .all { it.path == RecordedContractCall.Path.QUERY },
            )
        }

    @Test fun commentingSendsThePrefixedBodyAndShowsItAtOnce() =
        runTest {
            val fake = FakeDocs()
            fake.standardWorkspace()
            fake.on("get_doc", json = FakeDocs.doc("d1", "Roadmap", 1))
            fake.on("get_document", json = FakeDocs.BODY)
            fake.on("list_comments", json = "[]")
            fake.on("add_comment", json = "\"new1\"")
            val model = DocumentModel(fake.backend, FakeDocs.WS, "g-product", "d1", contextId = "c-product")
            model.open()
            model.addComment("  Looks good ", "b3")
            val call =
                fake.backend.recording
                    .calls("add_comment")
                    .first()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals("c-product", call.contextId)
            assertEquals("[[block:b3]] Looks good", call.arg("body"))
            assertEquals("d1", call.arg("doc_id"))
            assertEquals(listOf("Looks good"), model.threads.value.map { it.root.text })
            model.reply("new1", "Thanks")
            assertEquals(
                "[[reply:new1]] Thanks",
                fake.backend.recording
                    .calls("add_comment")
                    .last()
                    .arg("body"),
            )
        }

    @Test fun documentInAFolderWithNoContextFails() =
        runTest {
            val fake = FakeDocs()
            fake.standardWorkspace()
            val model = DocumentModel(fake.backend, FakeDocs.WS, "g-missing", "d1")
            model.open()
            assertEquals(DocumentModel.Phase.Failed(FolderNotReadyException().message!!), model.phase.value)
        }

    @Test fun imagesLoadThroughTheBlobLoader() =
        runTest {
            val fake = FakeDocs()
            val model = DocumentModel(fake.backend, "w", "g", "d", contextId = "c", blobs = BlobLoading { id, ctx -> "$ctx/$id".toByteArray() })
            model.loadImage("ab")
            val state = model.images.value["ab"] as DocumentModel.ImageState.Loaded
            assertEquals("c/ab", String(state.bytes))
            val none = DocumentModel(fake.backend, "w", "g", "d", contextId = "c")
            none.loadImage("ab")
            assertEquals(DocumentModel.ImageState.Unavailable, none.images.value["ab"])
        }
}
