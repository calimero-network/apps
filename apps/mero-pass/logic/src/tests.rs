use calimero_sdk::testing::TestHost;

use super::*;

// The vault's creator. `TestHost::new` runs `init` as this account.
fn creator(app: &TestHost<MeroPassApp>) -> String {
    hex::encode(app.account_id())
}

// A second PERSON. Both axes move: `call_as` alone shifts only the device, and
// a test using it for "somebody else" would silently assert nothing once
// authorization is account-keyed.
const BOB: [u8; 32] = [0xB0; 32];
const BOB_LAPTOP: [u8; 32] = [0xB1; 32];
const CAROL: [u8; 32] = [0xC0; 32];
const CAROL_PHONE: [u8; 32] = [0xC1; 32];

fn bob() -> String {
    hex::encode(BOB)
}

fn fp(n: u8) -> String {
    hex::encode([n; 32])
}

/// A well-formed, unique secret id, as the client would generate one.
fn sid() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT: AtomicU32 = AtomicU32::new(1);
    format!("secret_{:032x}", NEXT.fetch_add(1, Ordering::Relaxed))
}

fn new_vault() -> TestHost<MeroPassApp> {
    TestHost::new(|| MeroPassApp::init("Shared credentials".to_owned()))
}

fn fields(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

fn add_login(app: &mut TestHost<MeroPassApp>) -> String {
    let id = sid();
    app.call(|s| {
        s.add_secret(
            id.clone(),
            "login".to_owned(),
            "enc:name".to_owned(),
            "enc:tags".to_owned(),
            fields(&[
                ("username", "enc:u"),
                ("password", "enc:p1"),
                ("url", "enc:url1"),
            ]),
        )
    })
    .unwrap()
}

fn make(app: &mut TestHost<MeroPassApp>, account: &str, role: &str) {
    app.call(|s| s.set_role(account.to_owned(), role.to_owned()))
        .unwrap();
}

// ── The vault ───────────────────────────────────────────────────────────────

#[test]
fn the_creator_is_the_first_admin_and_the_name_is_kept() {
    let app = new_vault();
    let info = app.view(|s| s.vault_info()).unwrap();
    assert_eq!(info.name, "Shared credentials");
    assert_eq!(info.my_role, "admin");
    assert_eq!(info.my_account, creator(&app));
    assert_eq!(info.default_role, "editor", "unset default reads as editor");
    assert!(
        info.current_key.is_empty(),
        "no key until the client bootstraps one"
    );
}

// ── Secrets are stored as the client sent them ──────────────────────────────

#[test]
fn a_secret_round_trips_as_ciphertext_with_a_cleartext_kind() {
    let mut app = new_vault();
    let id = add_login(&mut app);
    let got = app.view(|s| s.get_secret(id.clone())).unwrap().unwrap();
    assert_eq!(got.kind, "login");
    assert_eq!(got.name, "enc:name");
    assert_eq!(
        got.fields.get("password").map(String::as_str),
        Some("enc:p1")
    );
    assert_eq!(got.created_by, creator(&app));
    assert!(!got.trashed);
}

#[test]
fn two_secrets_added_together_do_not_share_an_id() {
    let mut app = new_vault();
    let a = add_login(&mut app);
    let b = add_login(&mut app);
    assert_ne!(a, b);
    assert_eq!(app.view(|s| s.list_secrets()).unwrap().len(), 2);
}

#[test]
fn an_unknown_kind_is_refused() {
    let mut app = new_vault();
    let res = app.call(|s| {
        s.add_secret(
            sid(),
            "bitcoin_wallet".to_owned(),
            "n".to_owned(),
            "t".to_owned(),
            BTreeMap::new(),
        )
    });
    assert!(res.is_err());
}

// ── Field-level edits ───────────────────────────────────────────────────────

#[test]
fn editing_one_field_leaves_the_others_alone_and_keeps_history() {
    let mut app = new_vault();
    let id = add_login(&mut app);

    // Two edits to two different fields, as two members would make them.
    app.call(|s| {
        s.update_secret(
            id.clone(),
            None,
            None,
            fields(&[("url", "enc:url2")]),
            false,
        )
    })
    .unwrap();
    app.call(|s| {
        s.update_secret(
            id.clone(),
            None,
            None,
            fields(&[("password", "enc:p2")]),
            false,
        )
    })
    .unwrap();

    let got = app.view(|s| s.get_secret(id.clone())).unwrap().unwrap();
    assert_eq!(got.fields["url"], "enc:url2", "the URL edit survived");
    assert_eq!(
        got.fields["password"], "enc:p2",
        "the password edit survived"
    );
    assert_eq!(
        got.fields["username"], "enc:u",
        "an untouched field is untouched"
    );

    let history = app.view(|s| s.secret_history(id)).unwrap();
    let previous: Vec<(&str, &str)> = history
        .iter()
        .map(|r| (r.field.as_str(), r.previous.as_str()))
        .collect();
    assert!(
        previous.contains(&("password", "enc:p1")),
        "old password is restorable"
    );
    assert!(previous.contains(&("url", "enc:url1")));
}

#[test]
fn an_unchanged_value_does_not_write_history() {
    let mut app = new_vault();
    let id = add_login(&mut app);
    app.call(|s| {
        s.update_secret(
            id.clone(),
            None,
            None,
            fields(&[("password", "enc:p1")]),
            false,
        )
    })
    .unwrap();
    assert!(app.view(|s| s.secret_history(id)).unwrap().is_empty());
}

#[test]
fn a_rekey_rewrites_ciphertext_without_polluting_history() {
    let mut app = new_vault();
    let id = add_login(&mut app);
    app.call(|s| {
        s.update_secret(
            id.clone(),
            Some("enc2:name".to_owned()),
            None,
            fields(&[("password", "enc2:p1")]),
            true,
        )
    })
    .unwrap();
    let got = app.view(|s| s.get_secret(id.clone())).unwrap().unwrap();
    assert_eq!(got.name, "enc2:name");
    assert!(app.view(|s| s.secret_history(id)).unwrap().is_empty());
}

#[test]
fn an_empty_value_clears_a_field() {
    let mut app = new_vault();
    let id = add_login(&mut app);
    app.call(|s| s.update_secret(id.clone(), None, None, fields(&[("url", "")]), false))
        .unwrap();
    let got = app.view(|s| s.get_secret(id)).unwrap().unwrap();
    assert!(!got.fields.contains_key("url"));
}

#[test]
fn updating_a_missing_secret_is_an_error() {
    let mut app = new_vault();
    let res =
        app.call(|s| s.update_secret("secret_nope".to_owned(), None, None, BTreeMap::new(), false));
    assert!(res.is_err());
}

// ── Roles ───────────────────────────────────────────────────────────────────

#[test]
fn a_member_without_a_role_is_view_only() {
    let mut app = new_vault();
    let id = add_login(&mut app);

    let add = app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.add_secret(
            sid(),
            "login".to_owned(),
            "n".to_owned(),
            "t".to_owned(),
            BTreeMap::new(),
        )
    });
    assert!(add.is_err(), "a viewer cannot add");
    let edit = app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.update_secret(id.clone(), None, None, fields(&[("password", "x")]), false)
    });
    assert!(edit.is_err(), "a viewer cannot edit");
    let trash = app.call_as_account(BOB, BOB_LAPTOP, |s| s.trash_secret(id.clone()));
    assert!(trash.is_err(), "a viewer cannot trash");

    // But can read.
    let seen = app
        .call_as_account(BOB, BOB_LAPTOP, |s| s.list_secrets())
        .unwrap();
    assert_eq!(seen.len(), 1);
}

#[test]
fn an_editor_can_write_but_not_administer() {
    let mut app = new_vault();
    make(&mut app, &bob(), "editor");

    let id = app
        .call_as_account(BOB, BOB_LAPTOP, |s| {
            s.add_secret(
                sid(),
                "login".to_owned(),
                "n".to_owned(),
                "t".to_owned(),
                BTreeMap::new(),
            )
        })
        .expect("an editor can add");
    assert_eq!(
        app.call_as_account(BOB, BOB_LAPTOP, |s| s.vault_info())
            .unwrap()
            .my_role,
        "editor"
    );

    let promote = app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.set_role(hex::encode(CAROL), "editor".to_owned())
    });
    assert!(promote.is_err(), "an editor cannot hand out roles");

    // Editors trash; only admins purge.
    app.call_as_account(BOB, BOB_LAPTOP, |s| s.trash_secret(id.clone()))
        .unwrap();
    let purge = app.call_as_account(BOB, BOB_LAPTOP, |s| s.purge_secret(id.clone()));
    assert!(
        purge.is_err(),
        "an editor cannot make a secret unrecoverable"
    );
}

#[test]
fn demoting_an_editor_takes_write_away() {
    let mut app = new_vault();
    make(&mut app, &bob(), "editor");
    make(&mut app, &bob(), "viewer");
    let add = app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.add_secret(
            sid(),
            "login".to_owned(),
            "n".to_owned(),
            "t".to_owned(),
            BTreeMap::new(),
        )
    });
    assert!(add.is_err());
}

#[test]
fn a_second_admin_can_purge_and_the_last_admin_cannot_step_down() {
    let mut app = new_vault();
    let me = creator(&app);
    let alone = app.call(|s| s.set_role(me.clone(), "viewer".to_owned()));
    assert!(alone.is_err(), "the only admin cannot demote themselves");

    make(&mut app, &bob(), "admin");
    let id = add_login(&mut app);
    app.call(|s| s.trash_secret(id.clone())).unwrap();
    app.call_as_account(BOB, BOB_LAPTOP, |s| s.purge_secret(id.clone()))
        .expect("a second admin can purge");
    assert!(app.view(|s| s.get_secret(id)).unwrap().is_none());

    // Now there are two, so stepping down works.
    app.call(|s| s.set_role(me, "editor".to_owned())).unwrap();
}

#[test]
fn an_unknown_role_is_refused() {
    let mut app = new_vault();
    let res = app.call(|s| s.set_role(bob(), "owner".to_owned()));
    assert!(res.is_err());
}

#[test]
fn roles_are_explicit_and_pending_is_not_viewer() {
    let mut app = new_vault();
    app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.register_device(fp(2), "pk".to_owned(), String::new(), "browser".to_owned())
    })
    .unwrap();
    let role = |app: &TestHost<MeroPassApp>| {
        app.view(|s| s.list_members())
            .unwrap()
            .into_iter()
            .find(|m| m.account == bob())
            .map(|m| m.role)
    };
    assert_eq!(role(&app).as_deref(), Some("pending"));
    assert_eq!(
        app.call_as_account(BOB, BOB_LAPTOP, |s| s.vault_info())
            .unwrap()
            .my_role,
        "pending"
    );
    make(&mut app, &bob(), "viewer");
    assert_eq!(role(&app).as_deref(), Some("viewer"));
    make(&mut app, &bob(), "editor");
    assert_eq!(role(&app).as_deref(), Some("editor"));
}

#[test]
fn a_removed_member_who_re_registers_is_marked_removed_until_re_admitted() {
    let mut app = new_vault();
    make(&mut app, &bob(), "viewer");
    app.call(|s| s.remove_member(bob())).unwrap();
    app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.register_device(fp(7), "pk".to_owned(), String::new(), "browser".to_owned())
    })
    .unwrap();
    let row = |app: &TestHost<MeroPassApp>| {
        app.view(|s| s.list_members())
            .unwrap()
            .into_iter()
            .find(|m| m.account == bob())
            .map(|m| m.role)
    };
    assert_eq!(row(&app).as_deref(), Some("removed"), "never auto-admitted");
    make(&mut app, &bob(), "viewer");
    assert_eq!(
        row(&app).as_deref(),
        Some("viewer"),
        "an explicit role re-admits"
    );
}

#[test]
fn a_client_id_must_be_well_formed_and_unused() {
    let mut app = new_vault();
    let bad = app.call(|s| {
        s.add_secret(
            "secret_xyz".to_owned(),
            "login".to_owned(),
            "n".to_owned(),
            "t".to_owned(),
            BTreeMap::new(),
        )
    });
    assert!(bad.is_err());
    let id = add_login(&mut app);
    let dup = app.call(|s| {
        s.add_secret(
            id.clone(),
            "login".to_owned(),
            "other".to_owned(),
            "t".to_owned(),
            BTreeMap::new(),
        )
    });
    assert!(dup.is_err(), "an existing id is refused, not overwritten");
    let kept = app.view(|s| s.get_secret(id)).unwrap().unwrap();
    assert_eq!(kept.name, "enc:name");
}

// ── Trash ───────────────────────────────────────────────────────────────────

#[test]
fn trash_is_recoverable_and_purge_needs_the_trash_first() {
    let mut app = new_vault();
    let id = add_login(&mut app);

    let early = app.call(|s| s.purge_secret(id.clone()));
    assert!(early.is_err(), "a live secret cannot be purged");

    app.call(|s| s.trash_secret(id.clone())).unwrap();
    let got = app.view(|s| s.get_secret(id.clone())).unwrap().unwrap();
    assert!(got.trashed && got.trashed_at > 0);

    app.call(|s| s.restore_secret(id.clone())).unwrap();
    let got = app.view(|s| s.get_secret(id.clone())).unwrap().unwrap();
    assert!(!got.trashed);

    app.call(|s| s.update_secret(id.clone(), None, None, fields(&[("password", "p9")]), false))
        .unwrap();
    app.call(|s| s.trash_secret(id.clone())).unwrap();
    app.call(|s| s.purge_secret(id.clone())).unwrap();
    assert!(app.view(|s| s.get_secret(id.clone())).unwrap().is_none());
    assert!(
        app.view(|s| s.secret_history(id)).unwrap().is_empty(),
        "purge takes the history with it"
    );
}

// ── Devices and key wraps ───────────────────────────────────────────────────

#[test]
fn a_device_is_registered_under_the_callers_account() {
    let mut app = new_vault();
    app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.register_device(
            fp(1),
            "pk".to_owned(),
            "Bob's laptop".to_owned(),
            "browser".to_owned(),
        )
    })
    .unwrap();
    let devices = app.view(|s| s.list_devices()).unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].account, bob(), "account comes from the host");

    let members = app.view(|s| s.list_members()).unwrap();
    let bob_row = members.iter().find(|m| m.account == bob()).unwrap();
    assert_eq!(
        bob_row.role, "pending",
        "a device without a role is pending"
    );
    assert_eq!(bob_row.devices, 1);
}

#[test]
fn a_malformed_fingerprint_is_refused() {
    let mut app = new_vault();
    let res = app.call(|s| {
        s.register_device(
            "abc".to_owned(),
            "pk".to_owned(),
            String::new(),
            "browser".to_owned(),
        )
    });
    assert!(res.is_err());
}

#[test]
fn wraps_only_land_on_registered_unrevoked_devices() {
    let mut app = new_vault();
    app.call(|s| s.register_device(fp(1), "pk1".to_owned(), String::new(), "browser".to_owned()))
        .unwrap();
    app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.register_device(fp(2), "pk2".to_owned(), String::new(), "browser".to_owned())
    })
    .unwrap();

    let wrap = |recipient: String| KeyWrapInput {
        key_id: "k1".to_owned(),
        recipient,
        wrapper: fp(1),
        envelope: "env".to_owned(),
    };
    let added = app
        .call(|s| s.add_key_wraps(vec![wrap(fp(1)), wrap(fp(2)), wrap(fp(9))]))
        .unwrap();
    assert_eq!(added, 2, "the unregistered recipient is skipped");

    // A second identical wrap is a no-op, not an overwrite.
    let again = app.call(|s| s.add_key_wraps(vec![wrap(fp(2))])).unwrap();
    assert_eq!(again, 0);

    let for_bob = app.view(|s| s.key_wraps_for(fp(2))).unwrap();
    assert_eq!(for_bob.len(), 1);
    assert_eq!(for_bob[0].wrapped_by, creator(&app));
    assert_eq!(
        app.view(|s| s.wrapped_pairs()).unwrap(),
        vec![format!("k1:{}", fp(1)), format!("k1:{}", fp(2))]
    );

    app.call(|s| s.revoke_device(fp(2))).unwrap();
    let late = KeyWrapInput {
        key_id: "k2".to_owned(),
        ..wrap(fp(2))
    };
    assert_eq!(
        app.call(|s| s.add_key_wraps(vec![late])).unwrap(),
        0,
        "a revoked device gets no new key"
    );
}

#[test]
fn switching_keys_needs_a_wrap_and_an_admin() {
    let mut app = new_vault();
    let early = app.call(|s| s.rotate_key("k1".to_owned()));
    assert!(early.is_err(), "no wrap of k1 exists yet");

    app.call(|s| s.register_device(fp(1), "pk".to_owned(), String::new(), "browser".to_owned()))
        .unwrap();
    app.call(|s| {
        s.add_key_wraps(vec![KeyWrapInput {
            key_id: "k1".to_owned(),
            recipient: fp(1),
            wrapper: fp(1),
            envelope: "env".to_owned(),
        }])
    })
    .unwrap();
    app.call(|s| s.rotate_key("k1".to_owned())).unwrap();
    assert_eq!(app.view(|s| s.vault_info()).unwrap().current_key, "k1");

    make(&mut app, &bob(), "editor");
    let by_editor = app.call_as_account(BOB, BOB_LAPTOP, |s| s.rotate_key("k1".to_owned()));
    assert!(by_editor.is_err());
}

#[test]
fn an_owner_can_revoke_their_own_device_but_not_someone_elses() {
    let mut app = new_vault();
    app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.register_device(fp(2), "pk".to_owned(), String::new(), "browser".to_owned())
    })
    .unwrap();
    app.call_as_account(CAROL, CAROL_PHONE, |s| {
        s.register_device(fp(3), "pk".to_owned(), String::new(), "browser".to_owned())
    })
    .unwrap();

    let theirs = app.call_as_account(BOB, BOB_LAPTOP, |s| s.revoke_device(fp(3)));
    assert!(theirs.is_err());

    app.call_as_account(BOB, BOB_LAPTOP, |s| s.revoke_device(fp(2)))
        .unwrap();
    let left: Vec<String> = app
        .view(|s| s.list_devices())
        .unwrap()
        .into_iter()
        .map(|d| d.fingerprint)
        .collect();
    assert_eq!(left, vec![fp(3)]);
}

#[test]
fn removing_a_member_drops_their_role_and_revokes_their_devices() {
    let mut app = new_vault();
    make(&mut app, &bob(), "editor");
    app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.register_device(fp(2), "pk".to_owned(), String::new(), "browser".to_owned())
    })
    .unwrap();

    app.call(|s| s.remove_member(bob())).unwrap();

    let add = app.call_as_account(BOB, BOB_LAPTOP, |s| {
        s.add_secret(
            sid(),
            "login".to_owned(),
            "n".to_owned(),
            "t".to_owned(),
            BTreeMap::new(),
        )
    });
    assert!(add.is_err(), "a removed editor can no longer write");
    let devices = app.view(|s| s.list_devices()).unwrap();
    assert!(devices.iter().all(|d| d.revoked));
    assert!(
        app.view(|s| s.list_members())
            .unwrap()
            .iter()
            .all(|m| m.account != bob()),
        "a removed member with only revoked devices is not listed"
    );

    let me = creator(&app);
    assert!(
        app.call(|s| s.remove_member(me)).is_err(),
        "cannot remove yourself"
    );
}

// ── Audit ───────────────────────────────────────────────────────────────────

#[test]
fn every_change_is_audited_with_device_and_without_names() {
    let mut app = new_vault();
    let id = add_login(&mut app);
    app.call(|s| s.update_secret(id.clone(), None, None, fields(&[("password", "p2")]), false))
        .unwrap();
    app.call(|s| s.trash_secret(id.clone())).unwrap();
    app.call(|s| s.rename_vault("Ops".to_owned())).unwrap();

    let logs = app.view(|s| s.get_audit_logs()).unwrap();
    let actions: Vec<&str> = logs.iter().map(|l| l.action.as_str()).collect();
    for expected in [
        "secret_added",
        "secret_updated",
        "secret_trashed",
        "vault_renamed",
    ] {
        assert!(
            actions.contains(&expected),
            "missing {expected}: {actions:?}"
        );
    }
    for entry in &logs {
        assert_eq!(entry.account, creator(&app));
        assert_eq!(entry.device.len(), 64, "the device is recorded");
        assert!(
            !entry.target.contains("enc:"),
            "no ciphertext or names in the trail"
        );
        assert!(!entry.redacted);
    }
    for pair in logs.windows(2) {
        assert!(pair[0].timestamp >= pair[1].timestamp, "newest first");
    }
}

#[test]
fn events_carry_ids_only() {
    let mut app = new_vault();
    let _ = app.take_events();
    let id = add_login(&mut app);
    let events = app.take_events();
    assert!(!events.is_empty());
    let changed = events
        .iter()
        .find(|e| e.kind == "SecretChanged")
        .expect("a SecretChanged event");
    let rendered = String::from_utf8_lossy(&changed.data).into_owned();
    assert!(
        rendered.contains(&id),
        "the event names the secret: {rendered}"
    );
    assert!(
        !rendered.contains("enc:"),
        "no secret material in events: {rendered}"
    );
}

#[test]
fn a_device_records_its_kind_and_unknown_kinds_are_refused() {
    let mut app = new_vault();
    app.call(|s| {
        s.register_device(
            fp(4),
            "pk".to_owned(),
            "Recovery key".to_owned(),
            "recovery".to_owned(),
        )
    })
    .unwrap();
    let devices = app.view(|s| s.list_devices()).unwrap();
    assert_eq!(devices[0].kind, "recovery");

    let bad =
        app.call(|s| s.register_device(fp(5), "pk".to_owned(), String::new(), "phone".to_owned()));
    assert!(bad.is_err());
}
