package network.calimero.vote.core

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The web's `verifyTranscript`, replayed: every transcript in vectors.json must be judged here
 * exactly as the web judged it, check for check (iOS `TranscriptAuditTests` does the same).
 */
class TranscriptAuditTest {
    @Test
    fun `every transcript is judged as the web judges it`() {
        val audits = Vectors.root["audits"]!!.jsonArray
        assertTrue(audits.size >= 7)
        for (entry in audits) {
            val name = entry.jsonObject["name"]!!.jsonPrimitive.content
            val web = entry.jsonObject["audit"]!!.jsonObject
            val mine = TranscriptAudit.verify(Vectors.transcript(name))
            assertEquals(name, web["verified"]!!.jsonPrimitive.boolean, mine.verified)
            assertEquals(name, web["agreesWithNode"]!!.jsonPrimitive.boolean, mine.agreesWithNode)
            val counts = web["counts"]!!.takeUnless { it is JsonNull }?.jsonArray?.map { it.jsonPrimitive.long.toULong() }
            assertEquals(name, counts, mine.counts)
            val digest = web["digest"]!!.takeUnless { it is JsonNull }?.jsonPrimitive?.content
            assertEquals(name, digest, mine.digest)
            val checks =
                web["checks"]!!.jsonArray.map {
                    val c = it.jsonObject
                    AuditCheck(
                        c["name"]!!.jsonPrimitive.content,
                        c["ok"]!!.jsonPrimitive.boolean,
                        c["detail"]!!.jsonPrimitive.content.replace("in this browser", "on this device"),
                    )
                }
            assertEquals(name, checks, mine.checks)
        }
    }

    @Test
    fun `the transcript digest is pinned to the web's`() {
        val t = Vectors.transcript()
        val text = TranscriptAudit.transcriptText(t.pollId, t.definition, t.state.election!!, t.state.closure!!.counted, t.report.counts!!)
        assertEquals(Vectors.str("transcript_digest"), TranscriptAudit.digest(text))
    }
}
