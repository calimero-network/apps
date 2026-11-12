package network.calimero.docs

import com.calimero.mero.AppError
import com.calimero.mero.CalimeroError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.WrongNode
import com.calimero.mero.api.models.Org
import com.calimero.mero.api.models.Team
import com.calimero.mero.api.models.TeamJoin
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
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
import network.calimero.docs.core.DocDto
import network.calimero.docs.core.DocSearchPage
import network.calimero.docs.core.DocTarget
import network.calimero.docs.core.DocsContract
import network.calimero.docs.core.DocsDirectory
import network.calimero.docs.core.DocsFormat
import network.calimero.docs.core.DocumentReader
import network.calimero.docs.core.LinkTarget
import network.calimero.docs.core.WireBlock
import network.calimero.docs.core.WireSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

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
            fake.on("listDocs", "c-notes", """{"oops":1}""")
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
            fake.on("searchDocs", "c-specs", """{"hits":[{"id":"d3","title":"API spec","snippet":"the <b>road</b>","score":2.0,"archived":false}],"total":1,"nextCursor":null}""")
            fake.on("searchDocs", json = """{"hits":[],"total":0}""")
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
                    .calls("searchDocs")
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
            fake.on("getDoc", json = FakeDocs.doc("d1", "Roadmap", 1))
            fake.on("getDocument", json = FakeDocs.BODY)
            fake.on(
                "listComments",
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
            fake.on("getDoc", json = FakeDocs.doc("d1", "Roadmap", 1))
            fake.on("getDocument", json = FakeDocs.BODY)
            fake.on("listComments", json = "[]")
            fake.on("addComment", json = "\"new1\"")
            val model = DocumentModel(fake.backend, FakeDocs.WS, "g-product", "d1", contextId = "c-product")
            model.open()
            model.addComment("  Looks good ", "b3")
            val call =
                fake.backend.recording
                    .calls("addComment")
                    .first()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals("c-product", call.contextId)
            assertEquals("[[block:b3]] Looks good", call.arg("body"))
            assertEquals("d1", call.arg("docId"))
            assertEquals(listOf("Looks good"), model.threads.value.map { it.root.text })
            model.reply("new1", "Thanks")
            assertEquals(
                "[[reply:new1]] Thanks",
                fake.backend.recording
                    .calls("addComment")
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

class WireTest {
    @Test fun docViewTimestampsAreMillisecondStrings() {
        val doc =
            Json.decodeFromString(
                DocDto.serializer(),
                """{"id":"doc-1","title":"T","tags":["k"],"archived":false,"createdAt":"1700000000123",""" +
                    """"updatedAt":"1700000000456","createdBy":"a","updatedBy":"b","canDelete":true}""",
            )
        assertEquals(1_700_000_000_123uL, doc.createdAt)
        assertEquals(1_700_000_000_456uL, doc.updatedAt)
        // The screens show them in nanoseconds, as the web adapter does.
        assertEquals(1_700_000_000_456_000_000uL, DocsFormat.nanos(doc.updatedAt))
        assertTrue(doc.canDelete)
    }

    @Test fun searchPageTotalIsADecimalString() {
        val page = Json.decodeFromString(DocSearchPage.serializer(), """{"hits":[],"total":"12","nextCursor":20}""")
        assertEquals(12uL, page.total)
        assertEquals(20u, page.nextCursor)
    }

    @Test fun foldersComeFromTheOrgsTeams() {
        val org =
            Org(
                orgId = "org1",
                name = "Acme",
                members = emptyMap(),
                teams =
                    mapOf(
                        "t-product" to team("t-product", "Product", null, TeamJoin.EVERYONE, meta("docsApp" to "app-product", "color" to "blue")),
                        "t-specs" to team("t-specs", "Specs", "t-product", TeamJoin.INVITE, meta("docsApp" to "app-specs")),
                        // Its parent is a team the caller does not see: it sits at the top.
                        "t-shared" to team("t-shared", "Board", "t-hidden", TeamJoin.INVITE, meta()),
                    ),
                defaultCapabilities = 0,
                capabilities = emptyMap(),
                approvedReleases = emptyList(),
                outboundApprovals = emptyMap(),
                metadata = JsonObject(emptyMap()),
                memberMetadata = emptyMap(),
                upgradeRuns = emptyMap(),
            )
        val folders = DocsDirectory.folders(org)
        assertEquals(listOf("t-product", "t-shared", "t-specs"), folders.map { it.id })
        assertEquals("t-product", folders.first { it.id == "t-specs" }.parentId)
        assertEquals("app-specs", folders.first { it.id == "t-specs" }.contextId)
        assertNull(folders.first { it.id == "t-shared" }.parentId)
        assertNull(folders.first { it.id == "t-shared" }.contextId)
    }

    /** Every method the client calls is in the component ABI, by name; skipped while it is still v1. */
    @Test fun clientMethodsAreInTheComponentAbi() {
        val file = File("../../../logic/res/abi.json")
        Assume.assumeTrue("logic/res/abi.json is not readable", file.isFile)
        val root = Json.parseToJsonElement(file.readText()).jsonObject
        Assume.assumeTrue("logic/res/abi.json is not the component ABI yet", root.containsKey("abiVersion"))
        val methods = root["methods"]!!.jsonObject
        for (name in DocsContract.METHODS) assertNotNull("$name is not in the ABI", methods[name])
        assertEquals("view", methods["listDocs"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        assertEquals("call", methods["addComment"]!!.jsonObject["kind"]!!.jsonPrimitive.content)
        val params = methods["addComment"]!!.jsonObject["params"]!!.jsonArray.map { it.jsonArray[0].jsonPrimitive.content }
        assertEquals(listOf("docId", "body"), params)
    }

    @Test fun calimero10ErrorsReadAsWords() {
        assertEquals("Your session ended. Sign in again.", DocsFormat.errorText(LoginRequired("expired")))
        assertEquals("The passkey prompt was cancelled. Nothing changed.", DocsFormat.errorText(ConfirmCancelled()))
        assertTrue(DocsFormat.errorText(WrongNode("x")).startsWith("This node doesn't serve your account."))
        assertTrue(
            DocsFormat
                .errorText(CalimeroError(403, "FORBIDDEN", "read only"))
                .startsWith("You can read this folder but not comment"),
        )

        fun app(
            code: String,
            message: String,
        ) = AppError(
            "",
            buildJsonObject {
                put("code", code)
                put("fields", buildJsonObject { put("message", message) })
            },
        )
        assertEquals("This document or comment is gone. Pull to refresh.", DocsFormat.errorText(app("NotFound", "no doc")))
        assertEquals("You can't do that in this folder.", DocsFormat.errorText(app("Forbidden", "")))
        assertEquals("That wasn't accepted: empty comment", DocsFormat.errorText(app("Invalid", "empty comment")))
    }

    private fun meta(vararg pairs: Pair<String, String>) = JsonObject(pairs.associate { it.first to JsonPrimitive(it.second) })

    /** A team as `orgs.get` answers it. */
    private fun team(
        id: String,
        name: String,
        parent: String?,
        join: TeamJoin,
        metadata: JsonObject,
    ) = Team(
        teamId = id,
        name = name,
        parent = parent,
        join = join,
        members = emptyMap(),
        readOnly = emptyList(),
        capabilities = emptyMap(),
        metadata = metadata,
        removed = emptyList(),
    )
}
