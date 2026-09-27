use calimero_sdk::testing::{with_identity, TestHost, TestState};

use super::*;

// Two DISTINCT people. Both axes have to move: `call_as` alone changes only
// the device and keeps the account, which models one human's second machine.
// Since every permission in this contract is keyed by ACCOUNT, a test that
// used `call_as` for "somebody else" would silently assert nothing.
const ALICE_ACCOUNT: [u8; 32] = [0xA0; 32];
const ALICE_DEVICE: [u8; 32] = [0xA1; 32];
const BOB_ACCOUNT: [u8; 32] = [0xB0; 32];
const BOB_DEVICE: [u8; 32] = [0xB1; 32];
// Alice again, on a second machine.
const ALICE_PHONE: [u8; 32] = [0xA2; 32];

fn hexed(id: [u8; 32]) -> String {
    hex::encode(id)
}

/// A shared agreement created by Alice, who is therefore its only admin and
/// the first moderator of its documents.
///
/// `TestHost::new` runs `init` with the SDK host and the storage layer each at
/// their own default identity (every later `call` aligns them). A real node
/// runs `init` as one account, so this aligns both to Alice: otherwise the
/// admin (`env::account_id()`) and the documents' founding moderator (the
/// storage writer) are two different people, which no node can produce.
fn new_agreement() -> TestHost<MeroSignState> {
    let mut app = TestHost::new(|| {
        with_identity(ALICE_DEVICE, ALICE_ACCOUNT, || {
            let mut state = None;
            MeroSignState::__test_with_account(ALICE_ACCOUNT, &mut || {
                state = Some(MeroSignState::init(false, "NDA with Acme".to_owned()));
            });
            state.expect("init ran")
        })
    });
    app.set_account(ALICE_ACCOUNT);
    app.set_device(ALICE_DEVICE);
    app
}

/// Bob redeems an invitation: he joins and registers himself, which is the
/// only way a non-creator becomes a participant.
fn bob_joins(app: &mut TestHost<MeroSignState>) {
    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
        s.register_self_as_participant()
    })
    .unwrap();
}

fn permission_of(app: &TestHost<MeroSignState>, account: [u8; 32]) -> PermissionLevel {
    app.view(|s| s.get_user_permission(hexed(account))).unwrap()
}

// ── the admin gate ───────────────────────────────────────────────────────

/// The regression this contract shipped with: `validate_admin_permissions`
/// looked up `*self.owner.get()` — the CREATOR — rather than the caller, so
/// it found `Admin` every time and returned `Ok(())` for everybody. Bob
/// could delete Alice's documents and add participants to her agreement.
///
/// If someone "simplifies" the gate back to the owner, this fails, which is
/// the point: nothing else in the app would have complained.
#[test]
fn a_plain_participant_is_not_an_admin() {
    let mut app = new_agreement();
    bob_joins(&mut app);

    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Admin)
        })
        .unwrap_err();
    assert!(
        format!("{err:?}").contains("Admin permissions required"),
        "a participant must not pass the admin gate, got: {err:?}"
    );

    assert_eq!(
        permission_of(&app, BOB_ACCOUNT),
        PermissionLevel::Sign,
        "Bob must not have been able to promote himself"
    );
}

#[test]
fn a_participant_cannot_delete_a_document() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.delete_document(doc.clone()))
        .unwrap_err();
    assert!(format!("{err:?}").contains("Admin permissions required"));
    assert_eq!(app.view(|s| s.list_documents()).unwrap().len(), 1);
}

#[test]
fn a_stranger_who_never_joined_is_not_an_admin() {
    const NOBODY: [u8; 32] = [0xCC; 32];
    let mut app = new_agreement();
    let err = app
        .call_as_account(NOBODY, NOBODY, |s| {
            s.add_participant(hexed(BOB_ACCOUNT), PermissionLevel::Admin)
        })
        .unwrap_err();
    assert!(
        format!("{err:?}").contains("User permissions not found"),
        "got: {err:?}"
    );
}

#[test]
fn the_admin_is_the_account_so_a_second_device_still_qualifies() {
    // The whole reason the gate reads `account_id()` and not the device: an
    // admin on their phone is the same admin.
    let mut app = new_agreement();
    bob_joins(&mut app);
    app.call_as_account(ALICE_ACCOUNT, ALICE_PHONE, |s| {
        s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Admin)
    })
    .unwrap();
    assert_eq!(permission_of(&app, BOB_ACCOUNT), PermissionLevel::Admin);
}

// ── promote / demote ─────────────────────────────────────────────────────

#[test]
fn an_admin_can_promote_a_participant() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    assert_eq!(permission_of(&app, BOB_ACCOUNT), PermissionLevel::Sign);

    app.call(|s| s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Admin))
        .unwrap();

    assert_eq!(permission_of(&app, BOB_ACCOUNT), PermissionLevel::Admin);
}

#[test]
fn a_promoted_participant_can_then_actually_do_admin_things() {
    // "…and making them be able to use things also work": a promotion that
    // does not change what someone may DO is a label.
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    app.call(|s| s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Admin))
        .unwrap();

    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.delete_document(doc))
        .unwrap();
    assert!(app.view(|s| s.list_documents()).unwrap().is_empty());
}

#[test]
fn setting_the_level_somebody_already_holds_is_a_no_op_not_an_error() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    app.call(|s| s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Sign))
        .unwrap();
    assert_eq!(permission_of(&app, BOB_ACCOUNT), PermissionLevel::Sign);
}

/// Levels live in `AccessControl`, whose grants converge last-writer-wins,
/// so a demotion is a real change: the demoted admin loses what an admin does.
#[test]
fn a_demotion_takes_the_power_away() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);
    app.call(|s| s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Admin))
        .unwrap();
    app.call(|s| s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Read))
        .unwrap();
    assert_eq!(permission_of(&app, BOB_ACCOUNT), PermissionLevel::Read);

    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.delete_document(doc.clone()))
        .unwrap_err();
    assert!(format!("{err:?}").contains("Admin permissions required"));
    assert!(
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.documents.remove(&doc))
            .is_err(),
        "nor is he a moderator of the documents any more"
    );
}

#[test]
fn the_last_admin_cannot_step_down() {
    let mut app = new_agreement();
    let err = app
        .call(|s| s.set_participant_permission(hexed(ALICE_ACCOUNT), PermissionLevel::Sign))
        .unwrap_err();
    assert!(format!("{err:?}").contains("at least one admin"), "{err:?}");
    assert_eq!(permission_of(&app, ALICE_ACCOUNT), PermissionLevel::Admin);
}

#[test]
fn a_non_participant_cannot_be_given_a_permission() {
    let mut app = new_agreement();
    let err = app
        .call(|s| s.set_participant_permission(hexed(BOB_ACCOUNT), PermissionLevel::Admin))
        .unwrap_err();
    assert!(
        format!("{err:?}").contains("not a participant"),
        "got: {err:?}"
    );
}

#[test]
fn removing_a_participant_takes_their_permission_with_them() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    app.call(|s| s.remove_participant(hexed(BOB_ACCOUNT)))
        .unwrap();

    assert!(app
        .view(|s| s.get_user_permission(hexed(BOB_ACCOUNT)))
        .is_err());
    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.add_participant(hexed(BOB_ACCOUNT), PermissionLevel::Admin)
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("User permissions not found"));

    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.register_self_as_participant()
        })
        .unwrap_err();
    assert!(
        format!("{err:?}").contains("removed"),
        "a removal outranks Bob's own registration: {err:?}"
    );
}

// ── whoami ───────────────────────────────────────────────────────────────

#[test]
fn whoami_is_the_account_not_the_device() {
    let mut app = new_agreement();
    assert_eq!(app.view(|s| s.whoami()), ALICE_ACCOUNT);
    // Same person, second machine: same answer. This is exactly what the
    // frontend could not work out for itself — a device key and an account
    // id are both 64 hex characters since rc.27.
    assert_eq!(
        app.call_as_account(ALICE_ACCOUNT, ALICE_PHONE, |s| s.whoami()),
        ALICE_ACCOUNT
    );
    assert_eq!(
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.whoami()),
        BOB_ACCOUNT
    );
}

// ── attribution ──────────────────────────────────────────────────────────

/// `upload_document` recorded `*self.owner.get()`, so every document in a
/// shared agreement was attributed to its CREATOR whoever uploaded it.
#[test]
fn a_document_is_attributed_to_whoever_uploaded_it() {
    let mut app = new_agreement();
    bob_joins(&mut app);

    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
        s.upload_document(
            "contract.pdf".to_owned(),
            "deadbeef".to_owned(),
            hexed([0x11; 32]),
            1024,
            None,
            None,
            None,
        )
    })
    .unwrap();

    let docs = app.view(|s| s.list_documents()).unwrap();
    assert_eq!(docs.len(), 1);
    assert_eq!(
        docs[0].uploaded_by, BOB_ACCOUNT,
        "the uploader, not the agreement's creator"
    );
}

// ── signatures and consent ───────────────────────────────────────────────

/// Sign whatever the document is currently at.
///
/// `sign_document` refuses a signature built from a stale copy, so the base
/// hash has to be read back rather than hard-coded: after the first
/// signature the document is no longer at the hash `upload_doc` gave it.
/// Each signature advances the hash to the next value in the chain, which is
/// what a real signer's freshly-flattened PDF does.
fn sign_as(
    app: &mut TestHost<MeroSignState>,
    account: [u8; 32],
    device: [u8; 32],
    doc: &str,
) -> app::Result<()> {
    let base = hash_of(app, doc);
    let next = format!("{base}-signed");
    app.call_as_account(account, device, |s| {
        s.sign_document(
            doc.to_owned(),
            base.clone(),
            hexed([0x22; 32]),
            2048,
            next.clone(),
        )
    })
}

fn hash_of(app: &TestHost<MeroSignState>, doc: &str) -> String {
    app.view(|s| s.list_documents())
        .unwrap()
        .into_iter()
        .find(|d| d.id == doc)
        .expect("document exists")
        .hash
}

fn status_of(app: &TestHost<MeroSignState>, doc: &str) -> DocumentStatus {
    app.view(|s| s.list_documents())
        .unwrap()
        .into_iter()
        .find(|d| d.id == doc)
        .expect("document exists")
        .status
}

fn signers_of(app: &TestHost<MeroSignState>, doc: &str) -> Vec<UserId> {
    app.view(|s| s.get_document_signatures(doc.to_owned()))
        .unwrap()
        .into_iter()
        .map(|sig| sig.signer)
        .collect()
}

/// ⚠️ THE ONE THAT MATTERS.
///
/// `sign_document` used to take `signer_id_str` and write it straight into
/// `DocumentSignature.signer`, with `env::account_id()` appearing nowhere in
/// the function. Its only gate was `check_consent` for the id the caller had
/// just supplied — circular, and satisfiable by the caller because
/// `set_consent` took the same unchecked id. So Bob could record Alice as
/// having signed a document she had never seen.
///
/// The parameter is gone, so the forgery is no longer expressible: this test
/// is the strongest statement the type system allows — whatever Bob does, the
/// signature that lands carries BOB.
#[test]
fn a_signature_is_always_attributed_to_the_caller() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    // Bob consents and signs. There is no argument with which he could name
    // anyone else, and he cannot consent on Alice's behalf either.
    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.set_consent(doc.clone()))
        .unwrap();
    sign_as(&mut app, BOB_ACCOUNT, BOB_DEVICE, &doc).unwrap();

    assert_eq!(
        signers_of(&app, &doc),
        vec![BOB_ACCOUNT],
        "the signature must carry the caller"
    );
    assert!(
        !signers_of(&app, &doc).contains(&ALICE_ACCOUNT),
        "Alice never signed and must not appear"
    );
}

/// Bob consenting does not let him sign as Alice, because consent is now
/// keyed by the caller too. Before, `set_consent(alice_id, doc)` from Bob
/// was accepted with no gate at all, which was the other half of the forgery.
#[test]
fn consent_is_recorded_for_the_caller_and_nobody_else() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.set_consent(doc.clone()))
        .unwrap();

    assert!(app
        .view(|s| s.has_consented(hexed(BOB_ACCOUNT), doc.clone()))
        .unwrap());
    assert!(
        !app.view(|s| s.has_consented(hexed(ALICE_ACCOUNT), doc.clone()))
            .unwrap(),
        "Bob's consent must not be recorded against Alice"
    );

    // And so Alice cannot be made to have signed: her consent is missing.
    let err = sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap_err();
    assert!(
        format!("{err:?}").contains("consent"),
        "expected a consent refusal, got: {err:?}"
    );
}

/// The other side of the same coin: signing as yourself still works, on any
/// of your devices, and is recorded once against your ACCOUNT.
#[test]
fn a_participant_can_sign_as_themselves_from_any_device() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    app.call_as_account(ALICE_ACCOUNT, ALICE_DEVICE, |s| s.set_consent(doc.clone()))
        .unwrap();
    // Consent on the laptop, sign on the phone: one person, one signature.
    sign_as(&mut app, ALICE_ACCOUNT, ALICE_PHONE, &doc).unwrap();

    assert_eq!(signers_of(&app, &doc), vec![ALICE_ACCOUNT]);
}

#[test]
fn signing_without_consenting_is_refused() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    let err = sign_as(&mut app, BOB_ACCOUNT, BOB_DEVICE, &doc).unwrap_err();
    assert!(format!("{err:?}").contains("consent"), "got: {err:?}");
    assert!(signers_of(&app, &doc).is_empty());
}

/// A signature from somebody who is not in the agreement is not a signature.
#[test]
fn a_non_participant_cannot_sign() {
    const NOBODY: [u8; 32] = [0xCC; 32];
    let mut app = new_agreement();
    let doc = upload_doc(&mut app);

    app.call_as_account(NOBODY, NOBODY, |s| s.set_consent(doc.clone()))
        .unwrap();
    let err = sign_as(&mut app, NOBODY, NOBODY, &doc).unwrap_err();
    assert!(
        format!("{err:?}").contains("not a participant"),
        "got: {err:?}"
    );
    assert!(signers_of(&app, &doc).is_empty());
}

// ── `Read` finally means something ───────────────────────────────────────

#[test]
fn a_reader_can_neither_upload_nor_sign() {
    const READER: [u8; 32] = [0xDD; 32];
    let mut app = new_agreement();
    // Only an admin can seat somebody at `Read`; `register_self_as_participant`
    // grants `Sign`.
    app.call(|s| s.add_participant(hexed(READER), PermissionLevel::Read))
        .unwrap();
    let doc = upload_doc(&mut app);

    let err = app
        .call_as_account(READER, READER, |s| {
            s.upload_document(
                "sneaky.pdf".to_owned(),
                "deadbeef".to_owned(),
                hexed([0x11; 32]),
                1,
                None,
                None,
                None,
            )
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("Sign"), "got: {err:?}");

    app.call_as_account(READER, READER, |s| s.set_consent(doc.clone()))
        .unwrap();
    let err = sign_as(&mut app, READER, READER, &doc).unwrap_err();
    assert!(format!("{err:?}").contains("Sign"), "got: {err:?}");
}

/// And a promotion makes both work — the roles are enforced, not decorative.
#[test]
fn promoting_a_reader_lets_them_sign() {
    const READER: [u8; 32] = [0xDD; 32];
    let mut app = new_agreement();
    app.call(|s| s.add_participant(hexed(READER), PermissionLevel::Read))
        .unwrap();
    let doc = upload_doc(&mut app);
    app.call_as_account(READER, READER, |s| s.set_consent(doc.clone()))
        .unwrap();

    app.call(|s| s.set_participant_permission(hexed(READER), PermissionLevel::Sign))
        .unwrap();

    sign_as(&mut app, READER, READER, &doc).unwrap();
    assert_eq!(signers_of(&app, &doc), vec![READER]);
}

// ── the all-signed count, which could never succeed before ───────────────

/// `mark_participant_signed` compares `sig.signer` against each entry of
/// `participants`. Signatures held the DEVICE key the frontend passed while
/// `participants` holds ACCOUNTS — both 32 bytes since rc.27 — so the
/// comparison matched nothing and no document could ever reach
/// `FullySigned`. With the signer derived from `env::account_id()` both
/// sides are in the same identity space.
#[test]
fn a_document_reaches_fully_signed_once_every_participant_has_signed() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    for (account, device) in [(ALICE_ACCOUNT, ALICE_DEVICE), (BOB_ACCOUNT, BOB_DEVICE)] {
        app.call_as_account(account, device, |s| s.set_consent(doc.clone()))
            .unwrap();
        sign_as(&mut app, account, device, &doc).unwrap();
        app.call_as_account(account, device, |s| s.mark_participant_signed(doc.clone()))
            .unwrap();
    }

    let docs = app.view(|s| s.list_documents()).unwrap();
    assert_eq!(docs[0].status, DocumentStatus::FullySigned);
}

#[test]
fn one_signature_short_is_not_fully_signed() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    app.call(|s| s.set_consent(doc.clone())).unwrap();
    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();
    app.call(|s| s.mark_participant_signed(doc.clone()))
        .unwrap();

    let docs = app.view(|s| s.list_documents()).unwrap();
    assert_eq!(docs[0].status, DocumentStatus::PartiallySigned);
}

#[test]
fn marking_yourself_signed_without_having_signed_is_refused() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);
    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.set_consent(doc.clone()))
        .unwrap();

    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.mark_participant_signed(doc.clone())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("not signed"), "got: {err:?}");
}

// ── two signatures must not destroy each other ──────────────────────────

/// The data-loss bug, stated directly.
///
/// Bob and Alice both open the document at the same version. Alice signs.
/// Bob's browser has already flattened his mark into the copy he downloaded,
/// so the PDF he is about to upload contains HIS signature and not hers —
/// saving it would overwrite `pdf_blob_id` and Alice's mark would be gone
/// from the artefact while her `DocumentSignature` row stayed behind.
///
/// Before the `base_hash` guard both calls returned `Ok`.
#[test]
fn a_signature_built_from_a_stale_copy_is_refused() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);

    // Both of them are looking at the same version.
    let what_they_both_opened = hash_of(&app, &doc);

    for (account, device) in [(ALICE_ACCOUNT, ALICE_DEVICE), (BOB_ACCOUNT, BOB_DEVICE)] {
        app.call_as_account(account, device, |s| s.set_consent(doc.clone()))
            .unwrap();
    }

    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();

    // Bob saves the copy he opened, which no longer reflects the document.
    let err = app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.sign_document(
                doc.clone(),
                what_they_both_opened.clone(),
                hexed([0x33; 32]),
                4096,
                "bob-only".to_owned(),
            )
        })
        .unwrap_err();
    assert!(
        format!("{err:?}").contains("changed while you were signing"),
        "got: {err:?}"
    );

    // Alice's signature survived, and hers is the PDF on record.
    assert_eq!(signers_of(&app, &doc), vec![ALICE_ACCOUNT]);
    assert_ne!(hash_of(&app, &doc), "bob-only");
}

/// And the recovery path works: re-open, re-sign, both signatures land.
#[test]
fn re_signing_from_the_current_version_succeeds() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);
    for (account, device) in [(ALICE_ACCOUNT, ALICE_DEVICE), (BOB_ACCOUNT, BOB_DEVICE)] {
        app.call_as_account(account, device, |s| s.set_consent(doc.clone()))
            .unwrap();
    }

    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();
    // `sign_as` re-reads the hash, which is what the UI does on reopen.
    sign_as(&mut app, BOB_ACCOUNT, BOB_DEVICE, &doc).unwrap();

    assert_eq!(signers_of(&app, &doc), vec![ALICE_ACCOUNT, BOB_ACCOUNT]);
}

// ── a viewer is finally possible ────────────────────────────────────────

/// A `Read` participant used to make completion unreachable: the all-signed
/// count demanded a signature from every participant, including the ones
/// `require_permission` would have refused one from. So the document sat at
/// `PartiallySigned` forever and nothing said why.
#[test]
fn a_viewer_does_not_block_completion() {
    const VIEWER: [u8; 32] = [0xDD; 32];
    let mut app = new_agreement();
    bob_joins(&mut app);
    app.call(|s| s.add_participant(hexed(VIEWER), PermissionLevel::Read))
        .unwrap();
    let doc = upload_doc(&mut app);

    for (account, device) in [(ALICE_ACCOUNT, ALICE_DEVICE), (BOB_ACCOUNT, BOB_DEVICE)] {
        app.call_as_account(account, device, |s| s.set_consent(doc.clone()))
            .unwrap();
        sign_as(&mut app, account, device, &doc).unwrap();
        app.call_as_account(account, device, |s| s.mark_participant_signed(doc.clone()))
            .unwrap();
    }

    assert_eq!(
        status_of(&app, &doc),
        DocumentStatus::FullySigned,
        "the viewer must not be counted among the signatures the document waits for"
    );
}

/// The other half: a viewer is still not a signature. Promote them and the
/// document is no longer complete-able without them.
#[test]
fn a_signer_still_blocks_completion() {
    const LATECOMER: [u8; 32] = [0xEE; 32];
    let mut app = new_agreement();
    app.call(|s| s.add_participant(hexed(LATECOMER), PermissionLevel::Sign))
        .unwrap();
    let doc = upload_doc(&mut app);

    app.call(|s| s.set_consent(doc.clone())).unwrap();
    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();
    app.call(|s| s.mark_participant_signed(doc.clone()))
        .unwrap();

    assert_eq!(status_of(&app, &doc), DocumentStatus::PartiallySigned);
}

// ── completion is a fact about the past ─────────────────────────────────

/// Adding a participant used to walk every `FullySigned` document and put it
/// back to `PartiallySigned`. A finished agreement un-finished itself, with
/// no event and no trace that it had ever been complete.
#[test]
fn a_completed_document_stays_completed_when_somebody_new_joins() {
    let mut app = new_agreement();
    let doc = upload_doc(&mut app);
    app.call(|s| s.set_consent(doc.clone())).unwrap();
    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();
    app.call(|s| s.mark_participant_signed(doc.clone()))
        .unwrap();
    assert_eq!(status_of(&app, &doc), DocumentStatus::FullySigned);

    bob_joins(&mut app);
    assert_eq!(
        status_of(&app, &doc),
        DocumentStatus::FullySigned,
        "a new participant must not reopen a document Alice already completed"
    );

    const VIEWER: [u8; 32] = [0xDD; 32];
    app.call(|s| s.add_participant(hexed(VIEWER), PermissionLevel::Read))
        .unwrap();
    app.call(|s| s.set_participant_permission(hexed(VIEWER), PermissionLevel::Sign))
        .unwrap();
    assert_eq!(
        status_of(&app, &doc),
        DocumentStatus::FullySigned,
        "neither must a promotion"
    );
}

fn upload_doc(app: &mut TestHost<MeroSignState>) -> String {
    app.call(|s| {
        s.upload_document(
            "contract.pdf".to_owned(),
            "deadbeef".to_owned(),
            hexed([0x11; 32]),
            1024,
            None,
            None,
            None,
        )
    })
    .unwrap()
}

// ── what holds against a modified node ──────────────────────────────────────

fn consent_all(app: &mut TestHost<MeroSignState>, doc: &str) {
    for (account, device) in [(ALICE_ACCOUNT, ALICE_DEVICE), (BOB_ACCOUNT, BOB_DEVICE)] {
        app.call_as_account(account, device, |s| s.set_consent(doc.to_owned()))
            .unwrap();
    }
}

fn version(base: &str, new: &str) -> SignedVersion {
    SignedVersion {
        base_hash: base.to_owned(),
        new_hash: new.to_owned(),
        pdf_blob_id: [0x44; 32],
        size: 1,
        signed_at: 0,
    }
}

/// A signature's signer is its entry's owner stamp. Bob writing a signature
/// entry under Alice's name, straight to storage, signs as Bob; a member who
/// is not a signer at all puts nothing on the document.
#[test]
fn a_signature_cannot_be_forged_in_someone_elses_name() {
    const MALLORY: [u8; 32] = [0xCC; 32];
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);
    let base = hash_of(&app, &doc);

    let (d, b) = (doc.clone(), base.clone());
    app.call_as_account(MALLORY, MALLORY, |s| {
        s.document_signatures.insert(
            format!("{d}/{}/x", hexed(ALICE_ACCOUNT)),
            version(&b, "mallory"),
        )
    })
    .unwrap();
    assert!(signers_of(&app, &doc).is_empty(), "Mallory is not a signer");
    assert_eq!(
        hash_of(&app, &doc),
        base,
        "and her version is not the document"
    );

    let (d, b) = (doc.clone(), base.clone());
    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
        s.document_signatures.insert(
            format!("{d}/{}/y", hexed(ALICE_ACCOUNT)),
            version(&b, "bob"),
        )
    })
    .unwrap();
    assert_eq!(
        signers_of(&app, &doc),
        vec![BOB_ACCOUNT],
        "the entry is Bob's, whatever its key says"
    );
}

/// Signatures and documents are written once: nobody, their author included,
/// edits one, and only an admin removes a document.
#[test]
fn a_signed_document_and_its_signatures_cannot_be_changed() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);
    consent_all(&mut app, &doc);
    sign_as(&mut app, BOB_ACCOUNT, BOB_DEVICE, &doc).unwrap();
    let signed_hash = hash_of(&app, &doc);

    let bobs_key = app.view(|s| {
        s.document_signatures
            .entries()
            .unwrap()
            .map(|(k, _)| k)
            .next()
            .unwrap()
    });
    let k = bobs_key.clone();
    assert!(
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.document_signatures.insert(k, version("x", "y"))
        })
        .is_err(),
        "a signature is written once"
    );

    // The uploaded document cannot be rewritten, by its uploader or anyone.
    let stored = app.view(|s| s.documents.get(&doc).unwrap().unwrap());
    for (account, device) in [(ALICE_ACCOUNT, ALICE_DEVICE), (BOB_ACCOUNT, BOB_DEVICE)] {
        let (d, mut forged) = (doc.clone(), stored.clone());
        forged.hash = "swapped".to_owned();
        assert!(app
            .call_as_account(account, device, |s| s.documents.insert(d, forged))
            .is_err());
    }
    assert!(
        app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| s.documents.remove(&doc))
            .is_err(),
        "only a moderator removes a document"
    );
    assert_eq!(hash_of(&app, &doc), signed_hash);
    assert_eq!(signers_of(&app, &doc), vec![BOB_ACCOUNT]);

    // Signing twice is refused; so is signing a completed document.
    let err = sign_as(&mut app, BOB_ACCOUNT, BOB_DEVICE, &doc).unwrap_err();
    assert!(format!("{err:?}").contains("already signed"), "{err:?}");
    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();
    assert_eq!(status_of(&app, &doc), DocumentStatus::FullySigned);
    const LATE: [u8; 32] = [0xEE; 32];
    app.call(|s| s.add_participant(hexed(LATE), PermissionLevel::Sign))
        .unwrap();
    app.call_as_account(LATE, LATE, |s| s.set_consent(doc.clone()))
        .unwrap();
    let err = sign_as(&mut app, LATE, LATE, &doc).unwrap_err();
    assert!(format!("{err:?}").contains("fully signed"), "{err:?}");
    assert_eq!(status_of(&app, &doc), DocumentStatus::FullySigned);
}

/// Two signatures built on the same version fork it. Every node keeps the
/// same one on the document; the other signer's mark is not in the current
/// PDF, so they are not counted and may sign again from it.
#[test]
fn a_forked_signature_is_off_the_document_until_re_signed() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    let doc = upload_doc(&mut app);
    consent_all(&mut app, &doc);
    let base = hash_of(&app, &doc);
    sign_as(&mut app, ALICE_ACCOUNT, ALICE_DEVICE, &doc).unwrap();

    // Bob's node skipped the stale-copy check, and signed the upload too.
    let mut late = version(&base, "bob-fork");
    late.signed_at = u64::MAX;
    let d = doc.clone();
    app.call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
        s.document_signatures
            .insert(format!("{d}/{}/z", hexed(BOB_ACCOUNT)), late)
    })
    .unwrap();
    assert_eq!(signers_of(&app, &doc), vec![ALICE_ACCOUNT]);
    assert_eq!(status_of(&app, &doc), DocumentStatus::PartiallySigned);

    sign_as(&mut app, BOB_ACCOUNT, BOB_DEVICE, &doc).unwrap();
    assert_eq!(signers_of(&app, &doc), vec![ALICE_ACCOUNT, BOB_ACCOUNT]);
    assert_eq!(status_of(&app, &doc), DocumentStatus::FullySigned);
}

/// Who may do what lives in `AccessControl`: a participant writing a grant
/// for themselves, straight to storage, is refused.
#[test]
fn a_participant_cannot_grant_themselves_admin() {
    let mut app = new_agreement();
    bob_joins(&mut app);
    assert!(app
        .call_as_account(BOB_ACCOUNT, BOB_DEVICE, |s| {
            s.roles.grant_admin(AccountId::from(BOB_ACCOUNT))
        })
        .is_err());
    assert_eq!(permission_of(&app, BOB_ACCOUNT), PermissionLevel::Sign);
}

#[test]
fn list_documents_leaves_out_the_search_content() {
    let mut app = new_agreement();
    let doc = app
        .call(|s| {
            s.upload_document(
                "contract.pdf".to_owned(),
                "deadbeef".to_owned(),
                hexed([0x11; 32]),
                1024,
                Some(vec![1.0, 0.0]),
                Some("the whole text".to_owned()),
                None,
            )
        })
        .unwrap();
    let listed = app.view(|s| s.list_documents()).unwrap();
    assert!(listed[0].embeddings.is_none() && listed[0].extracted_text.is_none());
    assert_eq!(listed[0].required_signers, vec![ALICE_ACCOUNT]);
    let found = app
        .view(|s| s.search_document_by_embedding(vec![1.0, 0.0], doc.clone()))
        .unwrap();
    assert!(found.contains("the whole text"), "{found}");
}
