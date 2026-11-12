package network.calimero.stream

import com.calimero.mero.AppError
import com.calimero.mero.CloudEvent
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentRequest
import com.calimero.mero.ConsentResult
import com.calimero.mero.ConsentScope
import com.calimero.mero.ConsentStale
import com.calimero.mero.ConsentStarted
import com.calimero.mero.Governance
import com.calimero.mero.LoginRequired
import com.calimero.mero.NotFound
import com.calimero.mero.PendingApprovals
import com.calimero.mero.PendingRelease
import com.calimero.mero.PendingUpgrade
import com.calimero.mero.ReleaseDeadline
import com.calimero.mero.ReportScope
import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.confirmationCode
import com.calimero.mero.invite.InviteLink
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import network.calimero.stream.app.ApprovalItem
import network.calimero.stream.app.ApprovalsModel
import network.calimero.stream.core.CalimeroMediaChannel
import network.calimero.stream.core.ErrorText
import network.calimero.stream.core.Member
import network.calimero.stream.core.StreamContract
import network.calimero.stream.core.StreamInvitation
import network.calimero.stream.core.streamClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What changed for Calimero 1.0: presence media, the invitation link, errors, the contract surface. (As the iOS `Calimero10Tests`.) */
class Calimero10Test {
    @Test fun `presence events become slices`() {
        val snapshot =
            CloudEvent(
                "1",
                "snapshot",
                buildJsonArray {
                    add(
                        buildJsonObject {
                            put("account", "ana")
                            put("device", "d1")
                            put("state", "4d53")
                        },
                    )
                    add(
                        buildJsonObject {
                            put("account", "bo")
                            put("device", "d2")
                            put("state", JsonNull)
                        },
                    )
                },
            )
        val seeded = CalimeroMediaChannel.slices(snapshot)
        assertEquals(listOf("ana", "bo"), seeded.map { it.author })
        assertArrayEquals(byteArrayOf(0x4d, 0x53), seeded[0].bytes)
        assertEquals(0L, seeded[0].ageMs)
        assertTrue(seeded[1].removed)
        val live =
            CalimeroMediaChannel.slices(
                CloudEvent(
                    "2",
                    "presence",
                    buildJsonObject {
                        put("account", "ana")
                        put("state", "0102")
                    },
                ),
            )
        assertArrayEquals(byteArrayOf(1, 2), live.single().bytes)
        assertNull(live.single().ageMs)
        assertEquals(emptyList<Any>(), CalimeroMediaChannel.slices(CloudEvent("4", "presence", JsonPrimitive("x"))))
    }

    @Test fun `the presence seq grows from the clock`() {
        var now = 5_000_000L
        val channel = CalimeroMediaChannel(com.calimero.mero.CalimeroClient(com.calimero.mero.CalimeroClientOptions("http://localhost:1", policy = com.calimero.mero.CloudPolicy.development)), "me", { now })
        assertEquals(5_000_000L, channel.nextSeq())
        assertEquals(5_000_001L, channel.nextSeq())
        now = 9_000_000L
        assertEquals(9_000_000L, channel.nextSeq())
    }

    @Test fun `the link is an org invitation and pre-1_0 links are refused`() {
        val invitation =
            StreamInvitation(OrgInvitation("org1", "inv_abc"), StreamInvitation.Kind.ROOM, "Studio", "app1", "app1", "Daily")
        val link = invitation.link()
        val token = InviteLink.tokenFromPasted(link)!!
        assertEquals(OrgInvitation("org1", "inv_abc", "app1", "Daily"), OrgInvitation.decode(token))
        val parsed = StreamInvitation.parse(link)!!
        assertTrue(parsed.opensRoom)
        assertEquals("Studio", parsed.namespaceName)
        val old = """{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"s"},"kind":"namespace","groupId":"aa"}"""
        assertNull(StreamInvitation.parseJson(old))
    }

    @Test fun `a web link pasted from the browser opens`() {
        val stream = StreamInvitation.parse("https://stream.example/?invite=inv_abc&stream=org1&name=Studio+One")!!
        assertEquals("org1", stream.namespaceId)
        assertEquals("inv_abc", stream.invitation.token)
        assertEquals("Studio One", stream.namespaceName)
        assertFalse(stream.opensRoom)
        val room = StreamInvitation.parse("https://stream.example/?invite=inv_abc&stream=org1&room=app1&name=Daily")!!
        assertTrue(room.opensRoom)
        assertEquals("app1", room.roomId)
        assertEquals("Daily", room.roomName)
    }

    @Test fun `the node's errors and the contract's refusals read as words`() {
        assertEquals(
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.",
            ErrorText.describe(com.calimero.mero.ReleaseDeadlineError("deadline", buildJsonObject { put("release", "2.3.110") })),
        )
        assertEquals("This isn't shared with you, or it was deleted.", ErrorText.describe(NotFound("no such app")))
        assertEquals("Your session ended. Sign in again.", ErrorText.describe(LoginRequired("expired")))
        assertEquals("Join the room before you take part in its call.", ErrorText.describe(AppError("refused", buildJsonObject { put("code", "NotJoined") })))
        assertEquals(
            "A frame was too large for the room (limit 4096 bytes).",
            ErrorText.describe(
                AppError(
                    "refused",
                    buildJsonObject {
                        put("code", "ChunkTooLarge")
                        put("fields", buildJsonObject { put("max", 4096) })
                    },
                ),
            ),
        )
        assertEquals("The passkey prompt was cancelled. Nothing changed.", ErrorText.describe(ConfirmCancelled()))
        assertEquals("That approval is out of date. Refresh and review it again.", ErrorText.describe(ConsentStale("stale")))
    }

    /** The methods the phone calls, as the component ABI (`logic/res/abi.json`) names them. */
    @Test fun `the client calls the component surface`() =
        runTest {
            assertEquals(mapOf("join" to listOf("username", "now"), "getMembers" to emptyList()), StreamContract.METHODS)
            val backend = InMemoryAppBackend()
            backend.recording.handler = {
                if (it.method == "join") {
                    buildJsonObject {
                        put("memberId", "a")
                        put("username", "Ana")
                        put("joinedAt", "1700000000")
                        put("updatedAt", "1700000001")
                    }
                } else {
                    JsonArray(emptyList())
                }
            }
            val member = Member.from(streamClient(backend, "c1").join("Ana", 1_700_000_000uL))
            assertEquals(1_700_000_000L, member.joinedAt)
            assertEquals(1_700_000_001L, member.updatedAt)
            assertEquals(
                JsonPrimitive("1700000000"),
                backend.recording
                    .calls("join")
                    .first()
                    .args.jsonObject["now"],
            )
            streamClient(backend, "c1").getMembers()
            assertEquals(1, backend.recording.calls("getMembers").size)
        }
}

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ApprovalsTest {
    private fun pending(
        scope: ReportScope = ReportScope.Account,
        releasesActionable: Boolean = true,
    ) = PendingApprovals(
        scope = scope,
        governance = Governance(),
        approvedReleases = listOf("2.3.109"),
        releases =
            listOf(
                PendingRelease("2.3.110", 3, releasesActionable, "", "", ReleaseDeadline("2.3.110", "2026-11-30T00:00:00Z", 1_796_000_000)),
            ),
        upgrades = listOf(PendingUpgrade("app1", "Crate kit", "com.calimero.mero-stream", "1.0.0", "1.1.0", listOf("1.1.0"), true)),
        stalledBy = null,
        actionable = true,
    )

    @Test fun `the account's decisions become items`() {
        val items = ApprovalItem.from(pending())
        assertEquals(
            listOf(
                ApprovalItem.Release(ReportScope.Account, "2.3.110", "2026-11-30T00:00:00Z"),
                ApprovalItem.Upgrade("app1", "Crate kit", "1.0.0", "1.1.0"),
            ),
            items,
        )
        assertEquals("Upgrade Crate kit to 1.1.0", items[1].title)
        assertEquals(ConsentRequest.Release(ConsentScope.Account, "2.3.110", "mero-stream://consent"), items[0].request("mero-stream://consent"))
        assertEquals(listOf("upgrade:app1:1.1.0"), ApprovalItem.from(pending(releasesActionable = false)).map { it.id })
    }

    @Test fun `approving shows the code, then opens the consent page and rereads`() =
        runTest {
            val loads = mutableListOf<String?>()
            val asked = mutableListOf<ConsentRequest>()
            val model =
                ApprovalsModel(
                    load = { scope ->
                        loads += scope
                        if (scope == "denied") error("not an owner")
                        if (scope == null) pending() else pending(ReportScope.org("org1"))
                    },
                    consent = { build, confirm ->
                        asked += build("mero-stream://consent")
                        if (confirm(ConsentStarted("r1", "https://n/consent/r1", 0, "ABC-DEF"))) ConsentResult("r1", "release", "approved") else null
                    },
                )
            model.refresh(listOf("org1", "denied"))
            assertEquals(listOf(null, "org1", "denied"), loads)
            assertEquals(3, model.items.value.size)
            val approving = async { model.approve(model.items.value[0]) }
            runCurrent()
            assertEquals("ABC-DEF", model.confirmation.value?.code)
            model.answerConfirmation(true)
            approving.await()
            assertNull(model.confirmation.value)
            assertEquals(listOf(ConsentRequest.Release(ConsentScope.Account, "2.3.110", "mero-stream://consent")), asked)
            assertEquals("Approved.", model.message.value)
            assertNull(model.busy.value)
            assertEquals(6, loads.size)
        }

    @Test fun `declining the code opens nothing`() =
        runTest {
            val model =
                ApprovalsModel(
                    load = { pending() },
                    consent = { _, confirm ->
                        assertFalse(confirm(ConsentStarted("r2", "https://n/consent/r2")))
                        null
                    },
                )
            model.refresh()
            val approving = async { model.approve(model.items.value[0]) }
            runCurrent()
            // A node that sent no code: the app derives it from the request id, as the page does.
            assertEquals(confirmationCode("r2"), model.confirmation.value?.code)
            model.answerConfirmation(false)
            approving.await()
            assertEquals("Not opened. Nothing changed.", model.message.value)
        }
}
