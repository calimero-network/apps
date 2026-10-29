@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package network.calimero.updates

import com.calimero.mero.app.AppContextEvent
import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import network.calimero.updates.app.AsksModel
import network.calimero.updates.app.AudienceSummary
import network.calimero.updates.app.CompaniesModel
import network.calimero.updates.app.CompanyModel
import network.calimero.updates.app.CompanySummary
import network.calimero.updates.app.ComposerModel
import network.calimero.updates.app.FeedModel
import network.calimero.updates.app.InvitationLanding
import network.calimero.updates.app.PeopleModel
import network.calimero.updates.app.PostModel
import network.calimero.updates.app.QuestionsModel
import network.calimero.updates.app.SettingsModel
import network.calimero.updates.core.ComposerStart
import network.calimero.updates.core.ComposerState
import network.calimero.updates.core.UpdatesInvitation
import network.calimero.updates.generated.AskView
import network.calimero.updates.generated.CommentView
import network.calimero.updates.generated.ContributionView
import network.calimero.updates.generated.DraftView
import network.calimero.updates.generated.MeView
import network.calimero.updates.generated.Metric
import network.calimero.updates.generated.MetricPoint
import network.calimero.updates.generated.MetricSeries
import network.calimero.updates.generated.ReactionCount
import network.calimero.updates.generated.Section
import network.calimero.updates.generated.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class CompaniesModelTest {
    @Test
    fun `founds a company without an audience`() =
        runTest {
            val fake = FakeAudience()
            val model = CompaniesModel(fake.backend)
            val company = model.create("  Acme ")!!
            assertEquals(listOf("foundNamespace Acme"), fake.backend.log)
            assertEquals("Acme", company.name)
            assertEquals(listOf(company), model.companies.value)
            assertNull(model.hostingNote.value)
        }

    @Test
    fun `reports an unhosted company`() =
        runTest {
            val fake = FakeAudience()
            fake.backend.haEnabled = false
            val model = CompaniesModel(fake.backend)
            model.create("Acme")
            assertNotNull(model.hostingNote.value)
        }

    @Test
    fun `lists companies and names unnamed ones`() =
        runTest {
            val fake = FakeAudience()
            fake.backend.namespaces = listOf(AppNamespace("ffeedd00", null, "app"), AppNamespace("ns-2", "Acme", "app"))
            val model = CompaniesModel(fake.backend)
            model.load()
            assertEquals(listOf("Acme", "Company ffeedd"), model.companies.value.map { it.title })
        }

    @Test
    fun `relayless account has no companies and no error`() =
        runTest {
            val fake = FakeAudience()
            fake.backend.hasRelay = false
            val model = CompaniesModel(fake.backend)
            model.load()
            assertTrue(model.companies.value.isEmpty())
            assertTrue(model.hasLoaded.value)
            assertNull(model.error.value)
        }

    @Test
    fun `join lands in the audience the link names`() =
        runTest {
            val fake = FakeAudience()
            val ns = "cd".repeat(32)
            val model = CompaniesModel(fake.backend)
            val landing =
                model.join(
                    UpdatesInvitation(
                        InMemoryAppBackend.invitation(ns),
                        UpdatesInvitation.Kind.AUDIENCE,
                        ns,
                        companyName = "Acme",
                        audienceId = "grp",
                        contextId = "ctx-9",
                        audienceName = "Angels",
                    ),
                )
            assertTrue(fake.backend.log.contains("joinNamespace $ns"))
            val audience = (landing as InvitationLanding.Audience).audience
            assertEquals("ctx-9", audience.contextId)
            assertEquals("Angels", audience.title)
            val company = model.join(UpdatesInvitation(InMemoryAppBackend.invitation(ns), UpdatesInvitation.Kind.NAMESPACE, ns))
            assertEquals(ns, (company as InvitationLanding.Company).company.id)
        }

    @Test
    fun `failure is reported`() =
        runTest {
            val fake = FakeAudience()
            fake.backend.failure = IOException("offline")
            val model = CompaniesModel(fake.backend)
            assertNull(model.create("X"))
            assertTrue(model.error.value!!.startsWith("The relay can't be reached"))
        }
}

class CompanyModelTest {
    @Test
    fun `creates an open audience with its context`() =
        runTest {
            val fake = FakeAudience()
            val founded = fake.backend.foundNamespace("Acme")
            val model = CompanyModel(CompanySummary(founded.namespaceId, "Acme"), fake.backend, null)
            val audience = model.create(" All investors ")!!
            assertTrue(audience.audienceId in fake.backend.publicSubgroups)
            assertEquals(JsonObject(emptyMap()), fake.backend.initArgs[audience.contextId])
            assertTrue(fake.backend.log.any { it.startsWith("createContext ${audience.audienceId} ${fake.backend.applicationId}") })
            model.load()
            assertEquals(listOf("All investors"), model.audiences.value.map { it.title })
        }

    @Test
    fun `enter joins the context only when needed`() =
        runTest {
            val fake = FakeAudience()
            fake.backend.subgroups = mapOf("ns" to listOf(AppSubgroup("g1", "Angels", listOf("ctx-a"))))
            val model = CompanyModel(CompanySummary("ns", "Acme"), fake.backend, "app")
            model.load()
            val audience = model.audiences.value.first()
            model.enter(audience)
            assertTrue(fake.backend.log.contains("joinContext ctx-a"))
            model.enter(audience)
            assertEquals(1, fake.backend.log.count { it == "joinContext ctx-a" })
        }

    @Test
    fun `an audience without a context says it is syncing`() =
        runTest {
            val fake = FakeAudience()
            val model = CompanyModel(CompanySummary("ns", ""), fake.backend, "app")
            assertNull(model.enter(AudienceSummary("ns", "g", null, "Board", "")))
            assertTrue(model.error.value!!.contains("syncing"))
        }

    @Test
    fun `invitations carry the landing`() =
        runTest {
            val fake = FakeAudience()
            val ns = "ef".repeat(32)
            val model = CompanyModel(CompanySummary(ns, "Acme"), fake.backend, "app")
            assertEquals(UpdatesInvitation.Kind.NAMESPACE, model.companyInvitation()!!.kind)
            val one = model.audienceInvitation(AudienceSummary(ns, "g", "c", "Angels", "Acme"))!!
            val parsed = UpdatesInvitation.parse(one.link())!!
            assertEquals("g", parsed.audienceId)
            assertEquals(ns, parsed.namespaceId)
            assertEquals(2, fake.backend.log.count { it == "createInvitation $ns" })
        }

    @Test
    fun `just joined empty company is syncing`() =
        runTest {
            val fake = FakeAudience()
            val model = CompanyModel(CompanySummary("ns", ""), fake.backend, "a", justJoined = true)
            model.load()
            assertTrue(model.isSyncing)
        }
}

class AudienceModelTest {
    @Test
    fun `loads role overview and categories`() =
        runTest {
            val fake = FakeAudience()
            fake.categories = listOf(category("c1", "Monthly"))
            val model = fake.audienceModel()
            assertEquals("Admin", model.roleLabel)
            assertEquals("Acme", model.companyTitle)
            assertEquals("Monthly", model.category("c1")?.name)
            assertFalse(model.needsProfile)
            fake.me = MeView(ME, "", "", false, false, emptyList())
            model.load()
            assertEquals("Investor", model.roleLabel)
            assertTrue(model.needsProfile)
        }

    @Test
    fun `writes go through execute and bump the version`() =
        runTest {
            val fake = FakeAudience()
            val model = fake.audienceModel()
            val before = model.version.value
            model.setProfile(" Ana ", " Fund ")
            val call = fake.recording.calls("set_profile").single()
            assertEquals(RecordedContractCall.Path.EXECUTE, call.path)
            assertEquals("ctx-1", call.contextId)
            assertEquals("Ana", call.arg("name"))
            assertEquals("Fund", call.arg("firm"))
            assertTrue(model.version.value > before)
            assertEquals(
                RecordedContractCall.Path.QUERY,
                fake.recording
                    .calls("get_me")
                    .first()
                    .path,
            )
        }

    @Test
    fun `muting sends the whole muted set`() =
        runTest {
            val fake = FakeAudience()
            fake.categories = listOf(category("a", "A", muted = true), category("b", "B"))
            val model = fake.audienceModel()
            model.toggleMuted(fake.categories[1])
            assertEquals(
                JsonArray(listOf(JsonPrimitive("a"), JsonPrimitive("b"))),
                fake.recording
                    .calls("set_muted_categories")
                    .last()
                    .argElement("category_ids"),
            )
            model.toggleMuted(fake.categories[0])
            assertEquals(
                JsonArray(emptyList()),
                fake.recording
                    .calls("set_muted_categories")
                    .last()
                    .argElement("category_ids"),
            )
        }

    @Test
    fun `ask and offer writes`() =
        runTest {
            val fake = FakeAudience()
            val model = fake.audienceModel()
            model.offerHelp("ask", "  I know them ")
            model.withdrawOffer("ask")
            model.setOfferStatus("ask", ANA, "accepted")
            model.setAskStatus("ask", true)
            model.setTeammate(ANA, true)
            model.setTeammate(ANA, false)
            assertEquals(
                "I know them",
                fake.recording
                    .calls("offer_help")
                    .single()
                    .arg("note"),
            )
            assertEquals(
                "accepted",
                fake.recording
                    .calls("set_offer_status")
                    .single()
                    .arg("status"),
            )
            assertEquals(
                "resolved",
                fake.recording
                    .calls("set_ask_status")
                    .single()
                    .arg("status"),
            )
            assertEquals(1, fake.recording.calls("withdraw_offer").size)
            assertEquals(1, fake.recording.calls("add_teammate").size)
            assertEquals(1, fake.recording.calls("remove_teammate").size)
        }

    @Test
    fun `events bump the version`() =
        runTest {
            val fake = FakeAudience()
            val model = fake.audienceModel()
            val follow = launch { model.follow() }
            runCurrent()
            val start = model.version.value
            fake.backend.emit(AppContextEvent("ctx-1", "StateMutation"))
            runCurrent()
            advanceTimeBy(300)
            runCurrent()
            assertTrue(model.version.value > start)
            follow.cancel()
        }
}

class FeedModelTest {
    @Test
    fun `team sees drafts and the checklist`() =
        runTest {
            val fake = FakeAudience()
            fake.posts = listOf(card("p1", category = "c1"), card("p2"))
            fake.drafts = listOf(DraftView("d1", "Draft", "{}", 1uL))
            fake.people = listOf(person(ME, "Me", team = true, admin = true))
            val model = FeedModel(fake.audienceModel())
            model.load()
            assertEquals(listOf("p1", "p2"), model.posts.value.map { it.id })
            assertEquals(listOf("d1"), model.drafts.value.map { it.id })
            assertEquals(listOf(true, false, false, false), model.setupSteps.map { it.done })
            val list = fake.recording.calls("list_posts").last()
            assertEquals("update", list.arg("kind"))
            assertEquals(JsonPrimitive(100), list.argElement("limit"))

            model.select("c1")
            assertEquals(
                "c1",
                fake.recording
                    .calls("list_posts")
                    .last()
                    .arg("category_id"),
            )
            assertEquals(listOf("p1"), model.posts.value.map { it.id })
            model.select("c1")
            assertNull(model.category.value)

            model.discard(model.drafts.value[0])
            assertTrue(model.drafts.value.isEmpty())
            assertEquals(
                "d1",
                fake.recording
                    .calls("delete_draft")
                    .single()
                    .arg("draft_id"),
            )
        }

    @Test
    fun `investors do not read drafts`() =
        runTest {
            val fake = FakeAudience()
            fake.me = MeView(ANA, "Ana", "", false, false, emptyList())
            val model = FeedModel(fake.audienceModel())
            model.load()
            assertTrue(fake.recording.calls("list_drafts").isEmpty())
        }
}

class PostModelTest {
    @Test
    fun `opening an unread post records one read`() =
        runTest {
            val fake = FakeAudience()
            fake.postViews["p1"] = postView(card("p1", readByMe = false))
            val model = PostModel("p1", fake.audienceModel())
            model.load()
            model.load()
            assertEquals(1, fake.recording.calls("mark_read").size)
            assertEquals(
                RecordedContractCall.Path.EXECUTE,
                fake.recording
                    .calls("mark_read")
                    .single()
                    .path,
            )
        }

    @Test
    fun `reactions are optimistic`() =
        runTest {
            val fake = FakeAudience()
            fake.postViews["p1"] = postView(card("p1", reactions = listOf(ReactionCount("🎉", 1uL, false))))
            val model = PostModel("p1", fake.audienceModel())
            model.load()
            // The fake keeps answering the old post: check the optimistic state before the reload settles it.
            fake.postViews["p1"] = postView(card("p1", reactions = listOf(ReactionCount("🎉", 2uL, true))))
            model.toggle("🎉")
            assertEquals(2uL, model.usedReactions.first().count)
            assertTrue(model.mine("🎉"))
            val call = fake.recording.calls("react").single()
            assertEquals("🎉", call.arg("emoji"))
            assertEquals(JsonPrimitive(true), call.argElement("on"))
        }

    @Test
    fun `replies thread one level and permissions`() =
        runTest {
            val fake = FakeAudience()
            fake.me = MeView(ANA, "Ana", "", false, false, emptyList())
            fake.postViews["q1"] = postView(card("q1", kind = "question", author = ANA, status = "open"))
            fake.comments =
                listOf(
                    CommentView("c1", "q1", "", ME, "Me", true, "Hi", 1uL, 1uL),
                    CommentView("c2", "q1", "c1", ANA, "Ana", false, "Yo", 2uL, 2uL),
                )
            val model = PostModel("q1", fake.audienceModel())
            model.load()
            assertTrue(model.isQuestion)
            assertTrue(model.canDelete)
            assertFalse(model.canEdit)
            assertEquals(listOf("c1"), model.topLevel.map { it.id })
            assertEquals(listOf("c2"), model.replies("c1").map { it.id })
            assertFalse(model.canDelete(fake.comments[0]))
            assertTrue(model.canDelete(fake.comments[1]))
            assertEquals("Add to the question…", model.replyPlaceholder)

            model.reply(" Thanks ", "c1")
            val call = fake.recording.calls("add_comment").single()
            assertEquals("c1", call.arg("parent_id"))
            assertEquals("Thanks", call.arg("body"))
            model.edit(fake.comments[1], "Edited")
            assertEquals(
                "c2",
                fake.recording
                    .calls("edit_comment")
                    .single()
                    .arg("comment_id"),
            )
            model.delete(fake.comments[1])
            assertEquals(
                "c2",
                fake.recording
                    .calls("delete_comment")
                    .single()
                    .arg("comment_id"),
            )
        }

    @Test
    fun `team answers and deletes`() =
        runTest {
            val fake = FakeAudience()
            fake.postViews["q1"] = postView(card("q1", kind = "question", author = ANA, status = "open"))
            val model = PostModel("q1", fake.audienceModel())
            model.load()
            model.toggleAnswered()
            assertEquals(
                "answered",
                fake.recording
                    .calls("set_question_status")
                    .single()
                    .arg("status"),
            )
            assertTrue(model.delete())
            assertTrue(model.deleted.value)
            assertEquals(
                "q1",
                fake.recording
                    .calls("delete_post")
                    .single()
                    .arg("post_id"),
            )
        }

    @Test
    fun `KPI deltas come from the series`() =
        runTest {
            val fake = FakeAudience()
            fake.postViews["p2"] = postView(card("p2"), metrics = listOf(Metric("MRR", "$42k", "")))
            fake.series = listOf(MetricSeries("MRR", "", listOf(MetricPoint("p1", "Sep", 1uL, "$40k"), MetricPoint("p2", "Oct", 2uL, "$42k"))))
            val model = PostModel("p2", fake.audienceModel())
            model.load()
            assertEquals("$40k", model.previous(Metric("MRR", "$42k", ""))?.value)
        }
}

class ComposerModelTest {
    @Test
    fun `template start autosaves a draft and publish deletes it`() =
        runTest {
            val fake = FakeAudience()
            fake.series = listOf(MetricSeries("MRR", "", listOf(MetricPoint("p", "", 1uL, "1"))))
            val model = ComposerModel(fake.audienceModel(), ComposerStart.Template("monthly"), backgroundScope, clock)
            model.load()
            assertEquals(
                listOf("MRR"),
                model.state.value!!
                    .metrics
                    .map { it.name },
            )
            model.update { s -> s.copy(title = "Oct", sections = s.sections.mapIndexed { i, x -> if (i == 0) x.copy(body = "Shipped") else x }) }
            advanceTimeBy(1_600)
            runCurrent()
            withContext(Dispatchers.Default) { withTimeout(5_000) { while (model.draftId.value == null) delay(10) } }
            val save = fake.recording.calls("save_draft").first()
            assertEquals(RecordedContractCall.Path.EXECUTE, save.path)
            assertNull(save.arg("draft_id"))
            assertEquals("Oct", ComposerState.parse(save.arg("payload")!!)?.title)
            assertEquals("draft-1", model.draftId.value)

            assertEquals("post-new", model.publish())
            val input =
                fake.recording
                    .calls("publish_update")
                    .single()
                    .argElement("input") as JsonObject
            assertEquals(JsonPrimitive("Oct"), input["title"])
            assertEquals(1, (input["sections"] as JsonArray).size)
            assertEquals(0, (input["metrics"] as JsonArray).size)
            assertEquals(
                "draft-1",
                fake.recording
                    .calls("delete_draft")
                    .single()
                    .arg("draft_id"),
            )
        }

    @Test
    fun `resumes a draft`() =
        runTest {
            val fake = FakeAudience()
            val state = ComposerState(title = "Half done", sections = listOf(ComposerState.SectionDraft("text", "", "x")))
            fake.drafts = listOf(DraftView("d9", "Half done", state.payload(), 7uL))
            val model = ComposerModel(fake.audienceModel(), ComposerStart.Draft("d9"), backgroundScope, clock)
            model.load()
            assertEquals(state, model.state.value)
            assertEquals(7uL, model.savedAt.value)
            assertEquals("d9", model.draftId.value)
        }

    @Test
    fun `editing a published update never saves a draft`() =
        runTest {
            val fake = FakeAudience()
            fake.postViews["p1"] = postView(card("p1", title = "Sept"), sections = listOf(Section("highlights", "Highlights", "Good")))
            val model = ComposerModel(fake.audienceModel(), ComposerStart.Edit("p1"), backgroundScope, clock)
            model.load()
            assertEquals("Sept", model.state.value!!.title)
            model.update { it.copy(title = "September") }
            advanceTimeBy(5_000)
            runCurrent()
            assertTrue(fake.recording.calls("save_draft").isEmpty())
            assertNull(model.draftStatus())
            assertEquals("p1", model.publish())
            assertEquals(
                "p1",
                fake.recording
                    .calls("edit_update")
                    .single()
                    .arg("post_id"),
            )
        }

    @Test
    fun `reuse latest and thanks`() =
        runTest {
            val fake = FakeAudience()
            fake.posts = listOf(card("p1"))
            fake.postViews["p1"] = postView(card("p1"), metrics = listOf(Metric("MRR", "1", "")), sections = listOf(Section("product", "Product", "x")))
            fake.contributions = listOf(ContributionView("a", "Intro", "intro", ANA, "Ana", "", "", 1uL))
            val model = ComposerModel(fake.audienceModel(), ComposerStart.ReuseLatest, backgroundScope, clock)
            model.load()
            assertEquals(
                listOf(""),
                model.state.value!!
                    .sections
                    .map { it.body },
            )
            assertEquals(
                listOf(""),
                model.state.value!!
                    .metrics
                    .map { it.value },
            )
            assertNotNull(model.thanks)
            model.insertThanks()
            assertTrue(model.hasThanks)
            model.insertThanks()
            assertEquals(
                1,
                model.state.value!!
                    .sections
                    .count { it.kind == "thanks" },
            )
            assertFalse(model.sectionSuggestions.any { it.kind == "product" })
        }

    @Test
    fun `asks are capped at ten`() =
        runTest {
            val fake = FakeAudience()
            val model = ComposerModel(fake.audienceModel(), ComposerStart.Template("blank"), backgroundScope, clock)
            model.load()
            repeat(12) { model.addAsk() }
            assertEquals(
                10,
                model.state.value!!
                    .asks.size,
            )
            assertFalse(model.canAddAsk)
        }
}

class TabModelsTest {
    @Test
    fun `asks by status`() =
        runTest {
            val fake = FakeAudience()
            fake.asks =
                listOf(
                    AskView("a1", "p", "Oct", "intro", "Intro", "", "open", 1uL, 0uL, emptyList(), null),
                    AskView("a2", "p", "Oct", "hire", "CTO", "", "resolved", 1uL, 0uL, emptyList(), null),
                )
            val model = AsksModel(fake.audienceModel())
            model.load()
            assertEquals(listOf("a1"), model.asks.value.map { it.id })
            model.show("resolved")
            assertEquals(listOf("a2"), model.asks.value.map { it.id })
            assertEquals(
                JsonPrimitive(0),
                fake.recording
                    .calls("list_contributions")
                    .last()
                    .argElement("since"),
            )
        }

    @Test
    fun `questions ask and filter`() =
        runTest {
            val fake = FakeAudience()
            fake.questions = listOf(card("q1", kind = "question", status = "open"), card("q2", kind = "question", status = "answered"))
            val model = QuestionsModel(fake.audienceModel())
            model.load()
            model.openOnly.value = true
            assertEquals(listOf("q1"), model.shown().map { it.id })
            assertEquals("q-new", model.ask(" Runway? ", " after hires "))
            val call = fake.recording.calls("ask_question").single()
            assertEquals("Runway?", call.arg("title"))
            assertNull(call.arg("category_id"))
            assertNull(model.ask("  ", ""))
        }

    @Test
    fun `people splits team and investors`() =
        runTest {
            val fake = FakeAudience()
            fake.people = listOf(person(ME, "Me", team = true, admin = true), person(ANA, "Ana"))
            val model = PeopleModel(fake.audienceModel())
            model.load()
            assertEquals(1, fake.recording.calls("get_engagement").size)
            model.toggleTeam(fake.people[1])
            assertEquals(
                ANA,
                fake.recording
                    .calls("add_teammate")
                    .single()
                    .arg("account"),
            )
            assertEquals(
                "Read 1/2 (50%) · last read Jan 1, 1970 · 0 replies · 0 offers",
                PeopleModel.engagementLine(fake.people[1], clock),
            )
        }

    @Test
    fun `settings seed save and starters`() =
        runTest {
            val fake = FakeAudience()
            fake.categories = listOf(category("c", "Product"))
            val model = SettingsModel(fake.audienceModel())
            model.load()
            assertEquals("Acme", model.companyName.value)
            assertEquals(14u, model.cadenceDays.value)
            model.companyName.value = " Acme Inc "
            assertTrue(model.save())
            val call = fake.recording.calls("set_settings").single()
            assertEquals("Acme Inc", call.arg("company_name"))
            assertEquals(JsonPrimitive(14), call.argElement("cadence_days"))
            model.addStarters()
            assertEquals(4, fake.recording.calls("create_category").size)
            model.archiveCategory("c")
            assertEquals(
                "c",
                fake.recording
                    .calls("archive_category")
                    .single()
                    .arg("category_id"),
            )
        }

    @Test
    fun `never saved settings offer monthly`() =
        runTest {
            val fake = FakeAudience()
            fake.settings = Settings("", 0u, 0uL)
            val model = SettingsModel(fake.audienceModel())
            model.load()
            assertEquals(30u, model.cadenceDays.value)
        }
}
