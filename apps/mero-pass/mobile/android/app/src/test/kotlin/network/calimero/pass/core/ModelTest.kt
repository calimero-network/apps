package network.calimero.pass.core

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.UnknownHostException

/** The view models against the SDK's fakes (`InMemoryAppBackend`) and the in-memory vault. iOS `ModelTests` mirrors this file. */
class ModelTest {
    private fun ref() = VaultRef("ns", "Acme", "g1", "Shared", "ctx")

    private fun vaultModel(
        vault: FakeVault,
        account: String,
        prefs: PassPreferences = MemoryPreferences(),
    ) = VaultModel(ref(), vault.api(account), DeviceKeyPair.generate(), "Pixel", prefs)

    // ── Teams ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun `teams list and create`() =
        runTest {
            val backend = InMemoryAppBackend()
            val teams = TeamsModel(backend)
            teams.load()
            assertEquals(LoadPhase.Loaded, teams.phase.value)
            assertTrue(teams.teams.value.isEmpty())

            val made = teams.create("  Acme  ")
            assertEquals("Acme", made.name)
            assertEquals(listOf("Acme"), teams.teams.value.map { it.name })
            assertTrue("foundNamespace Acme" in backend.log)
            try {
                teams.create(" ")
                fail("a blank name was accepted")
            } catch (e: PassModelException) {
                assertEquals("Give the team a name.", e.message)
            }
        }

    @Test
    fun `teams failure is shown in words`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.failure = UnknownHostException("relay")
            val teams = TeamsModel(backend)
            teams.load()
            assertEquals(LoadPhase.Failed("You're offline. Check your connection and try again."), teams.phase.value)
        }

    @Test
    fun `creating a vault makes an open subgroup with a named contract`() =
        runTest {
            val backend = InMemoryAppBackend()
            val founded = backend.foundNamespace("Acme")
            val team = TeamModel(backend, founded.namespaceId, "Acme", backend.applicationId)
            val vault = team.create("Bank logins")
            assertEquals("Bank logins", vault.vaultName)
            assertTrue(vault.vaultId in backend.publicSubgroups)
            assertEquals(buildJsonObject { put("name", JsonPrimitive("Bank logins")) }, backend.initArgs[vault.contextId])
            team.load()
            assertEquals(listOf("Bank logins"), team.vaults.value.map { it.name })
            assertEquals(
                true,
                team.vaults.value
                    .firstOrNull()
                    ?.joined,
            )
        }

    @Test
    fun `entering a vault joins it first`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.subgroups = mapOf("ns" to listOf(AppSubgroup("g1", "Shared", listOf("ctx"))))
            val team = TeamModel(backend, "ns", "Acme", "app")
            team.load()
            assertEquals(
                false,
                team.vaults.value
                    .first()
                    .joined,
            )
            val ref = team.enter(team.vaults.value[0])
            assertEquals("ctx", ref.contextId)
            assertTrue("joinContext ctx" in backend.log)
            assertEquals(
                true,
                team.vaults.value
                    .first()
                    .joined,
            )
        }

    // ── Invitations ───────────────────────────────────────────────────────────────────────────

    @Test
    fun `a vault invitation round-trips and lands in the vault`() =
        runTest {
            val inviter = InMemoryAppBackend()
            val founded = inviter.foundNamespace("Acme")
            val link = TeamModel.vaultInvite(inviter, VaultRef(founded.namespaceId, "Acme", "g1", "Shared", "ctx"))
            assertTrue(link.contains("com.calimero.mero-pass/join?invitation="))

            val parsed = PassInvitation.parse(link) ?: return@runTest fail("did not parse")
            assertEquals(PassInvitation.Kind.VAULT, parsed.kind)
            assertEquals("Shared", parsed.vaultName)
            assertEquals("Acme", parsed.teamName)
            assertEquals(founded.namespaceId, parsed.namespaceId)
            assertNotNull(PassInvitation.parse(parsed.token()))
            assertNull(PassInvitation.parse(link.replace("com.calimero.mero-pass", "com.calimero.chat")))

            val joiner = InMemoryAppBackend(account = "cd".repeat(32))
            val model = InvitationModel(vaultAttempts = 1, vaultRetryDelayMs = 0)
            assertTrue(model.open(link))
            assertEquals(InvitationModel.Stage.Confirm("Shared", true, "Acme"), model.stage.value)
            var joined = false
            model.accept(backend = { joiner }, didJoin = { joined = true })
            assertTrue(joined)
            val stage = model.stage.value as? InvitationModel.Stage.Joined ?: return@runTest fail("${model.stage.value}")
            assertEquals("ctx", stage.destination.vault?.contextId)
            assertEquals(founded.namespaceId, stage.destination.namespaceId)
        }

    @Test
    fun `a non-invitation is refused in words`() {
        val model = InvitationModel()
        assertFalse(model.open("https://example.com/nothing"))
        assertEquals(InvitationModel.Stage.Failed("This isn't a Mero Pass invitation. Check the link and try again."), model.stage.value)
    }

    // ── Vault ─────────────────────────────────────────────────────────────────────────────────

    @Test
    fun `an admin opens, adds, finds, edits and trashes`() =
        runTest {
            val vault = FakeVault(ALICE)
            val model = vaultModel(vault, ALICE)
            assertTrue(model.open())
            assertEquals(SessionState.READY, model.state)
            assertTrue(model.canWrite)
            assertEquals("End-to-end encrypted · you are an Admin", model.subtitle)
            assertEquals(Holders(1, 0, 0), model.holders.value)

            val id =
                model.save(
                    SecretDraft("login", "GitHub", listOf("dev", " "), mapOf("username" to "alice", "password" to "pw", "bogus" to "x")),
                    null,
                )
            model.save(SecretDraft("secure_note", "Wifi", emptyList(), mapOf("notes" to "guest")), null)
            assertEquals(2, model.live.size)
            assertEquals(listOf("dev"), model.secret(id)?.tags)
            assertNull(model.secret(id)?.fields?.get("bogus"))
            assertEquals(1, model.counts["login"])
            assertEquals(1, model.flagged)

            model.query.value = "alice"
            assertEquals(listOf("GitHub"), model.shown.map { it.name })
            model.query.value = "pw"
            assertTrue("search must never match a secret value", model.shown.isEmpty())
            model.query.value = ""
            model.filter.value = ItemFilter.Kind("secure_note")
            assertEquals(listOf("Wifi"), model.shown.map { it.name })
            model.filter.value = ItemFilter.Tag("dev")
            assertEquals(listOf("GitHub"), model.shown.map { it.name })

            val before = model.secret(id)!!
            model.save(SecretDraft("login", "GitHub", listOf("dev"), before.fields + ("password" to "new-password-123!")), before)
            assertEquals("new-password-123!", model.secret(id)?.fields?.get("password"))
            val history = model.history(id)
            assertEquals(listOf("pw"), history.map { it.previous })
            model.restoreRevision(history[0], model.secret(id)!!)
            assertEquals("pw", model.secret(id)?.fields?.get("password"))

            model.trash(id)
            assertEquals(listOf(id), model.trashed.map { it.id })
            assertEquals(1, model.live.size)
            model.restore(id)
            assertTrue(model.trashed.isEmpty())
            model.trash(id)
            model.purge(id)
            assertNull(model.secret(id))
            assertFalse(model.activity().isEmpty())
        }

    @Test
    fun `a bad authenticator seed is refused`() =
        runTest {
            val vault = FakeVault(ALICE)
            val model = vaultModel(vault, ALICE)
            model.open()
            try {
                model.save(SecretDraft("totp", "Bank 2FA", emptyList(), mapOf("secret" to "not a seed!")), null)
                fail("accepted a bad seed")
            } catch (e: PassModelException) {
                assertEquals("Seed or otpauth:// URI: not a base32 seed or an otpauth://totp URI.", e.message)
            }
        }

    @Test
    fun `a newcomer waits, then an admin phone lets them in`() =
        runTest {
            val vault = FakeVault(ALICE)
            val admin = vaultModel(vault, ALICE)
            admin.open()
            admin.save(SecretDraft("login", "Bank", emptyList(), mapOf("password" to "p")), null)

            val newcomer = vaultModel(vault, BOB)
            newcomer.open()
            assertEquals(SessionState.WAITING, newcomer.state)
            assertEquals(Role.PENDING, newcomer.role)
            assertTrue(newcomer.secrets.value.all { it.unreadable })

            admin.reload()
            newcomer.reload()
            assertEquals(SessionState.READY, newcomer.state)
            assertEquals(Role.EDITOR, newcomer.role)
            assertEquals("p", newcomer.live.first().fields["password"])

            // Bob's second phone waits for approval, and shows its code.
            val second = vaultModel(vault, BOB)
            second.open()
            assertTrue(second.awaitingApproval.value)
            newcomer.reload()
            assertEquals(listOf(second.session.fingerprint), newcomer.approvals.value.map { it.fingerprint })
            newcomer.approve(newcomer.approvals.value[0])
            second.reload()
            assertEquals(SessionState.READY, second.state)
        }

    @Test
    fun `a remembered recovery key is given to every vault opened`() =
        runTest {
            val vault = FakeVault(ALICE)
            val prefs = MemoryPreferences(recoveryKey = RecoveryCode.create().second)
            val model = vaultModel(vault, ALICE, prefs)
            model.open()
            assertEquals(1, model.holders.value?.recovery)
        }

    // ── People ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun `removing someone rotates the key`() =
        runTest {
            val vault = FakeVault(ALICE)
            val admin = vaultModel(vault, ALICE)
            admin.open()
            val other = vaultModel(vault, BOB)
            other.open()
            admin.reload()
            val oldKey = vault.currentKey

            val people = PeopleModel(admin.session, vault.api(ALICE))
            people.load()
            assertEquals(listOf(Role.ADMIN, Role.EDITOR), people.members.value.map { it.role })
            people.setRole(BOB, Role.VIEWER)
            assertEquals(Role.VIEWER, vault.roles[BOB])
            assertTrue(people.remove(BOB))
            assertEquals(Role.REMOVED, vault.roles[BOB])
            assertNotEquals(oldKey, vault.currentKey)
            assertEquals("Removed. The vault key was rotated.", people.status.value)
            people.setDefaultRole(Role.VIEWER)
            assertEquals("viewer", vault.defaultRole)
            people.rotate()
            assertEquals("Rotated. 0 secrets re-encrypted.", people.status.value)
        }

    @Test
    fun `a viewer cannot change roles`() =
        runTest {
            val vault = FakeVault(ALICE)
            vault.roles[BOB] = Role.VIEWER
            val viewer = vaultModel(vault, BOB)
            viewer.open()
            val people = PeopleModel(viewer.session, vault.api(BOB))
            assertFalse(people.setRole(ALICE, Role.VIEWER))
            assertEquals("Only a vault Admin can do that.", people.error.value)
        }

    // ── Security ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun `a recovery key covers every vault and restores a fresh phone`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.namespaces = listOf(AppNamespace("ns", "Acme", "app"))
            backend.subgroups = mapOf("ns" to listOf(AppSubgroup("g1", "Shared", listOf("ctx"))))
            backend.members = setOf("ctx")
            val vault = FakeVault(backend.account)
            val directory = VaultDirectory(backend) { vault.api(backend.account) }
            val phone = DeviceKeyPair.generate()
            VaultSession(vault.api(backend.account), phone, PassCrypto.fingerprint(phone.publicRaw), "Pixel").open()

            val prefs = MemoryPreferences()
            val security = SecurityModel(prefs)
            security.createRecoveryKey(directory, phone, "Pixel")
            val code = security.shownCode.value ?: return@runTest fail("no code shown")
            assertEquals("Recovery key created for 1 vault.", security.status.value)
            assertNotNull(prefs.recoveryKey)
            security.dismissCode()
            assertNull(security.shownCode.value)

            // A new phone, with nothing: the code hands it the vault.
            val fresh = DeviceKeyPair.generate()
            val restoring = SecurityModel(MemoryPreferences())
            assertEquals(1, restoring.restore(code, directory, fresh, "New Pixel"))
            val after = VaultSession(vault.api(backend.account), fresh, PassCrypto.fingerprint(fresh.publicRaw), "New Pixel")
            assertEquals(SessionState.READY, after.open())

            assertEquals(0, restoring.restore(RecoveryCode.create().first, directory, fresh, "x"))
            assertEquals("That code does not match a recovery key in any of your vaults.", restoring.error.value)
            security.setAutoLockMinutes(15)
            assertEquals(15, prefs.autoLockMinutes)
        }

    @Test
    fun `the keeper makes the key once and locks`() {
        val store = MemoryDeviceKeyStore()
        val keeper = DeviceKeeper(store)
        assertFalse(keeper.hasKey)
        val first = keeper.unlock()
        assertTrue(keeper.isUnlocked)
        keeper.lock()
        assertFalse(keeper.isUnlocked)
        val again = keeper.unlock()
        assertArrayEquals(first.publicRaw, again.publicRaw)
        assertEquals(3, keeper.generation.value)
        keeper.reset()
        assertFalse(keeper.hasKey)
    }

    @Test
    fun `item presentation`() {
        val card = Secret("1", "payment_card", "Visa", emptyList(), mapOf("card_number" to "4111 1111 1111 1234"))
        assertEquals("•••• 1234", ItemView.subtitle(card))
        val login = Secret("2", "login", "x", emptyList(), mapOf("url" to "https://www.github.com/login"))
        assertEquals("github.com", ItemView.subtitle(login))
        assertEquals("https://github.com", ItemView.openableUrl("github.com"))
        assertEquals("É", ItemView.monogram("  ébène"))
        assertEquals("ababab…abab", ItemView.shortAccount("ab".repeat(32)))
        assertTrue(SecretKind.isSensitive("login", "password"))
        assertFalse(SecretKind.isSensitive("login", "username"))
        assertTrue(SecretKind.isSensitive("custom", "api_token"))
        assertEquals(listOf("Website"), ItemView.orderedFields(login).map { it.label })
    }
}
