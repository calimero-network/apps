//! MeroSign on core's real wasmtime engine (`TestApp`): every method, the
//! behaviour v1's tests pinned (they lived in `src/tests.rs` on `TestHost`), and
//! the write rules v1 kept in storage, now checks each method makes.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_app_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// An agreement set up by `owner`, the org holding members `bob` and `carol`,
/// guest `gina`.
fn agreement() -> TestApp {
    let mut t = common::app(
        Org::new()
            .members(["bob", "carol", "dave"])
            .guests(["gina"]),
    );
    ok(
        &mut t,
        "owner",
        "setup",
        json!({ "isPrivate": false, "contextName": "Series A" }),
    );
    t
}

/// A personal library set up by `owner`.
fn library() -> TestApp {
    let mut t = common::app(Org::new().members(["bob"]));
    ok(
        &mut t,
        "owner",
        "setup",
        json!({ "isPrivate": true, "contextName": "default" }),
    );
    t
}

fn ok(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .view(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn confirmed(t: &mut TestApp, who: &str, method: &str, args: Value) -> Result<Value, Failure> {
    t.as_(who).confirmed().call(method, args)
}

/// The app error a call fails with: `(code, fields)`.
fn err(t: &mut TestApp, who: &str, method: &str, args: Value) -> (String, Value) {
    match t.as_(who).call(method, args) {
        Err(Failure::App { code, fields }) => (code, fields),
        other => panic!("{who} {method}: expected an app error, got {other:?}"),
    }
}

fn code(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    err(t, who, method, args).0
}

fn message(t: &mut TestApp, who: &str, method: &str, args: Value) -> String {
    let (_, fields) = err(t, who, method, args);
    fields["message"].as_str().unwrap_or_default().to_owned()
}

/// A blob of `content`, held by the app: `(id, size)` as the method takes them.
fn blob(t: &mut TestApp, content: &str) -> (String, String) {
    let id = t.upload_blob(content.as_bytes(), "application/pdf");
    assert_eq!(id, hex(&Sha256::digest(content.as_bytes())));
    (id, content.len().to_string())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Uploads `content` as a document by `who`; answers `(document id, hash)`.
fn upload(t: &mut TestApp, who: &str, name: &str, content: &str) -> (String, String) {
    let (id, size) = blob(t, content);
    let doc = ok(
        t,
        who,
        "uploadDocument",
        json!({ "name": name, "hash": id, "pdfBlobIdStr": id, "fileSize": size }),
    );
    (doc.as_str().expect("an id").to_owned(), id)
}

/// `who` consents and signs `doc` from `base` with a new version `content`;
/// answers the new hash.
fn sign(t: &mut TestApp, who: &str, doc: &str, base: &str, content: &str) -> String {
    ok(t, who, "setConsent", json!({ "documentId": doc }));
    let (id, size) = blob(t, content);
    confirmed(
        t,
        who,
        "signDocument",
        json!({ "documentId": doc, "baseHash": base, "pdfBlobIdStr": id, "fileSize": size, "newHash": id }),
    )
    .unwrap_or_else(|e| panic!("{who} signs: {e:?}"));
    id
}

fn status(t: &mut TestApp, doc: &str) -> String {
    view(
        t,
        "owner",
        "getDocumentStatus",
        json!({ "documentId": doc }),
    )["status"]
        .as_str()
        .expect("status")
        .to_owned()
}

fn names(t: &TestApp, who: &str) -> Vec<String> {
    t.events_for(who).into_iter().map(|(n, _)| n).collect()
}

// ── setup ────────────────────────────────────────────────────────────────────

#[test]
fn setup_runs_once_and_only_for_the_owner() {
    let mut t = common::app(Org::new().members(["bob"]));
    assert_eq!(
        code(&mut t, "owner", "listDocuments", json!({})),
        "NotSetUp"
    );
    assert_eq!(
        view(&mut t, "owner", "isDefaultPrivateContext", json!({})),
        json!(false)
    );
    assert_eq!(
        message(
            &mut t,
            "bob",
            "setup",
            json!({ "isPrivate": false, "contextName": "x" })
        ),
        "Only the app's owner can set it up"
    );
    ok(
        &mut t,
        "owner",
        "setup",
        json!({ "isPrivate": false, "contextName": "NDA" }),
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "setup",
            json!({ "isPrivate": true, "contextName": "default" })
        ),
        "AlreadySetUp"
    );
    // The creator of an agreement is its first admin.
    assert_eq!(
        view(
            &mut t,
            "bob",
            "getUserPermission",
            json!({ "userIdStr": "owner" })
        ),
        json!("Admin")
    );
    assert_eq!(
        view(&mut t, "owner", "isDefaultPrivateContext", json!({})),
        json!(false)
    );
}

#[test]
fn context_details_whoami_and_context_id() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    let details = view(&mut t, "bob", "getContextDetails", json!({}));
    assert_eq!(details["contextName"], json!("Series A"));
    assert_eq!(details["owner"], json!("owner"));
    assert_eq!(details["isPrivate"], json!(false));
    assert_eq!(details["participantCount"], json!("2"));
    assert_eq!(details["documentCount"], json!("0"));
    assert_eq!(details["createdAt"], json!(common::T0.to_string()));
    assert_eq!(
        details["participants"],
        json!([
            { "userId": "bob", "permissionLevel": "Sign" },
            { "userId": "owner", "permissionLevel": "Admin" },
        ])
    );
    let id = view(&mut t, "bob", "getContextId", json!({}));
    assert_eq!(details["contextId"], id);
    // The argument v1 took is accepted and ignored.
    assert_eq!(
        view(
            &mut t,
            "bob",
            "getContextDetails",
            json!({ "contextIdStr": "other" })
        )["contextId"],
        id
    );
    assert_eq!(view(&mut t, "carol", "whoami", json!({})), json!("carol"));
}

// ── the personal library ─────────────────────────────────────────────────────

#[test]
fn signatures_are_saved_listed_in_pages_and_deleted() {
    let mut t = library();
    assert_eq!(
        view(&mut t, "owner", "isDefaultPrivateContext", json!({})),
        json!(true)
    );
    let (id, size) = blob(&mut t, "png: my initials");
    let first = ok(
        &mut t,
        "owner",
        "createSignature",
        json!({ "name": "Initials", "blobIdStr": id, "dataSize": size }),
    );
    // A u64: a decimal string on the wire, from a counter (v1: a random 53-bit number).
    assert_eq!(first, json!("1"));
    for n in 0..3 {
        ok(
            &mut t,
            "owner",
            "createSignature",
            json!({ "name": format!("S{n}"), "blobIdStr": id, "dataSize": size }),
        );
    }
    let page = view(&mut t, "owner", "listSignatures", json!({ "limit": 3 }));
    assert_eq!(page["items"].as_array().map(Vec::len), Some(3));
    assert_eq!(page["items"][0]["name"], json!("Initials"));
    assert_eq!(page["items"][0]["blobId"], json!(id));
    assert_eq!(page["items"][0]["size"], json!(size));
    assert_eq!(page["items"][0]["createdAt"], json!(common::T0.to_string()));
    let next = page["next"].as_str().expect("a second page").to_owned();
    let rest = view(
        &mut t,
        "owner",
        "listSignatures",
        json!({ "cursor": next, "limit": 3 }),
    );
    assert_eq!(rest["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(rest["next"], json!(null));
    // The library keeps the blob: one stored value per signature refers to it.
    assert_eq!(t.blob_refs(&id), 4);

    ok(
        &mut t,
        "owner",
        "deleteSignature",
        json!({ "signatureId": "1" }),
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "deleteSignature",
            json!({ "signatureId": "1" })
        ),
        "Signature not found: 1"
    );
    assert_eq!(t.blob_refs(&id), 3);
    assert_eq!(
        names(&t, "owner"),
        [
            "SignatureCreated",
            "SignatureCreated",
            "SignatureCreated",
            "SignatureCreated",
            "SignatureDeleted"
        ]
    );
    // The library's events reach its owner alone.
    assert!(names(&t, "bob").is_empty());
}

#[test]
fn a_signature_needs_a_held_blob_of_the_stated_size() {
    let mut t = library();
    let missing = "ab".repeat(32);
    assert_eq!(
        err(
            &mut t,
            "owner",
            "createSignature",
            json!({ "name": "x", "blobIdStr": missing, "dataSize": "1" })
        ),
        ("BlobNotFound".to_owned(), json!({ "blobId": missing }))
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "createSignature",
            json!({ "name": "x", "blobIdStr": "not-hex", "dataSize": "1" })
        ),
        "Invalid"
    );
    let (id, _) = blob(&mut t, "png");
    assert_eq!(
        message(
            &mut t,
            "owner",
            "createSignature",
            json!({ "name": "x", "blobIdStr": id, "dataSize": "4" })
        ),
        "The blob holds 3 bytes, not 4"
    );
}

#[test]
fn agreements_are_bookmarked_and_left() {
    let mut t = library();
    ok(
        &mut t,
        "owner",
        "joinSharedContext",
        json!({ "contextIdStr": "app-1", "contextName": "Series A" }),
    );
    ok(
        &mut t,
        "owner",
        "joinSharedContext",
        json!({ "contextIdStr": "app-2", "contextName": "NDA" }),
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "joinSharedContext",
            json!({ "contextIdStr": "app-1", "contextName": "again" })
        ),
        "Already joined this context"
    );
    let page = view(&mut t, "owner", "listJoinedContexts", json!({}));
    assert_eq!(
        page,
        json!({ "items": [
            { "contextId": "app-1", "contextName": "Series A", "role": "Unknown", "joinedAt": common::T0.to_string() },
            { "contextId": "app-2", "contextName": "NDA", "role": "Unknown", "joinedAt": common::T0.to_string() },
        ], "next": null })
    );
    ok(
        &mut t,
        "owner",
        "leaveSharedContext",
        json!({ "contextIdStr": "app-1" }),
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "leaveSharedContext",
            json!({ "contextIdStr": "app-1" })
        ),
        "Context not found"
    );
    assert_eq!(
        view(&mut t, "owner", "listJoinedContexts", json!({ "limit": 5 }))["items"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert_eq!(
        names(&t, "owner"),
        ["ContextJoined", "ContextJoined", "ContextLeft"]
    );
}

#[test]
fn the_library_is_its_owners_alone_and_refuses_agreement_methods() {
    let mut t = library();
    let (id, size) = blob(&mut t, "png");
    let args = json!({ "name": "forged", "blobIdStr": id, "dataSize": size });
    assert_eq!(code(&mut t, "bob", "createSignature", args), "Forbidden");
    for (method, args) in [
        ("listSignatures", json!({})),
        ("listJoinedContexts", json!({})),
    ] {
        assert!(matches!(
            t.as_("bob").view(method, args),
            Err(Failure::App { ref code, .. }) if code == "Forbidden"
        ));
    }
    assert_eq!(
        code(
            &mut t,
            "bob",
            "joinSharedContext",
            json!({ "contextIdStr": "a", "contextName": "b" })
        ),
        "Forbidden"
    );
    assert_eq!(
        message(&mut t, "owner", "registerSelfAsParticipant", json!({})),
        "Cannot register as participant in private context"
    );
    for (method, args) in [
        ("listParticipants", json!({})),
        ("listDocuments", json!({})),
        ("getUserPermission", json!({ "userIdStr": "owner" })),
    ] {
        assert!(matches!(
            t.as_("owner").view(method, args),
            Err(Failure::App { ref code, .. }) if code == "WrongContext"
        ));
    }
}

#[test]
fn an_agreement_refuses_library_methods() {
    let mut t = agreement();
    let (id, size) = blob(&mut t, "png");
    assert_eq!(
        message(
            &mut t,
            "owner",
            "createSignature",
            json!({ "name": "x", "blobIdStr": id, "dataSize": size })
        ),
        "Signatures can only be created in private context"
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "deleteSignature",
            json!({ "signatureId": "1" })
        ),
        "Signatures can only be deleted in private context"
    );
    assert_eq!(
        code(
            &mut t,
            "owner",
            "leaveSharedContext",
            json!({ "contextIdStr": "a" })
        ),
        "WrongContext"
    );
}

// ── participants ─────────────────────────────────────────────────────────────

#[test]
fn registration_levels_and_removal() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    assert_eq!(
        message(&mut t, "bob", "registerSelfAsParticipant", json!({})),
        "Already registered as participant"
    );
    // A guest of the workspace may register too, as an invitee could in v1.
    ok(&mut t, "gina", "registerSelfAsParticipant", json!({}));
    ok(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "carol", "permission": "Read" }),
    );
    assert_eq!(
        view(&mut t, "owner", "listParticipants", json!({})),
        json!(["bob", "carol", "gina", "owner"])
    );
    assert_eq!(
        view(
            &mut t,
            "carol",
            "getUserPermission",
            json!({ "userIdStr": "carol" })
        ),
        json!("Read")
    );
    assert!(matches!(
        t.as_("carol").view("getUserPermission", json!({ "userIdStr": "dave" })),
        Err(Failure::App { ref code, ref fields }) if code == "NotFound" && fields["message"] == "User not found"
    ));

    // Adding needs an account of the workspace.
    assert_eq!(
        message(
            &mut t,
            "owner",
            "addParticipant",
            json!({ "userIdStr": "mallory", "permission": "Sign" })
        ),
        "mallory is not in this agreement's workspace"
    );

    // Up and down; the same level again is a no-op without an event.
    let before = names(&t, "bob").len();
    ok(
        &mut t,
        "owner",
        "setParticipantPermission",
        json!({ "userIdStr": "carol", "permission": "Read" }),
    );
    assert_eq!(names(&t, "bob").len(), before);
    ok(
        &mut t,
        "owner",
        "setParticipantPermission",
        json!({ "userIdStr": "bob", "permission": "Admin" }),
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "setParticipantPermission",
            json!({ "userIdStr": "dave", "permission": "Sign" })
        ),
        "User is not a participant"
    );
    // With a second admin the first may step down, and the last may not.
    ok(
        &mut t,
        "bob",
        "setParticipantPermission",
        json!({ "userIdStr": "owner", "permission": "Sign" }),
    );
    assert_eq!(
        message(
            &mut t,
            "bob",
            "setParticipantPermission",
            json!({ "userIdStr": "bob", "permission": "Read" })
        ),
        "An agreement needs at least one admin: promote someone else first"
    );
    assert_eq!(
        message(
            &mut t,
            "bob",
            "removeParticipant",
            json!({ "userIdStr": "bob" })
        ),
        "An agreement needs at least one admin: promote someone else first"
    );

    // A removal outranks the participant's own registration, until an admin adds them back.
    ok(
        &mut t,
        "bob",
        "removeParticipant",
        json!({ "userIdStr": "gina" }),
    );
    assert_eq!(
        message(
            &mut t,
            "bob",
            "removeParticipant",
            json!({ "userIdStr": "gina" })
        ),
        "User is not a participant"
    );
    assert_eq!(
        message(&mut t, "gina", "registerSelfAsParticipant", json!({})),
        "An admin removed you from this agreement"
    );
    ok(
        &mut t,
        "bob",
        "addParticipant",
        json!({ "userIdStr": "gina", "permission": "Sign" }),
    );
    assert_eq!(
        message(
            &mut t,
            "bob",
            "addParticipant",
            json!({ "userIdStr": "gina", "permission": "Sign" })
        ),
        "User is already a participant"
    );
    assert_eq!(
        names(&t, "carol"),
        [
            "ParticipantJoined",
            "ParticipantJoined",
            "ParticipantJoined",
            "ParticipantPermissionChanged",
            "ParticipantPermissionChanged",
            "ParticipantLeft",
            "ParticipantJoined"
        ]
    );
    let changed = t
        .events_for("carol")
        .into_iter()
        .find(|(n, _)| n == "ParticipantPermissionChanged")
        .map(|(_, d)| d);
    assert_eq!(
        changed,
        Some(json!({ "userId": "bob", "permission": "Admin" }))
    );
}

#[test]
fn only_admins_manage_participants() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    for (method, args) in [
        (
            "addParticipant",
            json!({ "userIdStr": "carol", "permission": "Admin" }),
        ),
        ("removeParticipant", json!({ "userIdStr": "owner" })),
        (
            "setParticipantPermission",
            json!({ "userIdStr": "bob", "permission": "Admin" }),
        ),
    ] {
        assert_eq!(
            message(&mut t, "bob", method, args.clone()),
            "Admin permissions required for this operation",
            "{method}"
        );
        assert_eq!(
            message(&mut t, "carol", method, args),
            "User permissions not found",
            "{method}"
        );
    }
    assert_eq!(
        code(
            &mut t,
            "owner",
            "addParticipant",
            json!({ "userIdStr": "carol", "permission": "Owner" })
        ),
        "Invalid"
    );
}

#[test]
fn an_agreement_holds_at_most_max_participants() {
    let names: Vec<String> = (0..300).map(|n| format!("m{n:03}")).collect();
    let mut t = common::app(Org::new().members(names.clone()));
    ok(
        &mut t,
        "owner",
        "setup",
        json!({ "isPrivate": false, "contextName": "big" }),
    );
    for n in &names[..255] {
        ok(&mut t, n, "registerSelfAsParticipant", json!({}));
    }
    assert_eq!(
        message(&mut t, &names[255], "registerSelfAsParticipant", json!({})),
        "An agreement holds at most 256 participants"
    );
    assert_eq!(
        view(&mut t, "owner", "listParticipants", json!({}))
            .as_array()
            .map(Vec::len),
        Some(256)
    );
}

// ── documents and signatures ─────────────────────────────────────────────────

#[test]
fn a_document_is_signed_by_every_required_signer_in_turn() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    ok(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "carol", "permission": "Read" }),
    );
    let (doc, h0) = upload(&mut t, "owner", "series-a.pdf", "%PDF upload");
    let list = view(&mut t, "carol", "listDocuments", json!({}));
    let info = &list["items"][0];
    assert_eq!(info["id"], json!(doc));
    assert_eq!(info["name"], json!("series-a.pdf"));
    assert_eq!(info["hash"], json!(h0));
    assert_eq!(info["originalHash"], json!(h0));
    assert_eq!(info["pdfBlobId"], json!(h0));
    assert_eq!(info["size"], json!("11"));
    assert_eq!(info["uploadedBy"], json!("owner"));
    assert_eq!(info["uploadedAt"], json!(common::T0.to_string()));
    assert_eq!(info["status"], json!("Pending"));
    // Who must sign is fixed at upload: the Sign and Admin participants then.
    assert_eq!(info["requiredSigners"], json!(["bob", "owner"]));
    assert!(doc.starts_with("doc_") && doc.len() == 36, "{doc}");

    // Somebody joining later is not a required signer.
    ok(&mut t, "dave", "registerSelfAsParticipant", json!({}));

    let h1 = sign(&mut t, "bob", &doc, &h0, "%PDF bob");
    assert_eq!(status(&mut t, &doc), "PartiallySigned");
    ok(
        &mut t,
        "bob",
        "markParticipantSigned",
        json!({ "documentId": doc }),
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "markParticipantSigned",
            json!({ "documentId": doc })
        ),
        "You must provide consent before being marked as signed"
    );
    let h2 = sign(&mut t, "owner", &doc, &h1, "%PDF bob owner");
    assert_eq!(status(&mut t, &doc), "FullySigned");
    let state = view(
        &mut t,
        "carol",
        "getDocumentStatus",
        json!({ "documentId": doc }),
    );
    assert_eq!(
        state,
        json!({ "status": "FullySigned", "hash": h2, "signatures": "2" })
    );
    let sigs = view(
        &mut t,
        "carol",
        "getDocumentSignatures",
        json!({ "documentId": doc }),
    );
    assert_eq!(
        sigs,
        json!([
            { "signer": "bob", "signedAt": common::T0.to_string() },
            { "signer": "owner", "signedAt": common::T0.to_string() },
        ])
    );
    // A completed document takes no more signatures, from a later joiner either.
    ok(&mut t, "dave", "setConsent", json!({ "documentId": doc }));
    let (id, size) = blob(&mut t, "%PDF dave");
    assert!(matches!(
        confirmed(&mut t, "dave", "signDocument", json!({ "documentId": doc, "baseHash": h2, "pdfBlobIdStr": id, "fileSize": size, "newHash": id })),
        Err(Failure::App { ref fields, .. }) if fields["message"] == "This document is fully signed and takes no more signatures"
    ));
    // Every version stays referenced, so the host keeps every blob.
    assert_eq!(t.blob_refs(&h0), 1);
    assert_eq!(t.blob_refs(&h1), 1);
    assert_eq!(
        t.blob_refs(&h2),
        2,
        "the signature row and the current version"
    );
    assert_eq!(
        names(&t, "carol"),
        [
            "ParticipantJoined",
            "ParticipantJoined",
            "DocumentUploaded",
            "ParticipantJoined",
            "DocumentSigned",
            "DocumentSigned"
        ]
    );
    let signed = t
        .events_for("carol")
        .into_iter()
        .filter(|(n, _)| n == "DocumentSigned")
        .map(|(_, d)| d)
        .next();
    assert_eq!(signed, Some(json!({ "documentId": doc, "signer": "bob" })));
}

#[test]
fn signing_refuses_stale_repeated_unconsented_and_unconfirmed_signatures() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    ok(&mut t, "carol", "registerSelfAsParticipant", json!({}));
    let (doc, h0) = upload(&mut t, "bob", "nda.pdf", "%PDF nda");
    let (id, size) = blob(&mut t, "%PDF nda carol");
    let args = json!({ "documentId": doc, "baseHash": h0, "pdfBlobIdStr": id, "fileSize": size, "newHash": id });

    // Consent first.
    assert!(matches!(
        confirmed(&mut t, "carol", "signDocument", args.clone()),
        Err(Failure::App { ref code, .. }) if code == "ConsentRequired"
    ));
    ok(&mut t, "carol", "setConsent", json!({ "documentId": doc }));
    assert_eq!(
        view(
            &mut t,
            "bob",
            "hasConsented",
            json!({ "userIdStr": "carol", "documentId": doc })
        ),
        json!(true)
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "hasConsented",
            json!({ "userIdStr": "bob", "documentId": doc })
        ),
        json!(false)
    );
    // Then a passkey confirmation.
    assert!(matches!(
        t.as_("carol").call("signDocument", args.clone()),
        Err(Failure::ConfirmRequired)
    ));
    // The new version must be the blob the hash names.
    let mut wrong = args.clone();
    wrong["newHash"] = json!(h0);
    assert!(matches!(
        confirmed(&mut t, "carol", "signDocument", wrong),
        Err(Failure::App { ref code, ref fields }) if code == "HashMismatch" && fields["expected"] == json!(h0)
    ));
    confirmed(&mut t, "carol", "signDocument", args.clone()).expect("carol signs");
    assert!(matches!(
        confirmed(&mut t, "carol", "signDocument", args.clone()),
        Err(Failure::App { ref fields, .. }) if fields["message"] == "You have already signed this document"
    ));

    // Bob still has the upload open: his copy lacks carol's mark.
    ok(&mut t, "bob", "setConsent", json!({ "documentId": doc }));
    let (bid, bsize) = blob(&mut t, "%PDF nda bob");
    match confirmed(
        &mut t,
        "bob",
        "signDocument",
        json!({ "documentId": doc, "baseHash": h0, "pdfBlobIdStr": bid, "fileSize": bsize, "newHash": bid }),
    ) {
        Err(Failure::App { code, fields }) => {
            assert_eq!(code, "StaleVersion");
            assert_eq!(fields["current"], json!(id));
        }
        other => panic!("expected StaleVersion, got {other:?}"),
    }
    assert_eq!(status(&mut t, &doc), "PartiallySigned");
    sign(&mut t, "bob", &doc, &id, "%PDF nda carol bob");
    assert_eq!(
        status(&mut t, &doc),
        "PartiallySigned",
        "the owner has not signed"
    );
}

#[test]
fn levels_decide_who_uploads_signs_reads_and_deletes() {
    let mut t = agreement();
    ok(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "carol", "permission": "Read" }),
    );
    let (id, size) = blob(&mut t, "%PDF x");
    let upload_args = json!({ "name": "x", "hash": id, "pdfBlobIdStr": id, "fileSize": size });
    // A reader reads; a non-participant does not even read.
    assert_eq!(
        message(&mut t, "carol", "uploadDocument", upload_args.clone()),
        "Sign permission or higher is required for this operation"
    );
    assert_eq!(
        message(&mut t, "bob", "uploadDocument", upload_args),
        "You are not a participant in this agreement"
    );
    let (doc, h0) = upload(&mut t, "owner", "x.pdf", "%PDF y");
    for (method, args) in [
        ("listDocuments", json!({})),
        ("getDocumentStatus", json!({ "documentId": doc })),
        ("getDocumentSignatures", json!({ "documentId": doc })),
        ("documentDownload", json!({ "documentId": doc })),
        (
            "searchDocumentByEmbedding",
            json!({ "queryEmbedding": [1.0], "documentId": doc }),
        ),
    ] {
        assert!(
            t.as_("carol").view(method, args.clone()).is_ok()
                || method == "searchDocumentByEmbedding",
            "{method}"
        );
        assert!(
            matches!(
                t.as_("bob").view(method, args),
                Err(Failure::App { ref fields, .. }) if fields["message"] == "You are not a participant in this agreement"
            ),
            "{method}"
        );
    }
    assert_eq!(
        message(&mut t, "bob", "setConsent", json!({ "documentId": doc })),
        "You are not a participant in this agreement"
    );
    // A reader may consent, and still may not sign.
    ok(&mut t, "carol", "setConsent", json!({ "documentId": doc }));
    let (sid, ssize) = blob(&mut t, "%PDF y carol");
    assert!(matches!(
        confirmed(&mut t, "carol", "signDocument", json!({ "documentId": doc, "baseHash": h0, "pdfBlobIdStr": sid, "fileSize": ssize, "newHash": sid })),
        Err(Failure::App { ref fields, .. }) if fields["message"] == "Sign permission or higher is required for this operation"
    ));
    assert_eq!(
        message(
            &mut t,
            "carol",
            "deleteDocument",
            json!({ "documentId": doc })
        ),
        "Admin permissions required for this operation"
    );
}

#[test]
fn deleting_a_document_removes_its_rows_and_releases_its_blobs() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    let (doc, h0) = upload(&mut t, "bob", "x.pdf", "%PDF del");
    let h1 = sign(&mut t, "bob", &doc, &h0, "%PDF del bob");
    assert_eq!(
        message(
            &mut t,
            "bob",
            "deleteDocument",
            json!({ "documentId": doc })
        ),
        "Admin permissions required for this operation"
    );
    ok(
        &mut t,
        "owner",
        "deleteDocument",
        json!({ "documentId": doc }),
    );
    assert_eq!(
        message(
            &mut t,
            "owner",
            "deleteDocument",
            json!({ "documentId": doc })
        ),
        format!("Document not found: {doc}")
    );
    assert_eq!(t.blob_refs(&h0), 0);
    assert_eq!(t.blob_refs(&h1), 0);
    assert_eq!(
        view(&mut t, "bob", "listDocuments", json!({})),
        json!({ "items": [], "next": null })
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "getDocumentSignatures",
            json!({ "documentId": doc })
        ),
        json!([])
    );
    assert_eq!(
        view(
            &mut t,
            "bob",
            "hasConsented",
            json!({ "userIdStr": "bob", "documentId": doc })
        ),
        json!(false)
    );
    assert_eq!(
        message(&mut t, "bob", "setConsent", json!({ "documentId": doc })),
        format!("Document not found: {doc}")
    );
    assert!(names(&t, "carol").contains(&"DocumentDeleted".to_owned()));
}

#[test]
fn documents_list_in_pages() {
    let mut t = agreement();
    for n in 0..5 {
        upload(&mut t, "owner", &format!("d{n}"), &format!("%PDF {n}"));
    }
    let first = view(&mut t, "owner", "listDocuments", json!({ "limit": 2 }));
    assert_eq!(first["items"].as_array().map(Vec::len), Some(2));
    let mut seen = 2;
    let mut next = first["next"].clone();
    while let Some(cursor) = next.as_str() {
        let page = view(
            &mut t,
            "owner",
            "listDocuments",
            json!({ "cursor": cursor, "limit": 2 }),
        );
        seen += page["items"].as_array().map_or(0, Vec::len);
        next = page["next"].clone();
    }
    assert_eq!(seen, 5);
    assert_eq!(
        view(&mut t, "owner", "getContextDetails", json!({}))["documentCount"],
        json!("5")
    );
    // At most 1,000 a page, whatever the caller asks.
    assert_eq!(
        view(&mut t, "owner", "listDocuments", json!({ "limit": 5000 }))["items"]
            .as_array()
            .map(Vec::len),
        Some(5)
    );
}

#[test]
fn an_upload_needs_its_blob_and_the_blobs_hash() {
    let mut t = agreement();
    let missing = "cd".repeat(32);
    assert_eq!(
        err(
            &mut t,
            "owner",
            "uploadDocument",
            json!({ "name": "x", "hash": missing, "pdfBlobIdStr": missing, "fileSize": "1" })
        ),
        ("BlobNotFound".to_owned(), json!({ "blobId": missing }))
    );
    let (id, size) = blob(&mut t, "%PDF h");
    assert_eq!(
        err(
            &mut t,
            "owner",
            "uploadDocument",
            json!({ "name": "x", "hash": missing, "pdfBlobIdStr": id, "fileSize": size })
        ),
        (
            "HashMismatch".to_owned(),
            json!({ "expected": missing, "actual": id })
        )
    );
    // The hash compares without regard to case.
    ok(
        &mut t,
        "owner",
        "uploadDocument",
        json!({ "name": "x", "hash": id.to_uppercase(), "pdfBlobIdStr": id, "fileSize": size }),
    );
}

#[test]
fn download_hands_out_a_grant_for_the_current_version() {
    let mut t = agreement();
    ok(&mut t, "bob", "registerSelfAsParticipant", json!({}));
    let (doc, h0) = upload(&mut t, "owner", "x.pdf", "%PDF dl");
    let d = view(
        &mut t,
        "bob",
        "documentDownload",
        json!({ "documentId": doc }),
    );
    assert_eq!(d["blobId"], json!(h0));
    assert_eq!(d["hash"], json!(h0));
    assert_eq!(d["size"], json!("7"));
    assert!(
        d["grant"].as_str().is_some_and(|g| g.starts_with(&h0)),
        "{d}"
    );
    let h1 = sign(&mut t, "bob", &doc, &h0, "%PDF dl bob");
    let d = view(
        &mut t,
        "bob",
        "documentDownload",
        json!({ "documentId": doc }),
    );
    assert_eq!(d["blobId"], json!(h1));
    assert_eq!(
        message(
            &mut t,
            "bob",
            "documentDownload",
            json!({ "documentId": "doc_nope" })
        ),
        "Document not found: doc_nope"
    );
}

#[test]
fn search_by_embedding_over_chunks_or_the_whole_document() {
    let mut t = agreement();
    let (id, size) = blob(&mut t, "%PDF search");
    let chunks = json!([
        { "text": "The payment is due in thirty days.", "embedding": [1.0, 0.0], "startPosition": 0, "endPosition": 34 },
        { "text": "Either party may terminate.", "embedding": [0.0, 1.0], "startPosition": 35, "endPosition": 62 },
    ]);
    let doc = ok(
        &mut t,
        "owner",
        "uploadDocument",
        json!({ "name": "terms.pdf", "hash": id, "pdfBlobIdStr": id, "fileSize": size,
                "embeddings": [0.6, 0.8], "extractedText": "whole text", "chunks": chunks }),
    );
    let doc = doc.as_str().expect("id").to_owned();
    let answer = view(
        &mut t,
        "owner",
        "searchDocumentByEmbedding",
        json!({ "queryEmbedding": [0.9, 0.1], "documentId": doc }),
    );
    assert_eq!(
        answer,
        json!("Document: terms.pdf\nMost relevant sections:\n\n[Relevance: 0.99] The payment is due in thirty days.\n\n[Relevance: 0.11] Either party may terminate.")
    );
    assert!(matches!(
        t.as_("owner").view("searchDocumentByEmbedding", json!({ "queryEmbedding": [1.0], "documentId": doc })),
        Err(Failure::App { ref fields, .. }) if fields["message"] == "Embedding dimension mismatch: query=1, document chunks=2"
    ));

    // No chunks: the whole-document embedding and the extracted text.
    let (id2, size2) = blob(&mut t, "%PDF whole");
    let whole = ok(
        &mut t,
        "owner",
        "uploadDocument",
        json!({ "name": "w.pdf", "hash": id2, "pdfBlobIdStr": id2, "fileSize": size2,
                "embeddings": [0.6, 0.8], "extractedText": "whole\ntext" }),
    );
    assert_eq!(
        view(
            &mut t,
            "owner",
            "searchDocumentByEmbedding",
            json!({ "queryEmbedding": [0.6, 0.8], "documentId": whole })
        ),
        json!("Document: w.pdf (Similarity: 1.00)\nwhole text")
    );
    // Nothing to search.
    let (bare, _) = upload(&mut t, "owner", "b.pdf", "%PDF bare");
    assert!(matches!(
        t.as_("owner").view("searchDocumentByEmbedding", json!({ "queryEmbedding": [1.0], "documentId": bare })),
        Err(Failure::App { ref fields, .. }) if fields["message"] == "Document has no embeddings for semantic search"
    ));
    assert!(matches!(
        t.as_("owner").view("searchDocumentByEmbedding", json!({ "queryEmbedding": [1.0], "documentId": "doc_x" })),
        Err(Failure::App { ref code, .. }) if code == "NotFound"
    ));
}

#[test]
fn search_content_is_bounded() {
    let mut t = agreement();
    let (id, size) = blob(&mut t, "%PDF big");
    let base = json!({ "name": "x", "hash": id, "pdfBlobIdStr": id, "fileSize": size });
    let mut too_many = base.clone();
    too_many["chunks"] = json!(vec![
        json!({ "text": "t", "embedding": [1.0], "startPosition": 0, "endPosition": 1 });
        201
    ]);
    assert_eq!(
        message(&mut t, "owner", "uploadDocument", too_many),
        "more than 200 chunks"
    );
    let mut long_text = base.clone();
    long_text["extractedText"] = json!("x".repeat(64 * 1024 + 1));
    assert_eq!(
        message(&mut t, "owner", "uploadDocument", long_text),
        "extractedText is over 65536 bytes"
    );
    let mut wide = base;
    wide["embeddings"] = json!(vec![0.5; 2049]);
    assert_eq!(
        message(&mut t, "owner", "uploadDocument", wide),
        "an embedding has more than 2048 dimensions"
    );
}

// ── the node's checks and the wire ───────────────────────────────────────────

#[test]
fn access_and_wire_checks() {
    let mut t = agreement();
    assert!(matches!(
        t.anonymous().view("whoami", json!({})),
        Err(Failure::Refused { status: 401, ref code }) if code == "UNAUTHENTICATED"
    ));
    assert!(matches!(
        t.as_("mallory").call("registerSelfAsParticipant", json!({})),
        Err(Failure::Refused { status: 404, ref code }) if code == "NOT_FOUND"
    ));
    assert!(matches!(
        t.as_("owner").call("nope", json!({})),
        Err(Failure::App { ref code, .. }) if code == "UnknownMethod"
    ));
    assert!(matches!(
        t.as_("owner").view("setConsent", json!({ "documentId": "x" })),
        Err(Failure::App { ref code, .. }) if code == "NotAView"
    ));
    assert!(matches!(
        t.as_("owner").call("setConsent", json!({ "documentId": "x", "extra": 1 })),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
    // u64 arguments are decimal strings.
    assert!(matches!(
        t.as_("owner").call("deleteSignature", json!({ "signatureId": 1 })),
        Err(Failure::App { ref code, .. }) if code == "BadArgs"
    ));
    // The signing call is never a view.
    assert!(matches!(
        t.as_("owner").view("signDocument", json!({ "documentId": "x", "baseHash": "", "pdfBlobIdStr": "", "fileSize": "0", "newHash": "" })),
        Err(Failure::App { ref code, .. }) if code == "ConfirmNotAView" || code == "NotAView"
    ));
}
