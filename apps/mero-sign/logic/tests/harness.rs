//! MeroSign on core's real wasmtime engine (`TestApp`): v1's `TestHost` tests
//! method for method, v1's forged-write and fork tests as what they become
//! under one log and method checks, and the access and wire checks v1 could
//! not express.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use calimero_sdk::testing::{Failure, Org, TestApp};
use serde_json::{json, Value};

/// 64 hex digits: a blob id as an upload answers it.
fn blob(n: u8) -> String {
    format!("{n:02x}").repeat(32)
}

/// A shared agreement set up by `owner` (its first admin), in an org with
/// members `bob` and `cy` and a guest `gus`.
fn agreement() -> TestApp {
    let mut t = common::app(Org::new().members(["bob", "cy"]).guests(["gus"]));
    call(
        &mut t,
        "owner",
        "setup",
        json!({ "isPrivate": false, "contextName": "NDA with Acme" }),
    );
    t
}

/// The owner's private library.
fn library() -> TestApp {
    let mut t = common::app(Org::new().members(["bob"]));
    call(
        &mut t,
        "owner",
        "setup",
        json!({ "isPrivate": true, "contextName": "default" }),
    );
    t
}

fn call(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .call(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

fn view(t: &mut TestApp, who: &str, method: &str, args: Value) -> Value {
    t.as_(who)
        .view(method, args)
        .unwrap_or_else(|e| panic!("{who} {method}: {e:?}"))
}

/// The app error's code and `fields.message` (empty when it has none).
fn error(result: Result<Value, Failure>) -> (String, String) {
    match result {
        Err(Failure::App { code, fields }) => {
            let message = fields["message"].as_str().unwrap_or_default().to_owned();
            (code, message)
        }
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn code(result: Result<Value, Failure>) -> String {
    error(result).0
}

fn join(t: &mut TestApp, who: &str) {
    call(t, who, "registerSelfAsParticipant", json!({}));
}

fn level(t: &mut TestApp, who: &str) -> Value {
    view(t, "owner", "getUserPermission", json!({ "userIdStr": who }))
}

fn set_level(t: &mut TestApp, by: &str, who: &str, level: &str) -> Result<Value, Failure> {
    t.as_(by).call(
        "setParticipantPermission",
        json!({ "userIdStr": who, "permission": level }),
    )
}

fn upload(t: &mut TestApp, who: &str) -> String {
    call(
        t,
        who,
        "uploadDocument",
        json!({
            "name": "nda.pdf",
            "hash": "h0",
            "pdfBlobIdStr": blob(1),
            "fileSize": "1000",
            "embeddings": null,
            "extractedText": null,
            "chunks": null,
        }),
    )
    .as_str()
    .expect("an id")
    .to_owned()
}

fn document(t: &mut TestApp, id: &str) -> Value {
    view(t, "owner", "listDocuments", json!({}))
        .as_array()
        .expect("a list")
        .iter()
        .find(|d| d["id"] == json!(id))
        .cloned()
        .unwrap_or_else(|| panic!("{id} not listed"))
}

fn consent(t: &mut TestApp, who: &str, doc: &str) {
    call(t, who, "setConsent", json!({ "documentId": doc }));
}

/// Signs `doc` as `who` from its current version, to `new`.
fn sign(t: &mut TestApp, who: &str, doc: &str, new: &str) -> Result<Value, Failure> {
    let base = document(t, doc)["hash"].as_str().expect("hash").to_owned();
    sign_from(t, who, doc, &base, new)
}

fn sign_from(
    t: &mut TestApp,
    who: &str,
    doc: &str,
    base: &str,
    new: &str,
) -> Result<Value, Failure> {
    t.as_(who).call(
        "signDocument",
        json!({
            "documentId": doc,
            "baseHash": base,
            "pdfBlobIdStr": blob(9),
            "fileSize": "2000",
            "newHash": new,
        }),
    )
}

fn status(t: &mut TestApp, doc: &str) -> Value {
    document(t, doc)["status"].clone()
}

fn signers(t: &mut TestApp, doc: &str) -> Vec<Value> {
    view(
        t,
        "bob",
        "getDocumentSignatures",
        json!({ "documentId": doc }),
    )
    .as_array()
    .expect("a list")
    .iter()
    .map(|s| s["signer"].clone())
    .collect()
}

// ── setup ────────────────────────────────────────────────────────────────────

#[test]
fn nothing_works_before_setup_and_setup_runs_once() {
    let mut t = common::app(Org::new().members(["bob"]));
    assert_eq!(
        code(t.as_("owner").view("listDocuments", json!({}))),
        "Invalid"
    );
    assert_eq!(
        view(&mut t, "owner", "isDefaultPrivateContext", json!({})),
        json!(false)
    );
    let args = json!({ "isPrivate": false, "contextName": "x" });
    assert_eq!(code(t.as_("bob").call("setup", args.clone())), "Forbidden");
    call(&mut t, "owner", "setup", args.clone());
    assert_eq!(code(t.as_("owner").call("setup", args)), "Conflict");
}

#[test]
fn the_creator_is_the_first_admin() {
    let mut t = agreement();
    assert_eq!(level(&mut t, "owner"), json!("Admin"));
    let details = view(
        &mut t,
        "bob",
        "getContextDetails",
        json!({ "contextIdStr": "ctx" }),
    );
    assert_eq!(details["contextId"], json!("ctx"));
    assert_eq!(details["contextName"], json!("NDA with Acme"));
    assert_eq!(details["owner"], json!("owner"));
    assert_eq!(details["isPrivate"], json!(false));
    assert_eq!(details["participantCount"], json!("1"));
    assert_eq!(
        details["participants"],
        json!([{ "userId": "owner", "permissionLevel": "Admin" }])
    );
    assert_eq!(details["documentCount"], json!("0"));
    assert_eq!(details["createdAt"], json!(common::T0.to_string()));
}

// ── the admin gate ───────────────────────────────────────────────────────────

#[test]
fn a_plain_participant_is_not_an_admin() {
    let mut t = agreement();
    join(&mut t, "bob");
    let (code, message) = error(set_level(&mut t, "bob", "bob", "Admin"));
    assert_eq!(code, "Forbidden");
    assert_eq!(message, "Admin permissions required for this operation");
    assert_eq!(level(&mut t, "bob"), json!("Sign"));
}

#[test]
fn a_participant_cannot_delete_a_document() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "bob");
    assert_eq!(
        code(
            t.as_("bob")
                .call("deleteDocument", json!({ "documentId": doc }))
        ),
        "Forbidden"
    );
    call(
        &mut t,
        "owner",
        "deleteDocument",
        json!({ "documentId": doc }),
    );
    assert_eq!(view(&mut t, "owner", "listDocuments", json!({})), json!([]));
}

#[test]
fn a_stranger_who_never_joined_is_not_an_admin() {
    let mut t = agreement();
    assert_eq!(
        code(t.as_("cy").call(
            "addParticipant",
            json!({ "userIdStr": "cy", "permission": "Admin" })
        )),
        "Forbidden"
    );
}

#[test]
fn an_admin_can_promote_a_participant_who_can_then_do_admin_things() {
    let mut t = agreement();
    join(&mut t, "bob");
    set_level(&mut t, "owner", "bob", "Admin").expect("promote");
    assert_eq!(level(&mut t, "bob"), json!("Admin"));
    call(
        &mut t,
        "bob",
        "addParticipant",
        json!({ "userIdStr": "cy", "permission": "Read" }),
    );
    assert_eq!(level(&mut t, "cy"), json!("Read"));
    assert!(t
        .events_for("owner")
        .iter()
        .any(|(n, d)| n == "ParticipantPermissionChanged"
            && *d == json!({ "userId": "bob", "permission": "Admin" })));
}

#[test]
fn setting_the_level_somebody_already_holds_is_a_no_op_not_an_error() {
    let mut t = agreement();
    join(&mut t, "bob");
    set_level(&mut t, "owner", "bob", "Sign").expect("no-op");
    assert_eq!(level(&mut t, "bob"), json!("Sign"));
}

#[test]
fn a_demotion_takes_the_power_away() {
    let mut t = agreement();
    join(&mut t, "bob");
    set_level(&mut t, "owner", "bob", "Admin").expect("promote");
    set_level(&mut t, "bob", "owner", "Sign").expect("demote the owner");
    assert_eq!(level(&mut t, "owner"), json!("Sign"));
    assert_eq!(code(set_level(&mut t, "owner", "bob", "Read")), "Forbidden");
}

#[test]
fn the_last_admin_cannot_step_down_or_be_removed() {
    let mut t = agreement();
    let (code1, message) = error(set_level(&mut t, "owner", "owner", "Sign"));
    assert_eq!(code1, "Conflict");
    assert_eq!(
        message,
        "An agreement needs at least one admin: promote someone else first"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("removeParticipant", json!({ "userIdStr": "owner" }))
        ),
        "Conflict"
    );
}

#[test]
fn a_non_participant_cannot_be_given_a_permission() {
    let mut t = agreement();
    assert_eq!(code(set_level(&mut t, "owner", "bob", "Sign")), "NotFound");
    assert_eq!(
        code(
            t.as_("owner")
                .view("getUserPermission", json!({ "userIdStr": "bob" }))
        ),
        "NotFound"
    );
}

#[test]
fn only_accounts_of_the_organization_can_be_added() {
    let mut t = agreement();
    assert_eq!(
        code(t.as_("owner").call(
            "addParticipant",
            json!({ "userIdStr": "mallory", "permission": "Sign" })
        )),
        "Invalid"
    );
    // A guest may be added by an admin, at any level.
    call(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "gus", "permission": "Read" }),
    );
    assert_eq!(level(&mut t, "gus"), json!("Read"));
    assert_eq!(
        code(t.as_("owner").call(
            "addParticipant",
            json!({ "userIdStr": "gus", "permission": "Sign" })
        )),
        "Conflict"
    );
}

#[test]
fn removing_a_participant_takes_their_permission_and_keeps_them_out() {
    let mut t = agreement();
    join(&mut t, "bob");
    call(
        &mut t,
        "owner",
        "removeParticipant",
        json!({ "userIdStr": "bob" }),
    );
    assert_eq!(
        view(&mut t, "owner", "listParticipants", json!({})),
        json!(["owner"])
    );
    let (c, message) = error(t.as_("bob").call("registerSelfAsParticipant", json!({})));
    assert_eq!(c, "Forbidden");
    assert_eq!(message, "An admin removed you from this agreement");
    // An admin's add clears the removal.
    call(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "bob", "permission": "Sign" }),
    );
    assert_eq!(level(&mut t, "bob"), json!("Sign"));
}

#[test]
fn registering_twice_is_a_conflict_and_guests_cannot_register() {
    let mut t = agreement();
    join(&mut t, "bob");
    let (c, message) = error(t.as_("bob").call("registerSelfAsParticipant", json!({})));
    assert_eq!(c, "Conflict");
    assert_eq!(message, "Already registered as participant");
    assert_eq!(
        code(t.as_("gus").call("registerSelfAsParticipant", json!({}))),
        "Forbidden"
    );
}

#[test]
fn whoami_is_the_account() {
    let mut t = agreement();
    assert_eq!(view(&mut t, "bob", "whoami", json!({})), json!("bob"));
    assert_eq!(
        view(&mut t, "bob", "getContextId", json!({})),
        json!(view(&mut t, "owner", "getContextId", json!({})))
    );
}

// ── documents and signatures ─────────────────────────────────────────────────

#[test]
fn a_document_is_attributed_to_whoever_uploaded_it() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "bob");
    let d = document(&mut t, &doc);
    assert!(doc.starts_with("doc_") && doc.len() == 36, "{doc}");
    assert_eq!(d["uploadedBy"], json!("bob"));
    assert_eq!(d["name"], json!("nda.pdf"));
    assert_eq!(d["hash"], json!("h0"));
    assert_eq!(d["pdfBlobId"], json!(blob(1)));
    assert_eq!(d["size"], json!("1000"));
    assert_eq!(d["uploadedAt"], json!(common::T0.to_string()));
    assert_eq!(d["status"], json!("Pending"));
    assert_eq!(d["requiredSigners"], json!(["bob", "owner"]));
    assert_eq!(
        t.events_for("cy").last().cloned(),
        Some((
            "DocumentUploaded".to_owned(),
            json!({ "id": doc, "name": "nda.pdf", "uploadedBy": "bob" })
        ))
    );
}

#[test]
fn a_blob_id_must_be_64_hex_digits() {
    let mut t = agreement();
    let result = t.as_("owner").call(
        "uploadDocument",
        json!({
            "name": "x", "hash": "h", "pdfBlobIdStr": "2Xk9base58", "fileSize": "1",
            "embeddings": null, "extractedText": null, "chunks": null,
        }),
    );
    assert_eq!(code(result), "Invalid");
    // Upper case is accepted and stored lower case.
    let doc = call(
        &mut t,
        "owner",
        "uploadDocument",
        json!({
            "name": "x", "hash": "h", "pdfBlobIdStr": "AB".repeat(32), "fileSize": "1",
            "embeddings": null, "extractedText": null, "chunks": null,
        }),
    );
    let doc = doc.as_str().expect("id").to_owned();
    assert_eq!(document(&mut t, &doc)["pdfBlobId"], json!("ab".repeat(32)));
}

#[test]
fn a_signature_is_always_attributed_to_the_caller() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "owner");
    consent(&mut t, "bob", &doc);
    sign(&mut t, "bob", &doc, "h1").expect("bob signs");
    assert_eq!(signers(&mut t, &doc), [json!("bob")]);
    let sigs = view(
        &mut t,
        "cy",
        "getDocumentSignatures",
        json!({ "documentId": doc }),
    );
    assert_eq!(sigs[0]["signedAt"], json!(common::T0.to_string()));
    assert!(t.events_for("owner").contains(&(
        "DocumentSigned".to_owned(),
        json!({ "documentId": doc, "signer": "bob" })
    )));
}

#[test]
fn consent_is_recorded_for_the_caller_and_nobody_else() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "owner");
    consent(&mut t, "bob", &doc);
    let has = |t: &mut TestApp, who: &str| {
        view(
            t,
            "cy",
            "hasConsented",
            json!({ "userIdStr": who, "documentId": doc }),
        )
    };
    assert_eq!(has(&mut t, "bob"), json!(true));
    assert_eq!(has(&mut t, "owner"), json!(false));
    let (c, message) = error(sign(&mut t, "owner", &doc, "h1"));
    assert_eq!(c, "Forbidden");
    assert_eq!(
        message,
        "You must provide consent before signing this document"
    );
}

#[test]
fn a_non_participant_cannot_sign() {
    let mut t = agreement();
    let doc = upload(&mut t, "owner");
    consent(&mut t, "cy", &doc);
    let (c, message) = error(sign(&mut t, "cy", &doc, "h1"));
    assert_eq!(c, "Forbidden");
    assert_eq!(message, "You are not a participant in this agreement");
}

#[test]
fn a_reader_can_neither_upload_nor_sign_until_promoted() {
    let mut t = agreement();
    call(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "bob", "permission": "Read" }),
    );
    let doc = upload(&mut t, "owner");
    consent(&mut t, "bob", &doc);
    let (c, message) = error(sign(&mut t, "bob", &doc, "h1"));
    assert_eq!(c, "Forbidden");
    assert_eq!(
        message,
        "Sign permission or higher is required for this operation"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "uploadDocument",
            json!({
                "name": "x", "hash": "h", "pdfBlobIdStr": blob(2), "fileSize": "1",
                "embeddings": null, "extractedText": null, "chunks": null,
            }),
        )),
        "Forbidden"
    );
    set_level(&mut t, "owner", "bob", "Sign").expect("promote");
    sign(&mut t, "bob", &doc, "h1").expect("now bob signs");
}

#[test]
fn a_document_reaches_fully_signed_once_every_required_signer_signed() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "owner");
    consent(&mut t, "owner", &doc);
    consent(&mut t, "bob", &doc);
    sign(&mut t, "owner", &doc, "h1").expect("owner");
    assert_eq!(status(&mut t, &doc), json!("PartiallySigned"));
    // The document now reads at the signed version.
    let d = document(&mut t, &doc);
    assert_eq!(d["hash"], json!("h1"));
    assert_eq!(d["pdfBlobId"], json!(blob(9)));
    assert_eq!(d["size"], json!("2000"));
    sign(&mut t, "bob", &doc, "h2").expect("bob");
    assert_eq!(status(&mut t, &doc), json!("FullySigned"));
    assert_eq!(signers(&mut t, &doc), [json!("owner"), json!("bob")]);
    // Terminal: no more signatures, from anyone.
    join(&mut t, "cy");
    consent(&mut t, "cy", &doc);
    assert_eq!(code(sign(&mut t, "cy", &doc, "h3")), "Conflict");
}

#[test]
fn signing_twice_is_refused() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "owner");
    consent(&mut t, "owner", &doc);
    sign(&mut t, "owner", &doc, "h1").expect("owner");
    let (c, message) = error(sign(&mut t, "owner", &doc, "h2"));
    assert_eq!(c, "Conflict");
    assert_eq!(message, "You have already signed this document");
}

#[test]
fn marking_yourself_signed_without_having_signed_is_refused() {
    let mut t = agreement();
    let doc = upload(&mut t, "owner");
    let mark = |t: &mut TestApp| {
        t.as_("owner")
            .call("markParticipantSigned", json!({ "documentId": doc }))
    };
    assert_eq!(code(mark(&mut t)), "Forbidden");
    consent(&mut t, "owner", &doc);
    assert_eq!(code(mark(&mut t)), "Invalid");
    sign(&mut t, "owner", &doc, "h1").expect("sign");
    mark(&mut t).expect("signed");
}

/// v1's fork: two signers built on the same version. One log orders them, so
/// the second is refused and re-signs from the new version.
#[test]
fn a_signature_built_from_a_stale_copy_is_refused_and_re_signing_works() {
    let mut t = agreement();
    join(&mut t, "bob");
    let doc = upload(&mut t, "owner");
    consent(&mut t, "owner", &doc);
    consent(&mut t, "bob", &doc);
    sign_from(&mut t, "owner", &doc, "h0", "h-owner").expect("owner first");
    let (c, message) = error(sign_from(&mut t, "bob", &doc, "h0", "h-bob"));
    assert_eq!(c, "Conflict");
    assert!(
        message.starts_with("This document changed while you were signing it"),
        "{message}"
    );
    sign_from(&mut t, "bob", &doc, "h-owner", "h-both").expect("bob re-signs");
    assert_eq!(status(&mut t, &doc), json!("FullySigned"));
    assert_eq!(document(&mut t, &doc)["hash"], json!("h-both"));
}

#[test]
fn a_viewer_does_not_block_completion() {
    let mut t = agreement();
    call(
        &mut t,
        "owner",
        "addParticipant",
        json!({ "userIdStr": "bob", "permission": "Read" }),
    );
    let doc = upload(&mut t, "owner");
    assert_eq!(document(&mut t, &doc)["requiredSigners"], json!(["owner"]));
    consent(&mut t, "owner", &doc);
    sign(&mut t, "owner", &doc, "h1").expect("owner");
    assert_eq!(status(&mut t, &doc), json!("FullySigned"));
}

#[test]
fn a_completed_document_stays_completed_when_somebody_new_joins() {
    let mut t = agreement();
    let doc = upload(&mut t, "owner");
    consent(&mut t, "owner", &doc);
    sign(&mut t, "owner", &doc, "h1").expect("owner");
    join(&mut t, "bob");
    assert_eq!(status(&mut t, &doc), json!("FullySigned"));
}

#[test]
fn deleting_a_document_takes_its_signatures_and_consents_with_it() {
    let mut t = agreement();
    let doc = upload(&mut t, "owner");
    consent(&mut t, "owner", &doc);
    sign(&mut t, "owner", &doc, "h1").expect("owner");
    call(
        &mut t,
        "owner",
        "deleteDocument",
        json!({ "documentId": doc }),
    );
    assert_eq!(signers(&mut t, &doc), Vec::<Value>::new());
    assert_eq!(
        view(
            &mut t,
            "owner",
            "hasConsented",
            json!({ "userIdStr": "owner", "documentId": doc })
        ),
        json!(false)
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("deleteDocument", json!({ "documentId": doc }))
        ),
        "NotFound"
    );
}

// ── search ───────────────────────────────────────────────────────────────────

fn upload_with(t: &mut TestApp, embeddings: Value, text: Value, chunks: Value) -> String {
    call(
        t,
        "owner",
        "uploadDocument",
        json!({
            "name": "nda.pdf", "hash": "h0", "pdfBlobIdStr": blob(1), "fileSize": "10",
            "embeddings": embeddings, "extractedText": text, "chunks": chunks,
        }),
    )
    .as_str()
    .expect("id")
    .to_owned()
}

fn search(t: &mut TestApp, doc: &str, query: Value) -> Result<Value, Failure> {
    t.as_("bob").view(
        "searchDocumentByEmbedding",
        json!({ "queryEmbedding": query, "documentId": doc }),
    )
}

#[test]
fn list_documents_leaves_out_the_search_content() {
    let mut t = agreement();
    let doc = upload_with(&mut t, json!([1.0, 0.0]), json!("text"), json!(null));
    let d = document(&mut t, &doc);
    assert_eq!(d["embeddings"], json!(null));
    assert_eq!(d["extractedText"], json!(null));
    assert_eq!(d["chunks"], json!(null));
}

#[test]
fn search_by_chunk_returns_the_most_relevant_sections() {
    let mut t = agreement();
    let doc = upload_with(
        &mut t,
        json!(null),
        json!(null),
        json!([
            { "text": "Payment terms: net 30.", "embedding": [1.0, 0.0], "startPosition": 0, "endPosition": 22 },
            { "text": "Governing law: Delaware.", "embedding": [0.0, 1.0], "startPosition": 23, "endPosition": 47 },
        ]),
    );
    let answer = search(&mut t, &doc, json!([1.0, 0.0])).expect("search");
    assert_eq!(
        answer,
        json!("Document: nda.pdf\nMost relevant sections:\n\n[Relevance: 1.00] Payment terms: net 30.")
    );
    assert_eq!(
        code(search(&mut t, &doc, json!([1.0, 0.0, 0.0]))),
        "Invalid"
    );
}

#[test]
fn search_by_document_embedding_and_its_failures() {
    let mut t = agreement();
    let doc = upload_with(
        &mut t,
        json!([0.0, 1.0]),
        json!("Line one\nline two"),
        json!(null),
    );
    assert_eq!(
        search(&mut t, &doc, json!([0.0, 1.0])).expect("search"),
        json!("Document: nda.pdf (Similarity: 1.00)\nLine one line two")
    );
    let bare = upload_with(&mut t, json!(null), json!(null), json!(null));
    assert_eq!(code(search(&mut t, &bare, json!([1.0]))), "Invalid");
    assert_eq!(
        code(search(&mut t, "doc_missing", json!([1.0]))),
        "NotFound"
    );
}

// ── private library ──────────────────────────────────────────────────────────

#[test]
fn a_signature_round_trips_with_an_id_a_js_number_holds() {
    let mut t = library();
    assert_eq!(
        view(&mut t, "owner", "isDefaultPrivateContext", json!({})),
        json!(true)
    );
    let id = call(
        &mut t,
        "owner",
        "createSignature",
        json!({ "name": "mine", "blobIdStr": blob(3), "dataSize": "512" }),
    );
    let id = id.as_str().expect("a decimal string").to_owned();
    assert!(id.parse::<u64>().expect("decimal") < (1 << 53));
    let list = view(&mut t, "owner", "listSignatures", json!({}));
    assert_eq!(
        list,
        json!([{ "id": id, "name": "mine", "blobId": blob(3), "size": "512",
                 "createdAt": common::T0.to_string() }])
    );
    call(
        &mut t,
        "owner",
        "deleteSignature",
        json!({ "signatureId": id }),
    );
    assert_eq!(
        view(&mut t, "owner", "listSignatures", json!({})),
        json!([])
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("deleteSignature", json!({ "signatureId": id }))
        ),
        "NotFound"
    );
    let names: Vec<String> = t.events_for("owner").into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, ["SignatureCreated", "SignatureDeleted"]);
}

#[test]
fn joined_contexts_and_identity_mappings() {
    let mut t = library();
    let join =
        json!({ "contextIdStr": "app-1", "sharedIdentityStr": "owner", "contextName": "NDA" });
    call(&mut t, "owner", "joinSharedContext", join.clone());
    assert_eq!(
        code(t.as_("owner").call("joinSharedContext", join)),
        "Conflict"
    );
    let list = view(&mut t, "owner", "listJoinedContexts", json!({}));
    assert_eq!(list[0]["contextId"], json!("app-1"));
    assert_eq!(list[0]["contextName"], json!("NDA"));
    assert_eq!(list[0]["role"], json!("Unknown"));
    assert_eq!(list[0]["privateIdentity"], json!("owner"));
    assert_eq!(list[0]["joinedAt"], json!(common::T0.to_string()));
    assert_eq!(
        view(
            &mut t,
            "owner",
            "getSharedIdentity",
            json!({ "contextIdStr": "app-1" })
        ),
        json!("owner")
    );
    assert_eq!(
        view(
            &mut t,
            "owner",
            "resolvePrivateIdentity",
            json!({ "sharedIdentityStr": "owner" })
        ),
        json!("owner")
    );
    assert_eq!(
        view(
            &mut t,
            "owner",
            "resolvePrivateIdentity",
            json!({ "sharedIdentityStr": "x" })
        ),
        json!(null)
    );
    call(
        &mut t,
        "owner",
        "leaveSharedContext",
        json!({ "contextIdStr": "app-1" }),
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("getIdentityMapping", json!({ "contextIdStr": "app-1" }))
        ),
        "NotFound"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("leaveSharedContext", json!({ "contextIdStr": "app-1" }))
        ),
        "NotFound"
    );
}

#[test]
fn a_private_library_answers_its_owner_only() {
    let mut t = library();
    assert_eq!(
        code(t.as_("bob").view("listSignatures", json!({}))),
        "Forbidden"
    );
    assert_eq!(
        code(t.as_("bob").call(
            "createSignature",
            json!({ "name": "x", "blobIdStr": blob(3), "dataSize": "1" })
        )),
        "Forbidden"
    );
    // Agreement methods refuse a library, and library methods an agreement.
    assert_eq!(
        code(t.as_("owner").call("registerSelfAsParticipant", json!({}))),
        "Invalid"
    );
    let mut a = agreement();
    assert_eq!(
        code(a.as_("owner").view("listSignatures", json!({}))),
        "Invalid"
    );
}

// ── access and the wire ──────────────────────────────────────────────────────

#[test]
fn anonymous_callers_and_outsiders_are_refused_before_the_app_runs() {
    let mut t = agreement();
    match t.anonymous().view("listDocuments", json!({})) {
        Err(Failure::Refused { status, code }) => {
            assert_eq!((status, code.as_str()), (401, "UNAUTHENTICATED"));
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
    match t.as_("mallory").view("listDocuments", json!({})) {
        Err(Failure::Refused { status, code }) => {
            assert_eq!((status, code.as_str()), (404, "NOT_FOUND"));
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_guest_reads_but_cannot_upload() {
    let mut t = agreement();
    let doc = upload(&mut t, "owner");
    assert_eq!(document(&mut t, &doc)["id"], json!(doc));
    view(&mut t, "gus", "listDocuments", json!({}));
    assert_eq!(
        code(t.as_("gus").call(
            "uploadDocument",
            json!({
                "name": "x", "hash": "h", "pdfBlobIdStr": blob(2), "fileSize": "1",
                "embeddings": null, "extractedText": null, "chunks": null,
            }),
        )),
        "Forbidden"
    );
}

#[test]
fn bad_args_unknown_methods_and_calls_as_views_are_refused() {
    let mut t = agreement();
    assert_eq!(
        code(
            t.as_("owner")
                .call("setConsent", json!({ "document_id": "x" }))
        ),
        "BadArgs"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("setConsent", json!({ "documentId": 7 }))
        ),
        "BadArgs"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .call("deleteSignature", json!({ "signatureId": 5 }))
        ),
        "BadArgs"
    );
    assert_eq!(
        code(t.as_("owner").call("set_consent", json!({}))),
        "UnknownMethod"
    );
    assert_eq!(
        code(
            t.as_("owner")
                .view("setConsent", json!({ "documentId": "x" }))
        ),
        "NotAView"
    );
}
