Answers of the `com.calimero.chat` component contract (`apps/mero-chat/logic`), in the JSON its
ABI (`logic/res/abi.json`) puts on the wire: camelCase fields, `u64`s as decimal strings, `Option`
as `null`. Each file is named for the method that answers it: `getMessages` / `getMessagesFrom`
return a `FullMessageResponse` of `MessageView`s, `sendMessage` the `MessageView` it stored,
`getInfo` a `ContextInfo`, `getProfiles` a list of `UserProfile`s. `ChatWireTest` hands them to the
generated `ChatClient` as a contract's answers.

`{{ME}}` stands for the signed-in account; tests substitute it.
