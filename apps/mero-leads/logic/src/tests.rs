//! In-process tests: TestHost drives real CRDT state with no node and no wasm.
//!
//! "Someone else" is always a second ACCOUNT. `call_as` alone moves only the
//! device and keeps the account, which models one person's second machine —
//! and since authorship is per account, a test using it for another person
//! would silently assert nothing.

use calimero_sdk::testing::TestHost;

use super::*;

/// The installer (TestHost's default account) is the first admin.
const FORM: [u8; 32] = [0xF0; 32];
const FORM_DEVICE: [u8; 32] = [0xF1; 32];
const BOB: [u8; 32] = [0xB0; 32];
const BOB_DEVICE: [u8; 32] = [0xB1; 32];

fn inbox() -> TestHost<MeroLeads> {
    TestHost::new(MeroLeads::init)
}

fn account(bytes: [u8; 32]) -> AccountId {
    AccountId::from(bytes)
}

/// A lead sent by the website form, i.e. by the form key's account.
fn submit_from_form(app: &mut TestHost<MeroLeads>, name: &str) -> String {
    app.call_as_account(FORM, FORM_DEVICE, |s| {
        s.submit_lead(
            name.to_owned(),
            "ada@example.com".to_owned(),
            "Analytical Engines".to_owned(),
            "We'd like to run a sealed node.".to_owned(),
            "/contact/".to_owned(),
        )
    })
    .unwrap()
}

fn add_bob(app: &mut TestHost<MeroLeads>) {
    app.call(|s| s.add_team_member(account(BOB).to_string()))
        .unwrap();
}

#[test]
fn the_form_submits_and_the_team_sees_it_as_new() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "  Ada Lovelace ");
    assert_eq!(id.len(), 32);

    let leads = app.view(|s| s.list_leads()).unwrap();
    assert_eq!(leads.len(), 1);
    let lead = &leads[0];
    assert_eq!(lead.id, id);
    assert_eq!(lead.name, "Ada Lovelace");
    assert_eq!(lead.status, "new");
    assert_eq!(lead.submitted_by, account(FORM).to_string());
    assert_eq!(lead.updated_at, 0);
}

#[test]
fn events_carry_ids_never_contact_details() {
    let mut app = inbox();
    let _ = app.take_events();
    submit_from_form(&mut app, "Ada");
    let events = format!("{:?}", app.take_events());
    assert!(events.contains("Submitted"));
    assert!(!events.contains("ada@example.com"));
    assert!(!events.contains("sealed node"));
}

#[test]
fn a_submission_is_checked_like_the_form_checks_it() {
    let mut app = inbox();
    let submit = |app: &mut TestHost<MeroLeads>, name: &str, email: &str, message: &str| {
        let (name, email, message) = (name.to_owned(), email.to_owned(), message.to_owned());
        app.call_as_account(FORM, FORM_DEVICE, move |s| {
            s.submit_lead(name, email, String::new(), message, String::new())
        })
    };
    assert!(submit(&mut app, "", "a@b.co", "hi").is_err());
    assert!(submit(&mut app, "Ada", "", "hi").is_err());
    assert!(submit(&mut app, "Ada", "a@b.co", "   ").is_err());
    for bad in ["nope", "a@b", "a b@c.co", "@b.co", "a@b.co.", "a@@b.co"] {
        assert!(
            submit(&mut app, "Ada", bad, "hi").is_err(),
            "{bad} should be refused"
        );
    }
    assert!(submit(&mut app, &"x".repeat(201), "a@b.co", "hi").is_err());
    assert!(submit(&mut app, "Ada", "a@b.co", &"x".repeat(5_001)).is_err());
    assert!(submit(&mut app, "Ada", "a@b.co", "hi").is_ok());
}

#[test]
fn only_the_team_reads_and_edits() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "Ada");

    // The form key can add leads and nothing else.
    app.call_as_account(FORM, FORM_DEVICE, |s| {
        assert!(s.list_leads().is_err());
        assert!(s.get_lead(id.clone()).is_err());
        assert!(s.set_status(id.clone(), "won".into()).is_err());
        assert!(s.list_team().is_err());
        assert!(!s.am_i_team().unwrap());
    });
    assert!(app.view(|s| s.am_i_team()).unwrap());
    assert!(app.view(|s| s.am_i_admin()).unwrap());
}

/// What keeps a patched node out is the pipeline's writer set, checked by
/// every RECEIVING node at merge — which one TestHost cannot play. What it can
/// show is that the set is exactly the team, at every change, and never holds
/// a form key: that is the set those nodes check against.
#[test]
fn the_pipeline_is_writable_by_exactly_the_team() {
    let mut app = inbox();
    let me = account(app.account_id());
    assert_eq!(app.view(|s| s.pipeline.writers()), BTreeSet::from([me]));

    add_bob(&mut app);
    assert_eq!(
        app.view(|s| s.pipeline.writers()),
        BTreeSet::from([me, account(BOB)])
    );

    app.call(|s| s.remove_team_member(account(BOB).to_string()))
        .unwrap();
    assert_eq!(app.view(|s| s.pipeline.writers()), BTreeSet::from([me]));
}

#[test]
fn edits_lay_over_the_submission_and_never_rewrite_it() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "Ada");
    let lead = app
        .call(|s| {
            s.update_lead(
                id.clone(),
                LeadChanges {
                    name: Some(" Ada King ".into()),
                    company: Some("Lovelace & Co".into()),
                    notes: Some("Met at Devcon".into()),
                    ..LeadChanges::default()
                },
            )
        })
        .unwrap();
    assert_eq!(lead.name, "Ada King");
    assert_eq!(lead.original_name, "Ada");
    assert_eq!(lead.company, "Lovelace & Co");
    assert_eq!(lead.email, "ada@example.com");
    assert_eq!(lead.notes, "Met at Devcon");
    assert!(lead.updated_at > 0);
    assert_eq!(lead.updated_by, app.view(|s| s.my_account()).unwrap());

    // An empty correction goes back to what was submitted.
    let lead = app
        .call(|s| {
            s.update_lead(
                id.clone(),
                LeadChanges {
                    name: Some(String::new()),
                    ..LeadChanges::default()
                },
            )
        })
        .unwrap();
    assert_eq!(lead.name, "Ada");
    // The other edits are untouched by a change to one field.
    assert_eq!(lead.company, "Lovelace & Co");
    assert_eq!(lead.notes, "Met at Devcon");
}

#[test]
fn a_lead_moves_through_the_pipeline_and_only_to_real_statuses() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "Ada");
    for status in ["contacted", "qualified", "won"] {
        let lead = app
            .call(|s| s.set_status(id.clone(), status.into()))
            .unwrap();
        assert_eq!(lead.status, status);
    }
    assert!(app
        .call(|s| s.set_status(id.clone(), "maybe".into()))
        .is_err());
    assert_eq!(app.view(|s| s.get_lead(id.clone())).unwrap().status, "won");
    assert_eq!(
        app.view(|s| s.statuses()).unwrap(),
        STATUSES.map(str::to_owned).to_vec()
    );
}

#[test]
fn edits_are_checked() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "Ada");
    let try_change = |app: &mut TestHost<MeroLeads>, changes: LeadChanges| {
        let id = id.clone();
        app.call(move |s| s.update_lead(id, changes))
    };
    assert!(try_change(
        &mut app,
        LeadChanges {
            email: Some("nope".into()),
            ..Default::default()
        }
    )
    .is_err());
    assert!(try_change(
        &mut app,
        LeadChanges {
            notes: Some("x".repeat(10_001)),
            ..Default::default()
        }
    )
    .is_err());
    assert!(try_change(
        &mut app,
        LeadChanges {
            owner: Some("not-hex".into()),
            ..Default::default()
        }
    )
    .is_err());
    // An owner has to be on the team.
    let off_team = account(FORM).to_string();
    assert!(try_change(
        &mut app,
        LeadChanges {
            owner: Some(off_team),
            ..Default::default()
        }
    )
    .is_err());
    assert!(app
        .call(|s| s.update_lead("missing".into(), LeadChanges::default()))
        .is_err());
}

#[test]
fn an_admin_adds_a_teammate_who_can_then_work_the_leads() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "Ada");
    add_bob(&mut app);

    let bob = app.call_as_account(BOB, BOB_DEVICE, |s| {
        assert!(s.am_i_team().unwrap());
        assert!(!s.am_i_admin().unwrap());
        // A teammate is not an admin: the team is the admins' to change.
        assert!(s.add_team_member(account(FORM).to_string()).is_err());
        s.set_status(id.clone(), "contacted".into())
    });
    assert_eq!(bob.unwrap().updated_by, account(BOB).to_string());

    // Bob can now own a lead.
    let lead = app
        .call(|s| {
            s.update_lead(
                id.clone(),
                LeadChanges {
                    owner: Some(account(BOB).to_string()),
                    ..LeadChanges::default()
                },
            )
        })
        .unwrap();
    assert_eq!(lead.owner, account(BOB).to_string());

    let team = app.view(|s| s.list_team()).unwrap();
    assert_eq!(team.len(), 2);
    assert!(team
        .iter()
        .any(|m| m.account == account(BOB).to_string() && !m.admin));
    assert!(team.iter().any(|m| m.admin));
}

#[test]
fn removing_a_teammate_takes_the_inbox_away() {
    let mut app = inbox();
    let id = submit_from_form(&mut app, "Ada");
    add_bob(&mut app);
    app.call(|s| s.remove_team_member(account(BOB).to_string()))
        .unwrap();
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        assert!(s.list_leads().is_err());
        assert!(s.set_status(id.clone(), "won".into()).is_err());
    });
}

#[test]
fn newest_first() {
    let mut app = inbox();
    let first = submit_from_form(&mut app, "First");
    let second = submit_from_form(&mut app, "Second");
    let ids: Vec<String> = app
        .view(|s| s.list_leads())
        .unwrap()
        .into_iter()
        .map(|l| l.id)
        .collect();
    assert_eq!(ids, vec![second, first]);
}

#[test]
fn the_team_names_the_inbox_and_the_form_cannot() {
    let mut app = inbox();
    assert_eq!(app.view(|s| s.inbox_name()).unwrap(), "");
    app.call(|s| s.set_inbox_name("  Website leads ".into()))
        .unwrap();
    assert_eq!(app.view(|s| s.inbox_name()).unwrap(), "Website leads");
    app.call_as_account(FORM, FORM_DEVICE, |s| {
        assert_eq!(s.inbox_name().unwrap(), "Website leads");
        assert!(s.set_inbox_name("pwned".into()).is_err());
    });
}

#[test]
fn admins_register_form_keys_and_see_what_each_sent() {
    let mut app = inbox();
    app.call(|s| s.register_form_key(account(FORM).to_string(), " Contact form ".into()))
        .unwrap();
    submit_from_form(&mut app, "Ada");
    submit_from_form(&mut app, "Grace");

    let keys = app.view(|s| s.list_form_keys()).unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].account, account(FORM).to_string());
    assert_eq!(keys[0].label, "Contact form");
    assert_eq!(keys[0].leads, 2);
    assert!(keys[0].last_lead_at > 0);

    // A form key can never be on the team, and the register is the admins'.
    assert!(app
        .call(|s| s.add_team_member(account(FORM).to_string()))
        .is_err());
    add_bob(&mut app);
    app.call_as_account(BOB, BOB_DEVICE, |s| {
        assert!(s.list_form_keys().is_err());
        assert!(s
            .register_form_key(account([0xEE; 32]).to_string(), "x".into())
            .is_err());
    });
    assert!(app
        .call(|s| s.register_form_key(account(BOB).to_string(), "x".into()))
        .is_err());
    assert!(app
        .call(|s| s.register_form_key(account([0xEE; 32]).to_string(), "  ".into()))
        .is_err());

    app.call(|s| s.forget_form_key(account(FORM).to_string()))
        .unwrap();
    assert!(app.view(|s| s.list_form_keys()).unwrap().is_empty());
    assert_eq!(
        app.view(|s| s.form_keys.writers()),
        BTreeSet::from([account(app.account_id())])
    );
}
