package network.calimero.sign.core

import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.LoginRequired
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.crypto.Hex
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.sign.generated.ContractBytes
import network.calimero.sign.generated.DocumentSignature
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SupportTest {
    @Test
    fun `ids decode from text and u64s from decimal strings`() {
        val json = Json { ignoreUnknownKeys = true }
        val signature = json.decodeFromString(DocumentSignature.serializer(), """{"signer":"${IDs.alice}","signedAt":"18446744073709551615"}""")
        assertEquals(IDs.alice, ContractBytes.Text(signature.signer).hex)
        assertEquals(ULong.MAX_VALUE, signature.signedAt)
        assertEquals(IDs.alice, ContractBytes.Text(IDs.alice.uppercase()).hex)
        val base58 = InviteCodec.base58Encode(Hex.decode(IDs.blob, "b", 32))
        assertEquals(IDs.blob, ContractBytes.Text(base58).hex)
        assertTrue(SignIds.same(ContractBytes.Text(signature.signer), IDs.alice))
        assertEquals("", SignIds.blobHex("nope"))
        assertEquals("a1a1a1a1…a1a1a1", SignIds.short(IDs.alice))
    }

    @Test
    fun `integrity warns only on a mismatch`() {
        val data = "pdf".toByteArray()
        val hash = DocumentHash.sha256Hex(data)
        assertEquals(64, hash.length)
        assertNull(DocumentHash.integrityWarning(data, hash.uppercase()))
        assertNull(DocumentHash.integrityWarning(data, ""))
        assertNotNull(DocumentHash.integrityWarning("other".toByteArray(), hash))
    }

    @Test
    fun `formatting matches iOS`() {
        assertEquals("AL", SignFormat.initials("Ada Lovelace", IDs.alice))
        assertEquals("A1", SignFormat.initials(null, IDs.alice))
        assertEquals("signed-NDA.pdf", SignFormat.fileName("NDA", signed = true))
        assertEquals(1_700_000_000_000L, SignFormat.millis(1_700_000_000_000uL))
        assertEquals(7, ConsentText.ITEMS.size)
    }
}

class SigningGeometryTest {
    @Test
    fun `placement starts on the page and is clamped`() {
        val start = SignaturePlacement.initial(0, 612f, 792f, 3f)
        assertTrue(start.rect.x >= 0 && start.rect.right <= 612f && start.rect.bottom <= 792f)
        assertEquals(3f, start.rect.width / start.rect.height, 0.001f)
        val off = SignaturePlacement(0, Box(700f, -20f, 100f, 50f)).clamped(612f, 792f)
        assertEquals(612f, off.rect.right, 0.001f)
        assertEquals(0f, off.rect.y, 0.001f)
    }

    @Test
    fun `the image matrix puts the signature where it was placed, upright`() {
        val rect = Box(100f, 50f, 150f, 50f)
        // Unrotated: bottom-left of the image at (100, 792-50-50).
        assertArrayEquals(floatArrayOf(150f, 0f, 0f, 50f, 100f, 692f), SignaturePlacement.imageMatrix(rect, 0f, 0f, 612f, 792f, 0), 0.001f)
        // A crop box offset moves it with the page.
        assertArrayEquals(floatArrayOf(150f, 0f, 0f, 50f, 110f, 712f), SignaturePlacement.imageMatrix(rect, 10f, 20f, 612f, 792f, 0), 0.001f)
        // /Rotate 90: shown x runs along user y, shown y along user x.
        val m = SignaturePlacement.imageMatrix(rect, 0f, 0f, 612f, 792f, 90)
        assertArrayEquals(floatArrayOf(0f, 150f, -50f, 0f, 100f, 100f), m, 0.001f)
    }

    @Test
    fun `ink strokes smooth, undo and clear`() {
        val ink = SignatureInk()
        assertTrue(ink.isEmpty)
        ink.begin(SignatureInk.Point(0f, 0f, 0))
        ink.add(SignatureInk.Point(0.5f, 0f, 10)) // too close: dropped
        (1..19).forEach { ink.add(SignatureInk.Point(it * 6f, (it % 3) * 4f, it * 10L)) }
        val segments = SignatureInk.segments(ink.strokes[0])
        assertEquals(ink.strokes[0].size - 1, segments.size)
        segments.zipWithNext { a, b -> assertEquals(a.toX, b.fromX, 0f) }
        assertEquals(9f, segments[0].toX, 0.001f)
        segments.forEach { assertTrue(it.width in SignatureInk.MIN_WIDTH..SignatureInk.MAX_WIDTH) }
        ink.begin(SignatureInk.Point(50f, 50f, 1000))
        ink.undo()
        assertEquals(1, ink.strokes.size)
        ink.clear()
        assertTrue(ink.isEmpty)
    }
}

class InvitationCodecTest {
    @Test
    fun `round trips in the SDK link shape and refuses another app`() {
        val invite = SignInvitation(OrgInvitation(IDs.workspace, "inv_abc", IDs.agreementContext, "Lease"), "Acme")
        val link = invite.link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-sign/join?invitation="))
        val parsed = SignInvitation.parse(link)!!
        assertEquals(IDs.workspace, parsed.namespaceId)
        assertEquals(IDs.agreementContext, parsed.contextId)
        assertEquals("Lease", parsed.title)
        assertEquals("Acme", parsed.workspaceName)
        assertEquals(IDs.agreementContext, OrgInvitation.decode(invite.token())?.contextId)
        assertNotNull(SignInvitation.parse("calimero://com.calimero.mero-sign/join?invitation=${invite.token()}"))
        assertNull(SignInvitation.parse("https://links.calimero.network/com.calimero.mero-forum/join?invitation=${invite.token()}"))
        assertNull(SignInvitation.parse("hello"))
        val old = """{"invitation":{"invitation":{"group_id":[170]},"inviter_signature":"sig"},"contextId":"c"}"""
        assertNull(SignInvitation.parseJson(old))
    }

    @Test
    fun `reads the web app's invite link`() {
        val parsed = SignInvitation.parse("https://sign.example.com/?invite=inv_abc123&agreement=${IDs.agreementContext}")!!
        assertEquals("inv_abc123", parsed.invitation.token)
        assertEquals(IDs.agreementContext, parsed.contextId)
        assertEquals("", parsed.namespaceId)
        assertEquals("inv_abc123", SignInvitation.parse("inv_abc123")?.invitation?.token)
    }

    @Test
    fun `refusals read as plain words`() {
        assertEquals("Only admins may do this.", SignErrorText.describe(appError("Forbidden", "only admins may do this")))
        assertEquals("The passkey prompt was cancelled, so nothing changed.", SignErrorText.describe(ConfirmCancelled()))
        assertTrue(SignErrorText.isConflict(appError("Conflict", "already registered")))
        assertEquals("Your session ended. Sign in again.", SignErrorText.describe(LoginRequired("expired")))
    }
}

class PrivateStoreTest {
    @Test
    fun `creates the library as the web does`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            val admin = FakeSignAdmin()
            var setUp = false
            Script()
                .apply {
                    on("isDefaultPrivateContext") { if (setUp) "true" else "false" }
                    on("setup") {
                        setUp = true
                        "null"
                    }
                }.install(backend)
            val store = PrivateStore(backend, admin)
            val id = store.ensure()
            assertEquals(listOf("mero-sign:library" to null), admin.created)
            val setup = backend.recording.calls("setup").single()
            assertEquals(id, setup.contextId)
            assertEquals(JsonObject(mapOf("isPrivate" to JsonPrimitive(true), "contextName" to JsonPrimitive("default"))), setup.args)
            assertEquals(id, store.ensure())
            assertEquals(1, admin.created.size)
        }

    @Test
    fun `finds the account's own library only`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            val admin =
                FakeSignAdmin().apply {
                    instanceList += SignInstance(IDs.agreementContext, "mero-sign:library", IDs.me, IDs.workspace)
                    instanceList += SignInstance(IDs.personal, "mero-sign:library", IDs.alice, null)
                    instanceList += SignInstance(IDs.privateContext, "mero-sign:library", IDs.me, null)
                }
            Script().apply { json("isDefaultPrivateContext", "true") }.install(backend)
            assertEquals(IDs.privateContext, PrivateStore(backend, admin).find())
            assertTrue(admin.created.isEmpty())
        }

    @Test
    fun `the library saves the png into the private library`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            val admin = FakeSignAdmin()
            val script =
                Script().apply {
                    json("isDefaultPrivateContext", "true")
                    json("createSignature", "\"42\"")
                }
            script.install(backend)
            val store = PrivateStore(backend, admin, MemoryPrivateContextCache().apply { save(IDs.privateContext, IDs.me) })
            val png = byteArrayOf(-119, 80, 78, 71, 1, 2, 3)
            val saved = store.saveSignature(png, "Signature 1")
            assertEquals(42uL, saved.id)
            assertEquals(listOf(IDs.privateContext), admin.uploads)
            assertEquals(listOf("image/png"), admin.contentTypes)
            val call = backend.recording.calls("createSignature").single()
            assertEquals(IDs.privateContext, call.contextId)
            assertEquals("Signature 1", call.text("name"))
            assertEquals(saved.blobId, call.text("blobIdStr"))
            assertEquals(JsonPrimitive(png.size.toString()), call.arg("dataSize"))
            script.json("listSignatures", """[{"id":"42","name":"Signature 1","blobId":"${saved.blobId}","size":"7","createdAt":"5"}]""")
            assertArrayEquals(png, store.signatures().single().png)
        }
}

class SettleTest {
    @Test
    fun `settling registers and records the identity mapping`() =
        runTest {
            val backend = seededBackend()
            Script()
                .apply {
                    json("isDefaultPrivateContext", "true")
                    json("getContextDetails", detailsJson(name = "Lease (final)"))
                    json("listParticipants", "[${quoted(IDs.alice)}]")
                    on("registerSelfAsParticipant") { throw appError("Conflict", "already registered") }
                }.install(backend)
            val name = directory(backend).settle(IDs.agreementContext, "Lease")
            assertEquals("Lease (final)", name)
            assertEquals(
                IDs.agreementContext,
                backend.recording
                    .calls("registerSelfAsParticipant")
                    .single()
                    .contextId,
            )
            val join = backend.recording.calls("joinSharedContext").single()
            assertEquals(IDs.privateContext, join.contextId)
            assertEquals(RecordedContractCall.Path.EXECUTE, join.path)
            assertEquals(IDs.agreementContext, join.text("contextIdStr"))
            assertEquals(IDs.me, join.text("sharedIdentityStr"))
            assertEquals("Lease (final)", join.text("contextName"))
        }

    @Test
    fun `waits while the agreement syncs`() =
        runTest {
            val backend = seededBackend()
            var asked = 0
            Script()
                .apply {
                    on("getContextDetails") {
                        asked += 1
                        if (asked < 3) throw ContractFailure("Uninitialized")
                        detailsJson()
                    }
                }.install(backend)
            assertEquals("Lease", directory(backend).waitForState(IDs.agreementContext))
            assertEquals(3, asked)
        }

    @Test
    fun `agreements are the workspace's instances`() =
        runTest {
            val backend = seededBackend()
            val admin = seededAdmin().apply { instanceList += SignInstance(IDs.privateContext, "mero-sign:library", IDs.me, null) }
            assertEquals(listOf(agreementRef), directory(backend, admin).allAgreements())
        }

    @Test
    fun `entering needs the agreement to be reachable`() =
        runTest {
            val backend = seededBackend().apply { members = emptySet() }
            assertTrue(runCatching { directory(backend).enter(IDs.agreementContext) }.isFailure)
            backend.members = setOf(IDs.agreementContext)
            directory(backend).enter(IDs.agreementContext)
        }
}

class InboxTest {
    @Test
    fun `sorts documents into buckets`() =
        runTest {
            val backend = seededBackend()
            val admin = seededAdmin().apply { instanceList += SignInstance(IDs.privateContext, "Not yet opened", IDs.alice, IDs.workspace) }
            Script()
                .apply {
                    json("getContextDetails", detailsJson())
                    json("listParticipants", "[${quoted(IDs.me)}]", IDs.agreementContext)
                    json("listParticipants", "[${quoted(IDs.alice)}]", IDs.privateContext)
                    json("whoami", quoted(IDs.me))
                    json(
                        "listDocuments",
                        "[${documentJson("doc_a", "h1")},${documentJson("doc_b", "h2", "PartiallySigned")},${documentJson("doc_c", "h3", "FullySigned")}]",
                    )
                    on("getDocumentSignatures") { call -> if (call.text("documentId") == "doc_b") """[{"signer":"${IDs.me}","signedAt":"7"}]""" else "[]" }
                }.install(backend)
            val model = InboxModel(directory(backend, admin))
            model.load()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            assertEquals(listOf("doc_a"), model.entries(InboxBucket.TO_SIGN).map { it.document.id })
            assertEquals(listOf("doc_b"), model.entries(InboxBucket.WAITING).map { it.document.id })
            assertEquals(listOf("doc_c"), model.entries(InboxBucket.COMPLETED).map { it.document.id })
            assertEquals(listOf("Not yet opened"), model.unopened.value.map { it.name })
            val waiting = model.entries(InboxBucket.WAITING).single()
            assertEquals("1 of 2 signed", SignFormat.progress(waiting))
            assertEquals(1_788_952_411_519uL, waiting.document.uploadedAt)
            assertFalse(backend.recording.calls("getDocumentSignatures").any { it.text("documentId") == "doc_c" })
        }

    @Test
    fun `a viewer only waits`() =
        runTest {
            val backend = seededBackend()
            Script()
                .apply {
                    json("getContextDetails", detailsJson(listOf(IDs.me to "Read", IDs.alice to "Admin")))
                    json("whoami", "\"${IDs.me}\"")
                    json("listParticipants", "[${quoted(IDs.me)}]")
                    json("listDocuments", "[${documentJson(hash = "h", required = listOf(IDs.alice))}]")
                    json("getDocumentSignatures", "[]")
                }.install(backend)
            val model = InboxModel(directory(backend))
            model.load()
            assertEquals(0, model.count(InboxBucket.TO_SIGN))
            assertEquals(1, model.count(InboxBucket.WAITING))
        }
}

class SigningTest {
    private fun setUp(consented: Boolean): Triple<InMemoryAppBackend, FakeSignAdmin, Pair<Script, DocumentModel>> {
        val backend = seededBackend()
        val admin = seededAdmin()
        val pdf = "%PDF-1.4 sample".toByteArray()
        admin.blobs[IDs.blob] = pdf to IDs.agreementContext
        val script =
            Script().apply {
                json("isDefaultPrivateContext", "true")
                json("getContextDetails", detailsJson())
                json("whoami", quoted(IDs.me))
                json("listParticipants", "[${quoted(IDs.me)}]")
                json("listDocuments", "[${documentJson(hash = DocumentHash.sha256Hex(pdf))}]")
                json("getDocumentSignatures", "[]")
                json("hasConsented", if (consented) "true" else "false")
                json("listSignatures", "[]")
                json("createSignature", "\"9\"")
            }
        script.install(backend)
        val dir = directory(backend, admin)
        return Triple(backend, admin, script to DocumentModel(dir, NameDirectory(admin), agreementRef, "doc_1", fakeStamper))
    }

    @Test
    fun `consent then sign records everything the web records`() =
        runTest {
            val (backend, admin, pair) = setUp(consented = false)
            val model = pair.second
            admin.names[IDs.alice] = "Alice"
            model.load()
            assertEquals(listOf(SignIds.short(IDs.me), "Alice"), model.signers.value.map { it.displayName })
            model.loadPdf()
            assertNull(model.integrityWarning.value)
            model.beginSigning()
            assertEquals(SigningStep.CONSENT, model.step.value)
            assertEquals(
                IDs.me,
                backend.recording
                    .calls("hasConsented")
                    .single()
                    .text("userIdStr"),
            )
            model.giveConsent()
            assertEquals(SigningStep.CHOOSE, model.step.value)
            assertEquals(
                "doc_1",
                backend.recording
                    .calls("setConsent")
                    .single()
                    .text("documentId"),
            )
            val png = byteArrayOf(1, 2, 3)
            model.choose(png, isNew = true)
            model.submit(SignaturePlacement(0, Box(380f, 680f, 150f, 50f)), saveToLibrary = true)
            assertNull(model.error.value)
            assertEquals(SigningStep.DONE, model.step.value)
            assertEquals(listOf(IDs.agreementContext, IDs.privateContext), admin.uploads)
            assertEquals(listOf("application/pdf", "image/png"), admin.contentTypes)
            val sign = backend.recording.calls("signDocument").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, sign.path)
            assertEquals("doc_1", sign.text("documentId"))
            assertEquals(DocumentHash.sha256Hex(admin.blobs[IDs.blob]!!.first), sign.text("baseHash"))
            val signed = admin.blobs[sign.text("pdfBlobIdStr")]!!.first
            assertEquals(DocumentHash.sha256Hex(signed), sign.text("newHash"))
            assertEquals(signed.size.toString(), sign.text("fileSize"))
            assertNull(sign.arg("signer"))
            assertEquals(1, backend.recording.calls("markParticipantSigned").size)
            assertEquals(
                "Signature 1",
                backend.recording
                    .calls("createSignature")
                    .single()
                    .text("name"),
            )
        }

    @Test
    fun `a stale version is reloaded not lost`() =
        runTest {
            val (backend, _, pair) = setUp(consented = true)
            val (script, model) = pair
            script.on("signDocument") { throw appError("Conflict", "this document changed while you were signing it") }
            model.load()
            model.loadPdf()
            model.beginSigning()
            assertEquals(SigningStep.CHOOSE, model.step.value)
            model.choose(byteArrayOf(1), isNew = false)
            model.submit(SignaturePlacement(0, Box(0f, 0f, 90f, 30f)), saveToLibrary = true)
            assertEquals(SigningStep.IDLE, model.step.value)
            assertTrue(model.error.value!!.contains("sign again"))
            assertTrue(backend.recording.calls("markParticipantSigned").isEmpty())
            assertTrue(backend.recording.calls("setConsent").isEmpty())
        }
}

class InvitationFlowTest {
    @Test
    fun `joins the workspace, enters the agreement and settles`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me).apply { members = setOf(IDs.agreementContext) }
            Script()
                .apply {
                    json("isDefaultPrivateContext", "true")
                    json("getContextDetails", detailsJson())
                    json("listParticipants", "[${quoted(IDs.alice)}]")
                }.install(backend)
            val dir = directory(backend)
            val model = InvitationModel(findAttempts = 2, findDelayMs = 0)
            val invite = SignInvitation(OrgInvitation(IDs.workspace, "inv_fake", IDs.agreementContext, "Lease"), "Acme")
            assertTrue(model.open(invite.link()))
            assertEquals(InvitationModel.Stage.Confirm("Lease"), model.stage.value)
            var joined = false
            model.accept({ dir }, { joined = true })
            assertTrue(joined)
            assertTrue("joinNamespace ${IDs.workspace}" in backend.log)
            assertEquals(1, backend.recording.calls("registerSelfAsParticipant").size)
            assertEquals(
                IDs.privateContext,
                backend.recording
                    .calls("joinSharedContext")
                    .single()
                    .contextId,
            )
            val stage = model.stage.value as InvitationModel.Stage.Joined
            assertEquals(IDs.agreementContext, stage.destination.agreement?.contextId)
            assertEquals("Acme", stage.destination.workspaceName)
        }
}
