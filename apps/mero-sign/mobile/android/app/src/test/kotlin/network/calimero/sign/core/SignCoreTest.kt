package network.calimero.sign.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
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
    fun `ids decode from bytes or text and become hex`() {
        val json = Json { ignoreUnknownKeys = true }
        val signature = json.decodeFromString(DocumentSignature.serializer(), """{"signer":${bytes(IDs.alice)},"signed_at":1788952411519000123}""")
        assertEquals(IDs.alice, signature.signer.hex)
        assertEquals(1_788_952_411_519_000_123uL, signature.signedAt)
        assertEquals(IDs.alice, ContractBytes.Text(IDs.alice.uppercase()).hex)
        val base58 = InviteCodec.base58Encode(Hex.decode(IDs.blob, "b", 32))
        assertEquals(IDs.blob, ContractBytes.Text(base58).hex)
        assertTrue(SignIds.same(signature.signer, IDs.alice))
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
        assertEquals(1_700_000_000_000L, SignFormat.millis(1_700_000_000_000_000_000uL))
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
    fun `round trips in the web format and refuses another app`() {
        val invite = SignInvitation(InMemoryAppBackend.invitation(IDs.workspace), IDs.agreementContext, "Lease", "Acme")
        val link = invite.link()
        assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-sign/join?invitation="))
        val parsed = SignInvitation.parse(link)!!
        assertEquals(IDs.workspace, parsed.namespaceId)
        assertEquals(IDs.agreementContext, parsed.contextId)
        assertEquals("Lease", parsed.title)
        assertNotNull(SignInvitation.parse(invite.token()))
        assertNotNull(SignInvitation.parse("calimero://com.calimero.mero-sign/join?invitation=${invite.token()}"))
        assertNull(SignInvitation.parse("https://links.calimero.network/com.calimero.mero-forum/join?invitation=${invite.token()}"))
        assertNull(SignInvitation.parse("hello"))
    }

    @Test
    fun `reads an envelope and snake case`() {
        val inner = InMemoryAppBackend.invitation(IDs.workspace).raw
        val parsed = SignInvitation.parseJson("""{"data":{"invitation":$inner,"context_name":"NDA"}}""")!!
        assertEquals("NDA", parsed.contextName)
        assertNull(parsed.contextId)
    }
}

class PrivateStoreTest {
    @Test
    fun `creates the store as the web does`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            val admin = FakeSignAdmin()
            Script().apply { json("is_default_private_context", "true") }.install(backend)
            val store = PrivateStore(backend, admin, backend.applicationId)
            val id = store.ensure()
            val founded = backend.namespaces.first()
            assertEquals("Personal", founded.name)
            assertEquals("mero-sign:personal", admin.metadata[founded.id]?.data?.get("kind"))
            assertTrue(backend.log.any { it.startsWith("createSubgroup ${founded.id} Private") })
            assertFalse(backend.publicSubgroups.isNotEmpty())
            assertEquals(JsonObject(mapOf("is_private" to JsonPrimitive(true), "context_name" to JsonPrimitive("default"))), backend.initArgs[id])
            assertEquals(id, store.ensure())
            assertEquals(1, backend.log.count { it.startsWith("foundNamespace") })
        }

    @Test
    fun `finds an existing store by its marker and contract`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            backend.namespaces = listOf(AppNamespace(IDs.workspace, "Personal", "app"), AppNamespace(IDs.personal, "Personal", "app"))
            backend.subgroups = mapOf(IDs.personal to listOf(AppSubgroup(IDs.privateGroup, "Private", listOf(IDs.privateContext))))
            val admin = FakeSignAdmin().apply { metadata[IDs.personal] = GroupRecord("Personal", mapOf("kind" to "mero-sign:personal")) }
            Script().apply { json("is_default_private_context", "true", IDs.privateContext) }.install(backend)
            val store = PrivateStore(backend, admin, null)
            assertEquals(IDs.privateContext, store.find())
            assertFalse(backend.log.any { it.startsWith("foundNamespace") })
            assertFalse(store.isPersonal(IDs.workspace))
        }

    @Test
    fun `the library saves the png into the private context`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            val admin = FakeSignAdmin()
            val script =
                Script().apply {
                    json("is_default_private_context", "true")
                    json("create_signature", "42")
                }
            script.install(backend)
            val store = PrivateStore(backend, admin, "app", MemoryPrivateContextCache().apply { save(IDs.privateContext, IDs.me) })
            val png = byteArrayOf(-119, 80, 78, 71, 1, 2, 3)
            val saved = store.saveSignature(png, "Signature 1")
            assertEquals(42uL, saved.id)
            assertEquals(listOf(IDs.privateContext), admin.uploads)
            val call = backend.recording.calls("create_signature").single()
            assertEquals(IDs.privateContext, call.contextId)
            assertEquals("Signature 1", call.text("name"))
            assertEquals(saved.blobId, call.text("blob_id_str"))
            assertEquals(png.size.toString(), call.text("data_size"))
            script.json("list_signatures", """[{"id":42,"name":"Signature 1","blob_id":"${saved.blobId}","size":7,"created_at":5}]""")
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
                    json("is_default_private_context", "true")
                    json("get_context_details", detailsJson(name = "Lease (final)"))
                    fail("register_self_as_participant", "Already registered as participant")
                }.install(backend)
            val name = directory(backend).settle(IDs.agreementContext, "Lease")
            assertEquals("Lease (final)", name)
            assertEquals(
                IDs.agreementContext,
                backend.recording
                    .calls("register_self_as_participant")
                    .single()
                    .contextId,
            )
            val join = backend.recording.calls("join_shared_context").single()
            assertEquals(IDs.privateContext, join.contextId)
            assertEquals(RecordedContractCall.Path.EXECUTE, join.path)
            assertEquals(IDs.agreementContext, join.text("context_id_str"))
            assertEquals(IDs.me, join.text("shared_identity_str"))
            assertEquals("Lease (final)", join.text("context_name"))
        }

    @Test
    fun `waits while the agreement syncs`() =
        runTest {
            val backend = seededBackend()
            var asked = 0
            Script()
                .apply {
                    on("get_context_details") {
                        asked += 1
                        if (asked < 3) throw ContractFailure("Uninitialized")
                        detailsJson()
                    }
                }.install(backend)
            assertEquals("Lease", directory(backend).waitForState(IDs.agreementContext))
            assertEquals(3, asked)
        }

    @Test
    fun `entering joins the open subgroup`() =
        runTest {
            val backend = seededBackend().apply { members = emptySet() }
            directory(backend).enter(IDs.agreementContext)
            assertTrue(IDs.agreementContext in backend.members)
        }
}

class InboxTest {
    @Test
    fun `sorts documents into buckets`() =
        runTest {
            val backend = seededBackend()
            backend.subgroups = mapOf(IDs.workspace to backend.subgroups[IDs.workspace]!! + AppSubgroup(IDs.privateGroup, "Not yet opened", listOf(IDs.privateContext)))
            Script()
                .apply {
                    json("get_context_details", detailsJson())
                    json("whoami", bytes(IDs.me))
                    json(
                        "list_documents",
                        "[${documentJson("doc_a", "h1")},${documentJson("doc_b", "h2", "PartiallySigned")},${documentJson("doc_c", "h3", "FullySigned")}]",
                    )
                    on("get_document_signatures") { call -> if (call.text("document_id") == "doc_b") """[{"signer":"${IDs.me}","signed_at":7}]""" else "[]" }
                }.install(backend)
            val model = InboxModel(directory(backend))
            model.load()
            assertEquals(LoadPhase.Loaded, model.phase.value)
            assertEquals(listOf("doc_a"), model.entries(InboxBucket.TO_SIGN).map { it.document.id })
            assertEquals(listOf("doc_b"), model.entries(InboxBucket.WAITING).map { it.document.id })
            assertEquals(listOf("doc_c"), model.entries(InboxBucket.COMPLETED).map { it.document.id })
            assertEquals(listOf("Not yet opened"), model.unopened.value.map { it.name })
            val waiting = model.entries(InboxBucket.WAITING).single()
            assertEquals("1 of 2 signed", SignFormat.progress(waiting))
            assertEquals(1_788_952_411_519_000_000uL, waiting.document.uploadedAt)
            assertFalse(backend.recording.calls("get_document_signatures").any { it.text("document_id") == "doc_c" })
        }

    @Test
    fun `a viewer only waits`() =
        runTest {
            val backend = seededBackend()
            Script()
                .apply {
                    json("get_context_details", detailsJson(listOf(IDs.me to "Read", IDs.alice to "Admin")))
                    json("whoami", "\"${IDs.me}\"")
                    json("list_documents", "[${documentJson(hash = "h", required = listOf(IDs.alice))}]")
                    json("get_document_signatures", "[]")
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
        val admin = FakeSignAdmin()
        val pdf = "%PDF-1.4 sample".toByteArray()
        admin.blobs[IDs.blob] = pdf to IDs.agreementContext
        val script =
            Script().apply {
                json("is_default_private_context", "true")
                json("get_context_details", detailsJson())
                json("whoami", bytes(IDs.me))
                json("list_documents", "[${documentJson(hash = DocumentHash.sha256Hex(pdf))}]")
                json("get_document_signatures", "[]")
                json("has_consented", if (consented) "true" else "false")
                json("list_signatures", "[]")
                json("create_signature", "9")
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
                    .calls("has_consented")
                    .single()
                    .text("user_id_str"),
            )
            model.giveConsent()
            assertEquals(SigningStep.CHOOSE, model.step.value)
            assertEquals(
                "doc_1",
                backend.recording
                    .calls("set_consent")
                    .single()
                    .text("document_id"),
            )
            val png = byteArrayOf(1, 2, 3)
            model.choose(png, isNew = true)
            model.submit(SignaturePlacement(0, Box(380f, 680f, 150f, 50f)), saveToLibrary = true)
            assertNull(model.error.value)
            assertEquals(SigningStep.DONE, model.step.value)
            assertEquals(listOf(IDs.agreementContext, IDs.privateContext), admin.uploads)
            val sign = backend.recording.calls("sign_document").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, sign.path)
            assertEquals("doc_1", sign.text("document_id"))
            assertEquals(DocumentHash.sha256Hex(admin.blobs[IDs.blob]!!.first), sign.text("base_hash"))
            val signed = admin.blobs[sign.text("pdf_blob_id_str")]!!.first
            assertEquals(DocumentHash.sha256Hex(signed), sign.text("new_hash"))
            assertEquals(signed.size.toString(), sign.text("file_size"))
            assertNull(sign.arg("signer"))
            assertEquals(1, backend.recording.calls("mark_participant_signed").size)
            assertEquals(
                "Signature 1",
                backend.recording
                    .calls("create_signature")
                    .single()
                    .text("name"),
            )
        }

    @Test
    fun `a stale version is reloaded not lost`() =
        runTest {
            val (backend, _, pair) = setUp(consented = true)
            val (script, model) = pair
            script.fail("sign_document", "This document changed while you were signing it: you started from a, but it is now at b.")
            model.load()
            model.loadPdf()
            model.beginSigning()
            assertEquals(SigningStep.CHOOSE, model.step.value)
            model.choose(byteArrayOf(1), isNew = false)
            model.submit(SignaturePlacement(0, Box(0f, 0f, 90f, 30f)), saveToLibrary = true)
            assertEquals(SigningStep.IDLE, model.step.value)
            assertTrue(model.error.value!!.contains("sign again"))
            assertTrue(backend.recording.calls("mark_participant_signed").isEmpty())
            assertTrue(backend.recording.calls("set_consent").isEmpty())
        }
}

class InvitationFlowTest {
    @Test
    fun `joins the workspace, enters the agreement and settles`() =
        runTest {
            val backend = InMemoryAppBackend(account = IDs.me)
            backend.subgroups = mapOf(IDs.workspace to listOf(AppSubgroup(IDs.agreementGroup, "Lease", listOf(IDs.agreementContext))))
            Script()
                .apply {
                    json("is_default_private_context", "true")
                    json("get_context_details", detailsJson())
                }.install(backend)
            val dir = directory(backend)
            val model = InvitationModel(findAttempts = 2, findDelayMs = 0)
            val invite = SignInvitation(InMemoryAppBackend.invitation(IDs.workspace), IDs.agreementContext, "Lease", "Acme")
            assertTrue(model.open(invite.link()))
            assertEquals(InvitationModel.Stage.Confirm("Lease"), model.stage.value)
            var joined = false
            model.accept({ dir }, { joined = true })
            assertTrue(joined)
            assertTrue("joinNamespace ${IDs.workspace}" in backend.log)
            assertTrue(IDs.agreementContext in backend.members)
            assertEquals(1, backend.recording.calls("register_self_as_participant").size)
            assertEquals(
                IDs.privateContext,
                backend.recording
                    .calls("join_shared_context")
                    .single()
                    .contextId,
            )
            val stage = model.stage.value as InvitationModel.Stage.Joined
            assertEquals(IDs.agreementContext, stage.destination.agreement?.contextId)
            assertEquals("Acme", stage.destination.workspaceName)
        }
}
