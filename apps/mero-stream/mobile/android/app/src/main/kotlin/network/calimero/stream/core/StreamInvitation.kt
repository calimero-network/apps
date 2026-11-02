package network.calimero.stream.core

import com.calimero.mero.app.OrgInvitation
import com.calimero.mero.invite.InviteCodec
import com.calimero.mero.invite.InviteLink
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/**
 * An invitation link: the SDK's [OrgInvitation] (the payload every Calimero 1.0 app shares), plus
 * where to land (identical to the iOS type):
 *
 * - payload: JSON `{invitation: "inv_…", namespaceId, contextId?, name?, kind: "namespace" | "room", roomId?, namespaceName?}`
 * - token: `base58(deflate(payload))`
 * - link: `https://links.calimero.network/com.calimero.mero-stream/join?invitation=<token>`
 *
 * A stream link lands on the stream's rooms; a room link drops the person straight into that call.
 * Both grant the same thing: membership of the stream's organization. `name` is the room's name for
 * a room link, and `roomId` / `contextId` are both the room's app instance.
 *
 * The web app's own link (`<frontend>/?invite=inv_…&stream=<org>&room=<app>&name=…`) is read too,
 * so a link pasted from a browser opens here.
 */
class StreamInvitation(
    invitation: OrgInvitation,
    val kind: Kind,
    val namespaceName: String? = null,
    val roomId: String? = null,
    contextId: String? = null,
    roomName: String? = null,
) {
    enum class Kind(
        val wire: String,
    ) {
        NAMESPACE("namespace"),
        ROOM("room"),
    }

    val invitation: OrgInvitation =
        OrgInvitation(invitation.namespaceId, invitation.token, contextId ?: invitation.contextId, roomName ?: invitation.name)

    /** The stream (organization) it admits to: the one the node minted the token for. */
    val namespaceId: String get() = invitation.namespaceId

    /** The room's call (app instance), for a room link. */
    val contextId: String? get() = invitation.contextId
    val roomName: String? get() = invitation.name

    /** Whether it drops the person into one call. */
    val opensRoom: Boolean get() = kind == Kind.ROOM && roomId != null

    /** The payload JSON: an [OrgInvitation] with where to land. */
    fun payload(): String =
        JsonObject(
            invitation.toJson() +
                kotlinx.serialization.json.buildJsonObject {
                    put("kind", kind.wire)
                    roomId?.let { put("roomId", it) }
                    namespaceName?.let { put("namespaceName", it) }
                },
        ).toString()

    /** The shareable link. */
    fun link(): String = InviteLink.invitation(InviteCodec.encode(payload()), PACKAGE_NAME)

    companion object {
        /** The registry package, which is also the links' slug (`APP_SLUG`). */
        const val PACKAGE_NAME = "com.calimero.mero-stream"

        /**
         * Read a link (https, `calimero://`, the web frontend's `?invite=` form) or a bare token. Null
         * when it is not a Mero Stream invitation, including another app's link.
         */
        fun parse(input: String): StreamInvitation? {
            val trimmed = input.trim()
            parseWebLink(trimmed)?.let { return it }
            var token = InviteLink.tokenFromPasted(trimmed, PACKAGE_NAME) ?: return null
            if (token == trimmed) queryValue(trimmed, "invite")?.let { token = it }
            val json = InviteCodec.decode(token) ?: return null
            return parseJson(json)
        }

        /** Read the decoded payload. Only an [OrgInvitation] (an `inv_…` token and its organization) is an invitation; a pre-1.0 signed one is not. */
        fun parseJson(json: String): StreamInvitation? {
            val invitation = OrgInvitation.decodeJson(json) ?: return null
            val root = runCatching { Json.parseToJsonElement(json) as? JsonObject }.getOrNull() ?: return null
            return StreamInvitation(
                invitation = invitation,
                kind = if (root.string("kind") == Kind.ROOM.wire) Kind.ROOM else Kind.NAMESPACE,
                namespaceName = root.string("namespaceName"),
                roomId = root.string("roomId"),
            )
        }

        /** The web frontend's link: `?invite=inv_…&stream=<org>[&room=<app>][&name=…]`. */
        fun parseWebLink(link: String): StreamInvitation? {
            val token = queryValue(link, "invite")?.takeIf { it.startsWith("inv_") } ?: return null
            val org = queryValue(link, "stream")?.takeIf { it.isNotEmpty() } ?: return null
            val room = queryValue(link, "room")?.takeIf { it.isNotEmpty() }
            val name = queryValue(link, "name")?.takeIf { it.isNotEmpty() }
            return StreamInvitation(
                invitation = OrgInvitation(org, token),
                kind = if (room == null) Kind.NAMESPACE else Kind.ROOM,
                namespaceName = if (room == null) name else null,
                roomId = room,
                contextId = room,
                roomName = if (room == null) null else name,
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

        private fun queryValue(
            link: String,
            name: String,
        ): String? {
            val query = link.substringAfter('?', "")
            for (pair in query.split('&')) {
                val parts = pair.split('=', limit = 2)
                if (parts.size == 2 && parts[0] == name) return java.net.URLDecoder.decode(parts[1], "UTF-8")
            }
            return null
        }
    }
}
