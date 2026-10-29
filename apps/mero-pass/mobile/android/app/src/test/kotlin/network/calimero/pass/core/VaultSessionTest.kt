package network.calimero.pass.core

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The web's `vaultSession.test.ts`, case for case where it applies. iOS `VaultSessionTests` mirrors this file. */
class VaultSessionTest {
    @Test
    fun `bootstraps a key and seals everything it writes`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            assertEquals(SessionState.READY, a.session.open())
            assertTrue(Regex("^[0-9a-f]{64}$").matches(vault.currentKey))

            val id = a.session.add(SecretDraft("login", "GitHub", listOf("dev"), mapOf("username" to "alice", "password" to "hunter2")))
            val stored = vault.secrets.getValue(id)
            val onDisk = "${stored.name}${stored.tags}${stored.fields}"
            assertFalse(onDisk.contains("GitHub"))
            assertFalse(onDisk.contains("hunter2"))
            assertFalse(onDisk.contains("dev"))
            assertEquals(vault.currentKey, PassCrypto.keyIdOf(stored.fields.getValue("password")))

            val plain = a.session.list()[0]
            assertEquals("GitHub", plain.name)
            assertEquals(listOf("dev"), plain.tags)
            assertEquals("hunter2", plain.fields["password"])
            assertFalse(plain.unreadable)
        }

    @Test
    fun `a newcomer waits until a key holder admits them`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            a.session.add(SecretDraft("login", "Bank", emptyList(), mapOf("password" to "p")))

            val b = browser(vault, BOB)
            assertEquals(SessionState.WAITING, b.session.open())
            val locked = b.session.list()[0]
            assertTrue(locked.unreadable)
            assertEquals("Locked item", locked.name)

            assertEquals(Chores(1, 1, 0), a.session.housekeep())
            assertEquals(Role.EDITOR, vault.roles[BOB])

            assertEquals(SessionState.READY, b.session.refreshKeys())
            assertEquals("p", b.session.list()[0].fields["password"])
            assertTrue(b.session.canWrite)
        }

    @Test
    fun `does not admit an account outside the allowed set`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            val b = browser(vault, BOB)
            b.session.open()
            assertEquals(Chores(0, 0, 0), a.session.housekeep(setOf(ALICE)))
            assertEquals(SessionState.WAITING, b.session.refreshKeys())
        }

    @Test
    fun `sends only the fields that changed`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            val id = a.session.add(SecretDraft("login", "Mail", emptyList(), mapOf("username" to "u", "password" to "old", "url" to "https://mail")))
            val before = a.session.list()[0]
            val urlEnvelope = vault.secrets.getValue(id).fields["url"]

            a.session.update(before, SecretDraft(before.kind, before.name, before.tags, before.fields + ("password" to "new")))

            assertEquals(urlEnvelope, vault.secrets.getValue(id).fields["url"])
            val history = a.session.history(id)
            assertEquals(1, history.size)
            assertEquals("password", history[0].field)
            assertEquals("old", history[0].previous)
            assertFalse(history[0].unreadable)
        }

    @Test
    fun `rotation locks out a removed member from anything written afterwards`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            val b = browser(vault, BOB)
            b.session.open()
            a.session.housekeep()
            b.session.refreshKeys()
            val oldKey = vault.currentKey

            vault.roles.remove(BOB)
            a.session.add(SecretDraft("login", "Before", emptyList(), mapOf("password" to "b")))
            assertEquals(1, a.session.rotate(setOf(ALICE)))
            assertNotEquals(oldKey, vault.currentKey)
            a.session.add(SecretDraft("login", "After", emptyList(), mapOf("password" to "a")))

            for (s in vault.secrets.values) assertEquals(vault.currentKey, PassCrypto.keyIdOf(s.fields.getValue("password")))
            assertEquals(SessionState.WAITING, b.session.refreshKeys())
            assertTrue(b.session.list().all { it.unreadable })

            assertEquals(
                listOf("a", "b"),
                a.session
                    .list()
                    .mapNotNull { it.fields["password"] }
                    .sorted(),
            )
            assertTrue(vault.history.isEmpty())
        }

    @Test
    fun `an admin finishes a team-level removal`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            val b = browser(vault, BOB)
            b.session.open()
            a.session.housekeep(setOf(ALICE, BOB))
            b.session.refreshKeys()
            val oldKey = vault.currentKey

            val chores = a.session.housekeep(setOf(ALICE))
            assertEquals(1, chores.removed)
            assertEquals(Role.REMOVED, vault.roles[BOB])
            assertNotEquals(oldKey, vault.currentKey)
            assertEquals(SessionState.WAITING, b.session.refreshKeys())
        }

    @Test
    fun `does not remove anyone on a listing without itself`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            vault.roles[BOB] = Role.EDITOR
            assertEquals(0, a.session.housekeep(emptySet()).removed)
            assertEquals(Role.EDITOR, vault.roles[BOB])
        }

    @Test
    fun `hands every key over to a new key pair`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            a.session.add(SecretDraft("login", "Old", emptyList(), mapOf("password" to "o")))
            a.session.rotate(null)

            val next = DeviceKeyPair.generate()
            val nextFp = PassCrypto.fingerprint(next.publicRaw)
            assertEquals(2, a.session.handOver(next.publicRaw, nextFp, "pin"))

            val after = VaultSession(vault.api(ALICE), next, nextFp, "pin")
            assertEquals(SessionState.READY, after.open())
            assertEquals(2, after.keyring.size)
            assertEquals("o", after.list()[0].fields["password"])
        }

    @Test
    fun `a viewer cannot write`() =
        runTest {
            val vault = FakeVault(ALICE)
            vault.defaultRole = "viewer"
            val a = browser(vault, ALICE)
            a.session.open()
            val b = browser(vault, BOB)
            b.session.open()
            a.session.housekeep()
            b.session.refreshKeys()
            assertEquals(SessionState.READY, b.session.state)
            assertFalse(b.session.canWrite)
        }

    // ── Device approval ───────────────────────────────────────────────────────────────────────

    private suspend fun aliceWithBob(): Triple<FakeVault, Browser, Browser> {
        val vault = FakeVault(ALICE)
        val a = browser(vault, ALICE)
        a.session.open()
        val b = browser(vault, BOB)
        b.session.open()
        a.session.housekeep()
        b.session.refreshKeys()
        return Triple(vault, a, b)
    }

    @Test
    fun `a second device of an account waits for approval`() =
        runTest {
            val (vault, a, b) = aliceWithBob()
            val b2 = browser(vault, BOB)
            assertEquals(SessionState.WAITING, b2.session.open())
            assertTrue(b2.session.awaitingApproval())

            assertEquals(0, a.session.housekeep().wrapped)
            assertEquals(0, b.session.housekeep().wrapped)

            val forBob = b.session.pendingApprovals()
            assertEquals(listOf(b2.fp), forBob.map { it.fingerprint })
            assertEquals(1, a.session.pendingApprovals().size)
            assertTrue(b2.session.pendingApprovals().isEmpty())

            assertEquals(1, b.session.approve(forBob[0]))
            assertEquals(SessionState.READY, b2.session.refreshKeys())
            assertTrue(b.session.pendingApprovals().isEmpty())
        }

    @Test
    fun `a denied request is withdrawn`() =
        runTest {
            val (vault, _, b) = aliceWithBob()
            val b2 = browser(vault, BOB)
            b2.session.open()
            b.session.deny(b.session.pendingApprovals()[0])
            assertNull(vault.devices[b2.fp])
            assertTrue(b.session.pendingApprovals().isEmpty())
        }

    @Test
    fun `a replacement for a revoked device is let in without approval`() =
        runTest {
            val (vault, a, b) = aliceWithBob()
            a.session.deny(vault.devices.getValue(b.fp))
            assertEquals(true, vault.devices[b.fp]?.revoked)

            val b2 = browser(vault, BOB)
            b2.session.open()
            assertFalse(b2.session.awaitingApproval())
            assertEquals(1, a.session.housekeep().wrapped)
            assertEquals(SessionState.READY, b2.session.refreshKeys())
        }

    @Test
    fun `rotation reaches approved devices and recovery keys, not requests`() =
        runTest {
            val (vault, a, b) = aliceWithBob()
            val rec = DeviceKeyPair.generate()
            val recFp = PassCrypto.fingerprint(rec.publicRaw)
            b.session.handOver(rec.publicRaw, recFp, RECOVERY_LABEL, DeviceKind.RECOVERY)
            browser(vault, BOB).session.open()

            a.session.rotate(null)
            val holding =
                vault.wraps.values
                    .filter { it.wrap.keyId == vault.currentKey }
                    .map { it.wrap.recipient }
                    .sorted()
            assertEquals(listOf(a.fp, b.fp, recFp).sorted(), holding)
            assertEquals(Holders(2, 1, 0), a.session.holders())
        }

    @Test
    fun `a recovery key restores a fresh device`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            val (code, key) = RecoveryCode.create()
            assertEquals(1, a.session.adoptRecoveryKey(key))
            assertTrue(a.session.pendingApprovals().isEmpty())

            val pair = RecoveryCode.pair(code, vault.api(ALICE).listDevices()) ?: return@runTest fail("no match")
            val restorer = VaultSession(vault.api(ALICE), pair.first, pair.second, "")
            assertEquals(SessionState.READY, restorer.refreshKeys())
            val fresh = DeviceKeyPair.generate()
            val freshFp = PassCrypto.fingerprint(fresh.publicRaw)
            assertEquals(1, restorer.handOver(fresh.publicRaw, freshFp, "phone"))
            assertEquals(SessionState.READY, VaultSession(vault.api(ALICE), fresh, freshFp, "phone").open())
        }

    @Test
    fun `a new recovery key replaces the old one and is not re-given`() =
        runTest {
            val vault = FakeVault(ALICE)
            val a = browser(vault, ALICE)
            a.session.open()
            val first = RecoveryCode.create().second
            assertEquals(1, a.session.adoptRecoveryKey(first))
            assertEquals(0, a.session.adoptRecoveryKey(first))
            val second = RecoveryCode.create().second
            assertEquals(0, a.session.adoptRecoveryKey(second))
            assertNull(vault.devices[second.fingerprint])
            assertEquals(1, a.session.adoptRecoveryKey(second, replace = true))
            assertNull(vault.devices[first.fingerprint])
            assertEquals("recovery", vault.devices[second.fingerprint]?.kind)
        }

    @Test
    fun `an agent is never admitted by housekeeping and an editor cannot let it in`() =
        runTest {
            val (vault, a, b) = aliceWithBob()
            val agentAccount = "c" + "0".repeat(63)
            val agentKey = DeviceKeyPair.generate()
            val agentFp = PassCrypto.fingerprint(agentKey.publicRaw)
            val agent = VaultSession(vault.api(agentAccount), agentKey, agentFp, "mero-bot", DeviceKind.AGENT)
            agent.open()
            assertEquals(0, a.session.housekeep().admitted)

            vault.roles[agentAccount] = Role.VIEWER
            assertTrue(b.session.pendingApprovals().isEmpty())
            val forAdmin = a.session.pendingApprovals()
            assertEquals(listOf(agentFp), forAdmin.map { it.fingerprint })
            try {
                b.session.approve(forAdmin[0])
                fail("an editor let an agent in")
            } catch (e: VaultSessionException) {
                // expected
            }
            a.session.approve(forAdmin[0])
            assertEquals(SessionState.READY, agent.refreshKeys())
            assertEquals(1, a.session.holders().agents)
        }
}
