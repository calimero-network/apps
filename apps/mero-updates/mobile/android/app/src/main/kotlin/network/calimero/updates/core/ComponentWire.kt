package network.calimero.updates.core

/**
 * The contract's component ABI (`logic/res/abi.json`), as the web app's
 * `app/src/lib/updatesClient.ts` has it. The generated
 * [network.calimero.updates.generated.client.UpdatesClient] speaks the ABI itself (camelCase
 * methods, arguments and fields, `null` for an unset `option`, every `u64` a decimal string) and
 * answers its own typed records (`generated/UpdatesRecords.kt` names them). (Swift `ComponentWire`.)
 *
 * A refusal stays the SDK's `AppError` (`422 APP_ERROR {code, fields}`).
 */
object ComponentWire {
    /** One contract method: whether it is a view, and its parameters in order. */
    data class Method(
        val view: Boolean,
        val params: List<String>,
    )

    /** Every contract method (minus `init`). */
    val METHODS: Map<String, Method> =
        mapOf(
            "addComment" to Method(false, listOf("postId", "parentId", "body")),
            "addTeammate" to Method(false, listOf("account")),
            "archiveCategory" to Method(false, listOf("categoryId")),
            "askQuestion" to Method(false, listOf("title", "body", "categoryId")),
            "createCategory" to Method(false, listOf("name", "emoji", "color")),
            "deleteComment" to Method(false, listOf("commentId")),
            "deleteDraft" to Method(false, listOf("draftId")),
            "deletePost" to Method(false, listOf("postId")),
            "editCategory" to Method(false, listOf("categoryId", "name", "emoji", "color")),
            "editComment" to Method(false, listOf("commentId", "body")),
            "editUpdate" to Method(false, listOf("postId", "input")),
            "getEngagement" to Method(true, listOf()),
            "getMe" to Method(true, listOf()),
            "getOverview" to Method(true, listOf()),
            "getPost" to Method(true, listOf("postId")),
            "getSettings" to Method(true, listOf()),
            "listAsks" to Method(true, listOf("status")),
            "listCategories" to Method(true, listOf()),
            "listComments" to Method(true, listOf("postId")),
            "listContributions" to Method(true, listOf("since")),
            "listDrafts" to Method(true, listOf()),
            "listMetrics" to Method(true, listOf()),
            "listPeople" to Method(true, listOf()),
            "listPosts" to Method(true, listOf("kind", "categoryId", "cursor", "limit")),
            "markRead" to Method(false, listOf("postId")),
            "offerHelp" to Method(false, listOf("askId", "note")),
            "publishUpdate" to Method(false, listOf("input")),
            "react" to Method(false, listOf("postId", "emoji", "on")),
            "removeTeammate" to Method(false, listOf("account")),
            "saveDraft" to Method(false, listOf("draftId", "title", "payload")),
            "setAskStatus" to Method(false, listOf("askId", "status")),
            "setMutedCategories" to Method(false, listOf("categoryIds")),
            "setOfferStatus" to Method(false, listOf("askId", "account", "status")),
            "setProfile" to Method(false, listOf("name", "firm")),
            "setQuestionStatus" to Method(false, listOf("postId", "status")),
            "setSettings" to Method(false, listOf("companyName", "cadenceDays")),
            "withdrawOffer" to Method(false, listOf("askId")),
        )
}
