package network.calimero.issues.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import network.calimero.issues.contract.CommentView
import network.calimero.issues.contract.ContextContractCalling
import network.calimero.issues.contract.IssueDetail
import network.calimero.issues.contract.IssueTrackerClient
import network.calimero.issues.contract.StatusCount
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The client speaks the component contract's wire (`logic/res/abi.json`): camelCase names, u64 as decimal strings. */
class ContractWireTest {
    /** `kind` and `params` of every method in the contract's ABI, minus `init`. */
    private val abi =
        mapOf(
            "addComment" to ("call" to listOf("issueId", "body")),
            "addLabel" to ("call" to listOf("issueId", "label")),
            "createIssue" to ("call" to listOf("title", "summary", "impact", "repro", "resolutionCriteria", "priority", "labels")),
            "deleteComment" to ("call" to listOf("commentId")),
            "deleteIssue" to ("call" to listOf("issueId")),
            "editComment" to ("call" to listOf("commentId", "newBody")),
            "getIssue" to ("view" to listOf("issueId")),
            "getRepoInfo" to ("view" to emptyList()),
            "getStatusCounts" to ("view" to emptyList()),
            "listIssues" to ("view" to listOf("status", "assignee", "label")),
            "removeLabel" to ("call" to listOf("issueId", "label")),
            "setAssignee" to ("call" to listOf("issueId", "assignee")),
            "setImpact" to ("call" to listOf("issueId", "impact")),
            "setPriority" to ("call" to listOf("issueId", "priority")),
            "setRepoUrl" to ("call" to listOf("url")),
            "setRepro" to ("call" to listOf("issueId", "repro")),
            "setResolutionCriteria" to ("call" to listOf("issueId", "resolutionCriteria")),
            "setStatus" to ("call" to listOf("issueId", "status")),
            "setSummary" to ("call" to listOf("issueId", "summary")),
        )

    private class Recorder : ContextContractCalling {
        val sent = mutableListOf<Triple<String, Boolean, JsonObject>>()

        override suspend fun query(
            method: String,
            argsJson: String,
        ): String = record(method, argsJson, true)

        override suspend fun execute(
            method: String,
            argsJson: String,
        ): String = record(method, argsJson, false)

        private fun record(
            method: String,
            args: String,
            view: Boolean,
        ): String {
            sent += Triple(method, view, Json.parseToJsonElement(args).jsonObject)
            return "null"
        }
    }

    @Test fun `method lists match the ABI`() {
        assertEquals(abi.filterValues { it.first == "call" }.keys, IssueTrackerClient.CALLS.toSet())
        assertEquals(abi.filterValues { it.first == "view" }.keys, IssueTrackerClient.VIEWS.toSet())
    }

    @Test fun `every call sends the ABI's argument names`() =
        runTest {
            val wire = Recorder()
            val c = IssueTrackerClient(wire)
            runCatching { c.getRepoInfo() }
            runCatching { c.listIssues() }
            runCatching { c.getIssue("i") }
            runCatching { c.getStatusCounts() }
            c.setRepoUrl("u")
            runCatching { c.createIssue("t", "s", "i", "r", "c", "low") }
            c.setStatus("i", "Done")
            c.setSummary("i", "s")
            c.setImpact("i", "s")
            c.setRepro("i", "s")
            c.setResolutionCriteria("i", "s")
            c.setPriority("i", "high")
            c.setAssignee("i", null)
            c.addLabel("i", "l")
            c.removeLabel("i", "l")
            runCatching { c.addComment("i", "b") }
            c.editComment("c", "b")
            c.deleteComment("c")
            c.deleteIssue("i")

            assertEquals(abi.keys, wire.sent.map { it.first }.toSet())
            for ((method, view, args) in wire.sent) {
                val (kind, params) = abi.getValue(method)
                assertEquals(method, kind == "view", view)
                assertEquals(method, params.toSet(), args.keys)
            }
            val unassign = wire.sent.first { it.first == "setAssignee" }.third
            assertEquals(JsonNull, unassign["assignee"])
        }

    @Test fun `answers read decimal strings`() {
        val issue =
            """{"id":"issue-1","title":"T","summary":"S","impact":"I","repro":"R","resolutionCriteria":"C","status":"Open",""" +
                """"priority":"low","assignee":null,"labels":["ci"],"createdBy":"acc","createdAt":"1767225600000"}"""
        val detail =
            IssueTrackerClient.json.decodeFromString(
                IssueDetail.serializer(),
                """{"issue":$issue,"comments":[{"id":"c","issueId":"issue-1","author":"acc","body":"b","createdAt":"5","editedAt":null}]}""",
            )
        assertEquals(1_767_225_600_000uL, detail.issue.createdAt)
        assertEquals("C", detail.issue.resolutionCriteria)
        assertNull(detail.comments[0].editedAt)
        val counts =
            IssueTrackerClient.json.decodeFromString(
                kotlinx.serialization.builtins.ListSerializer(StatusCount.serializer()),
                """[{"status":"Open","count":"3"},{"status":"Done","count":0}]""",
            )
        assertEquals(listOf(3uL, 0uL), counts.map { it.count })
        val out = IssueTrackerClient.json.encodeToString(CommentView.serializer(), detail.comments[0])
        assertTrue(out, out.contains(""""createdAt":"5""""))
    }
}
