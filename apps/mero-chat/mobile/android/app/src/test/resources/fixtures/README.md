Contract outputs of `com.calimero.chat` (apps/mero-chat/logic/src/lib.rs), in the exact JSON shape
serde writes them: `get_messages` / `get_messages_from` return `FullMessageResponse` of
`MessageWithReactions`, `send_message` returns the custom-serialized `Message` (no `index`, no
reactions), `get_info` returns `ContextInfo`, `get_profiles` a `Vec<UserProfile>`.

`{{ME}}` stands for the signed-in account's base58 `UserId`; tests substitute it.
