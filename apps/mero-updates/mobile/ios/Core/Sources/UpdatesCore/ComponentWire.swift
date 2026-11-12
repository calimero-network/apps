import Foundation

/// The contract's component ABI (`logic/res/abi.json`), as the web app's
/// `app/src/lib/updatesClient.ts` has it. The generated `UpdatesClient` speaks
/// the ABI itself (camelCase methods, arguments and fields, `null` for an unset
/// `option`, every `u64` a decimal string) and answers its own typed records
/// (`Records.swift` names them).
///
/// A refusal stays MeroKit's `AppError` (`422 APP_ERROR {code, fields}`).
/// (== Kotlin `ComponentWire`.)
public enum ComponentWire {
    /// Every contract method (minus `init`): whether it is a view, and its parameters in order.
    public static let methods: [String: (view: Bool, params: [String])] = [
        "addComment": (false, ["postId", "parentId", "body"]),
        "addTeammate": (false, ["account"]),
        "archiveCategory": (false, ["categoryId"]),
        "askQuestion": (false, ["title", "body", "categoryId"]),
        "createCategory": (false, ["name", "emoji", "color"]),
        "deleteComment": (false, ["commentId"]),
        "deleteDraft": (false, ["draftId"]),
        "deletePost": (false, ["postId"]),
        "editCategory": (false, ["categoryId", "name", "emoji", "color"]),
        "editComment": (false, ["commentId", "body"]),
        "editUpdate": (false, ["postId", "input"]),
        "getEngagement": (true, []),
        "getMe": (true, []),
        "getOverview": (true, []),
        "getPost": (true, ["postId"]),
        "getSettings": (true, []),
        "listAsks": (true, ["status"]),
        "listCategories": (true, []),
        "listComments": (true, ["postId"]),
        "listContributions": (true, ["since"]),
        "listDrafts": (true, []),
        "listMetrics": (true, []),
        "listPeople": (true, []),
        "listPosts": (true, ["kind", "categoryId", "cursor", "limit"]),
        "markRead": (false, ["postId"]),
        "offerHelp": (false, ["askId", "note"]),
        "publishUpdate": (false, ["input"]),
        "react": (false, ["postId", "emoji", "on"]),
        "removeTeammate": (false, ["account"]),
        "saveDraft": (false, ["draftId", "title", "payload"]),
        "setAskStatus": (false, ["askId", "status"]),
        "setMutedCategories": (false, ["categoryIds"]),
        "setOfferStatus": (false, ["askId", "account", "status"]),
        "setProfile": (false, ["name", "firm"]),
        "setQuestionStatus": (false, ["postId", "status"]),
        "setSettings": (false, ["companyName", "cadenceDays"]),
        "withdrawOffer": (false, ["askId"]),
    ]
}
