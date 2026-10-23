//! In-process tests: TestHost drives real CRDT state with no node and no wasm.
//!
//! "Someone else" is always a second ACCOUNT. `call_as` alone moves only the
//! device and keeps the account, which models one person's second machine —
//! and since authorship is per account, a test using it for another person
//! would silently assert nothing.

use calimero_sdk::testing::TestHost;

use super::*;

/// The installer (TestHost's default account) is the first admin.
const KEY: [u8; 32] = [0xF0; 32];
const KEY_DEVICE: [u8; 32] = [0xF1; 32];
const BOB: [u8; 32] = [0xB0; 32];
const BOB_DEVICE: [u8; 32] = [0xB1; 32];

/// The error a call failed with, as text, for matching on.
trait Msg {
    fn msg(self) -> String;
}

impl<T: std::fmt::Debug> Msg for app::Result<T> {
    fn msg(self) -> String {
        format!("{:?}", self.expect_err("expected the call to fail"))
    }
}

fn workspace() -> TestHost<MeroForms> {
    TestHost::new(MeroForms::init)
}

fn account(bytes: [u8; 32]) -> AccountId {
    AccountId::from(bytes)
}

fn field(id: &str, kind: &str, label: &str, required: bool, options: &[&str]) -> Field {
    Field {
        id: id.to_owned(),
        kind: kind.to_owned(),
        label: label.to_owned(),
        help: String::new(),
        required,
        options: options.iter().map(|o| (*o).to_owned()).collect(),
    }
}

/// A contact form: name, email, company, topic, message.
fn contact_fields() -> Vec<Field> {
    vec![
        field("name", "text", "Name", true, &[]),
        field("email", "email", "Email", true, &[]),
        field("company", "text", "Company", false, &[]),
        field(
            "topic",
            "choice",
            "Topic",
            true,
            &["Cloud", "Desktop", "Other"],
        ),
        field("message", "paragraph", "Message", true, &[]),
    ]
}

fn contact_form(app: &mut TestHost<MeroForms>) -> String {
    let id = app
        .call(|s| s.create_form("Contact".to_owned(), "Talk to us".to_owned()))
        .unwrap();
    let form_id = id.clone();
    app.call(move |s| {
        s.update_form(
            form_id,
            "Contact".to_owned(),
            "Talk to us".to_owned(),
            contact_fields(),
        )
    })
    .unwrap();
    id
}

fn answer(field_id: &str, values: &[&str]) -> AnswerInput {
    AnswerInput {
        field_id: field_id.to_owned(),
        values: values.iter().map(|v| (*v).to_owned()).collect(),
    }
}

fn contact_answers(name: &str) -> Vec<AnswerInput> {
    vec![
        answer("name", &[name]),
        answer("email", &["ada@example.com"]),
        answer("company", &["Analytical Engines"]),
        answer("topic", &["Cloud"]),
        answer("message", &["We'd like to run a sealed node."]),
    ]
}

/// Registers KEY as a form key for `form_id`.
fn issue_key(app: &mut TestHost<MeroForms>, form_id: &str) {
    let form_id = form_id.to_owned();
    app.call(move |s| s.register_form_key(account(KEY).to_string(), form_id, "Website".to_owned()))
        .unwrap();
}

/// A response sent by the website, i.e. by the form key's account.
fn submit_from_key(
    app: &mut TestHost<MeroForms>,
    form_id: &str,
    answers: Vec<AnswerInput>,
) -> app::Result<String> {
    let form_id = form_id.to_owned();
    app.call_as_account(KEY, KEY_DEVICE, move |s| {
        s.submit_response(form_id, answers, "/contact/".to_owned())
    })
}

fn add_bob(app: &mut TestHost<MeroForms>) {
    app.call(|s| s.add_team_member(account(BOB).to_string()))
        .unwrap();
}

#[test]
fn a_form_is_built_from_typed_fields() {
    let mut app = workspace();
    let id = contact_form(&mut app);
    let form = app
        .view({
            let id = id.clone();
            move |s| s.get_form(id)
        })
        .unwrap();
    assert_eq!(form.title, "Contact");
    assert!(form.open);
    assert_eq!(
        form.fields
            .iter()
            .map(|f| f.id.as_str())
            .collect::<Vec<_>>(),
        ["name", "email", "company", "topic", "message"]
    );
    // Options are dropped from kinds that do not take them.
    let id2 = id.clone();
    let form = app
        .call(move |s| {
            s.update_form(
                id2,
                "Contact".to_owned(),
                String::new(),
                vec![field("name", "text", " Name ", true, &["stray"])],
            )
        })
        .unwrap();
    assert_eq!(form.fields[0].label, "Name");
    assert!(form.fields[0].options.is_empty());

    let summaries = app.view(|s| s.list_forms()).unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].fields, 1);
}

#[test]
fn fields_are_checked() {
    let mut app = workspace();
    let id = contact_form(&mut app);
    let mut bad = |fields: Vec<Field>| {
        let id = id.clone();
        app.call(move |s| s.update_form(id, "Contact".to_owned(), String::new(), fields))
            .msg()
    };
    assert!(bad(vec![field("Name", "text", "Name", true, &[])]).contains("lowercase"));
    assert!(bad(vec![field("1st", "text", "Name", true, &[])]).contains("lowercase"));
    assert!(bad(vec![
        field("a", "text", "A", true, &[]),
        field("a", "email", "B", true, &[])
    ])
    .contains("two fields"));
    assert!(bad(vec![field("a", "rating", "A", true, &[])]).contains("unknown kind"));
    assert!(bad(vec![field("a", "text", "  ", true, &[])]).contains("label is required"));
    assert!(bad(vec![field("a", "choice", "A", true, &[])]).contains("at least one option"));
    assert!(bad(vec![field("a", "choice", "A", true, &[" "])]).contains("option is required"));
}

#[test]
fn the_website_submits_and_the_team_reads_it() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    let id = submit_from_key(&mut app, &form_id, contact_answers("  Ada Lovelace ")).unwrap();
    assert_eq!(id.len(), 32);

    let responses = app
        .view({
            let form_id = form_id.clone();
            move |s| s.list_responses(form_id)
        })
        .unwrap();
    assert_eq!(responses.len(), 1);
    let r = &responses[0];
    assert_eq!(r.id, id);
    assert_eq!(r.submitted_by, account(KEY).to_string());
    assert_eq!(r.source, "/contact/");
    assert_eq!(r.answers.len(), 5);
    assert_eq!(r.answers[0].label, "Name");
    assert_eq!(r.answers[0].values, ["Ada Lovelace"]);
    assert_eq!(r.answers[3].kind, "choice");
    assert!(!r.archived);
    assert!(r.crm_deal.is_empty());

    let summary = &app.view(|s| s.list_forms()).unwrap()[0];
    assert_eq!(summary.responses, 1);
    assert_eq!(summary.new_responses, 1);
    assert!(summary.last_response_at > 0);
}

#[test]
fn every_answer_is_checked_against_its_field() {
    let mut app = workspace();
    let id = app
        .call(|s| s.create_form("Everything".to_owned(), String::new()))
        .unwrap();
    let fields = vec![
        field("t", "text", "Text", false, &[]),
        field("e", "email", "Email", false, &[]),
        field("p", "phone", "Phone", false, &[]),
        field("n", "number", "Number", false, &[]),
        field("u", "url", "Site", false, &[]),
        field("d", "date", "Date", false, &[]),
        field("c", "choice", "Plan", false, &["Free", "Basic"]),
        field(
            "x",
            "checkboxes",
            "Interests",
            false,
            &["Cloud", "Desktop", "SDK"],
        ),
    ];
    let form_id = id.clone();
    app.call(move |s| s.update_form(form_id, "Everything".to_owned(), String::new(), fields))
        .unwrap();
    let submit = |app: &mut TestHost<MeroForms>, answers: Vec<AnswerInput>| {
        let id = id.clone();
        app.call(move |s| s.submit_response(id, answers, String::new()))
    };
    let err = |app: &mut TestHost<MeroForms>, a: AnswerInput| submit(app, vec![a]).msg();

    assert!(err(&mut app, answer("e", &["nope"])).contains("email address"));
    assert!(err(&mut app, answer("p", &["call me"])).contains("phone number"));
    assert!(err(&mut app, answer("n", &["1e5"])).contains("a number"));
    assert!(err(&mut app, answer("n", &["1.2.3"])).contains("a number"));
    assert!(err(&mut app, answer("u", &["calimero.network"])).contains("https://"));
    assert!(err(&mut app, answer("d", &["2026-02-30"])).contains("YYYY-MM-DD"));
    assert!(err(&mut app, answer("c", &["Premium"])).contains("one of the options"));
    assert!(err(&mut app, answer("c", &["Free", "Basic"])).contains("one answer"));
    assert!(err(&mut app, answer("x", &["Cloud", "Mobile"])).contains("not one of the options"));
    assert!(err(&mut app, answer("zz", &["?"])).contains("no field"));
    assert!(
        submit(&mut app, vec![answer("t", &["a"]), answer("t", &["b"])])
            .msg()
            .contains("twice")
    );
    assert!(err(&mut app, answer("t", &[&"x".repeat(501)])).contains("too long"));

    let ok = submit(
        &mut app,
        vec![
            answer("e", &[" ada@example.com "]),
            answer("p", &["+44 (0) 20-7946 0958"]),
            answer("n", &["-12.50"]),
            answer("u", &["https://calimero.network"]),
            answer("d", &["2028-02-29"]),
            answer("c", &["Basic"]),
            // Ticked out of order and twice; stored once each, in form order.
            answer("x", &["SDK", "Cloud", "SDK"]),
        ],
    )
    .unwrap();
    let r = app.view(move |s| s.get_response(ok)).unwrap();
    let values: BTreeMap<_, _> = r
        .answers
        .iter()
        .map(|a| (a.field_id.as_str(), a.values.clone()))
        .collect();
    assert_eq!(values["e"], ["ada@example.com"]);
    assert_eq!(values["x"], ["Cloud", "SDK"]);
    // A blank optional field is stored, empty, so every field has an answer.
    assert!(values["t"].is_empty());
}

#[test]
fn required_fields_and_closed_forms() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    let mut answers = contact_answers("Ada");
    answers.retain(|a| a.field_id != "email");
    assert!(submit_from_key(&mut app, &form_id, answers)
        .msg()
        .contains("Email is required"));
    let mut answers = contact_answers("Ada");
    answers.retain(|a| a.field_id != "company");
    assert!(submit_from_key(&mut app, &form_id, answers).is_ok());

    let id = form_id.clone();
    app.call(move |s| s.set_form_open(id, false)).unwrap();
    assert!(submit_from_key(&mut app, &form_id, contact_answers("Ada"))
        .msg()
        .contains("closed"));
}

#[test]
fn a_form_key_answers_only_its_own_form() {
    let mut app = workspace();
    let contact = contact_form(&mut app);
    let other = app
        .call(|s| s.create_form("Other".to_owned(), String::new()))
        .unwrap();
    let id = other.clone();
    app.call(move |s| {
        s.update_form(
            id,
            "Other".to_owned(),
            String::new(),
            vec![field("q", "text", "Q", true, &[])],
        )
    })
    .unwrap();
    issue_key(&mut app, &contact);
    assert!(
        submit_from_key(&mut app, &other, vec![answer("q", &["hi"])])
            .msg()
            .contains("another form")
    );
}

#[test]
fn a_response_keeps_the_fields_it_was_sent_with() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    let id = submit_from_key(&mut app, &form_id, contact_answers("Ada")).unwrap();
    let fid = form_id.clone();
    app.call(move |s| {
        s.update_form(
            fid,
            "Contact".to_owned(),
            String::new(),
            vec![field("name", "text", "Full name", true, &[])],
        )
    })
    .unwrap();
    let r = app.view(move |s| s.get_response(id)).unwrap();
    assert_eq!(r.answers.len(), 5);
    assert_eq!(r.answers[0].label, "Name");
    assert_eq!(r.answers[4].values, ["We'd like to run a sealed node."]);
}

/// One call made as the form key.
type KeyCall = dyn FnOnce(&mut MeroForms) -> app::Result<()>;

#[test]
fn only_the_team_builds_forms_and_reads_responses() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    let id = submit_from_key(&mut app, &form_id, contact_answers("Ada")).unwrap();

    let as_key = |app: &mut TestHost<MeroForms>, f: Box<KeyCall>| {
        app.call_as_account(KEY, KEY_DEVICE, f).msg()
    };
    let fid = form_id.clone();
    assert!(as_key(&mut app, Box::new(move |s| s.list_responses(fid).map(drop))).contains("team"));
    let rid = id.clone();
    assert!(as_key(&mut app, Box::new(move |s| s.get_response(rid).map(drop))).contains("team"));
    assert!(as_key(&mut app, Box::new(|s| s.list_forms().map(drop))).contains("team"));
    assert!(as_key(
        &mut app,
        Box::new(|s| s.create_form("x".into(), String::new()).map(drop))
    )
    .contains("team"));
    let rid = id.clone();
    assert!(as_key(
        &mut app,
        Box::new(move |s| s.set_archived(rid, true).map(drop))
    )
    .contains("team"));
    assert!(as_key(&mut app, Box::new(|s| s.set_workspace_name("x".into()))).contains("team"));

    // A website may read the questions it answers.
    let fid = form_id.clone();
    let form = app
        .call_as_account(KEY, KEY_DEVICE, move |s| s.get_form(fid))
        .unwrap();
    assert_eq!(form.fields.len(), 5);
}

#[test]
fn shared_state_is_writable_by_exactly_the_team() {
    let mut app = workspace();
    let me = account(app.account_id());
    assert_eq!(app.view(|s| s.forms.writers()), BTreeSet::from([me]));

    add_bob(&mut app);
    let both = BTreeSet::from([me, account(BOB)]);
    assert_eq!(app.view(|s| s.forms.writers()), both);
    assert_eq!(app.view(|s| s.triage.writers()), both);
    assert_eq!(app.view(|s| s.settings.writers()), both);

    app.call(|s| s.remove_team_member(account(BOB).to_string()))
        .unwrap();
    assert_eq!(app.view(|s| s.forms.writers()), BTreeSet::from([me]));
    assert_eq!(app.view(|s| s.triage.writers()), BTreeSet::from([me]));
}

#[test]
fn a_teammate_builds_forms_and_works_responses() {
    let mut app = workspace();
    add_bob(&mut app);
    let form_id = app
        .call_as_account(BOB, BOB_DEVICE, |s| {
            s.create_form("Demo request".to_owned(), String::new())
        })
        .unwrap();
    let fid = form_id.clone();
    app.call_as_account(BOB, BOB_DEVICE, move |s| {
        s.update_form(
            fid,
            "Demo request".to_owned(),
            String::new(),
            contact_fields(),
        )
    })
    .unwrap();
    // A teammate may enter a response by hand.
    let fid = form_id.clone();
    let id = app
        .call_as_account(BOB, BOB_DEVICE, move |s| {
            s.submit_response(fid, contact_answers("Ada"), "phone call".to_owned())
        })
        .unwrap();
    let rid = id.clone();
    let r = app
        .call_as_account(BOB, BOB_DEVICE, move |s| s.set_archived(rid, true))
        .unwrap();
    assert!(r.archived);
    assert_eq!(app.view(|s| s.list_forms()).unwrap()[0].new_responses, 0);
}

#[test]
fn a_response_is_sent_to_the_crm_once() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    let id = submit_from_key(&mut app, &form_id, contact_answers("Ada")).unwrap();

    let rid = id.clone();
    let r = app
        .call(move |s| s.record_crm_deal(rid, "AB".repeat(32), "deal-1".to_owned()))
        .unwrap();
    assert_eq!(r.crm_context, "ab".repeat(32));
    assert_eq!(r.crm_deal, "deal-1");
    assert!(r.crm_sent_at > 0);
    assert_eq!(r.crm_sent_by, account(app.account_id()).to_string());

    let rid = id.clone();
    assert!(app
        .call(move |s| s.record_crm_deal(rid, "ab".repeat(32), "deal-2".to_owned()))
        .msg()
        .contains("already sent"));
    assert_eq!(app.view(|s| s.list_forms()).unwrap()[0].new_responses, 0);
}

#[test]
fn the_crm_link_maps_fields_the_form_has() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    let link = CrmLink {
        context_id: "CD".repeat(32),
        stage_id: "stage-lead".to_owned(),
        name_field: "name".to_owned(),
        email_field: "email".to_owned(),
        phone_field: String::new(),
        organization_field: "company".to_owned(),
        title_field: String::new(),
    };
    let fid = form_id.clone();
    let l = link.clone();
    let form = app.call(move |s| s.set_crm_link(fid, l)).unwrap();
    assert_eq!(form.crm.context_id, "cd".repeat(32));
    assert_eq!(form.crm.organization_field, "company");

    let fid = form_id.clone();
    let mut bad = link.clone();
    bad.phone_field = "phone".to_owned();
    assert!(app
        .call(move |s| s.set_crm_link(fid, bad))
        .msg()
        .contains("no field"));
    let fid = form_id.clone();
    let mut bad = link.clone();
    bad.name_field = String::new();
    assert!(app
        .call(move |s| s.set_crm_link(fid, bad))
        .msg()
        .contains("name"));
    // Unlinking needs nothing else.
    let fid = form_id.clone();
    let form = app
        .call(move |s| s.set_crm_link(fid, CrmLink::default()))
        .unwrap();
    assert!(form.crm.context_id.is_empty());
}

#[test]
fn a_form_with_responses_is_closed_not_deleted() {
    let mut app = workspace();
    let empty = app
        .call(|s| s.create_form("Draft".to_owned(), String::new()))
        .unwrap();
    let id = empty.clone();
    app.call(move |s| s.delete_form(id)).unwrap();
    assert!(app.view(|s| s.list_forms()).unwrap().is_empty());

    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    submit_from_key(&mut app, &form_id, contact_answers("Ada")).unwrap();
    let id = form_id.clone();
    assert!(app
        .call(move |s| s.delete_form(id))
        .msg()
        .contains("close it"));
}

#[test]
fn events_carry_ids_never_answers() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    let _ = app.take_events();
    submit_from_key(&mut app, &form_id, contact_answers("Ada")).unwrap();
    let events = format!("{:?}", app.take_events());
    assert!(events.contains("Submitted"));
    assert!(!events.contains("ada@example.com"));
    assert!(!events.contains("sealed node"));
}

#[test]
fn admins_issue_form_keys_and_see_what_each_sent() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    issue_key(&mut app, &form_id);
    submit_from_key(&mut app, &form_id, contact_answers("Ada")).unwrap();
    submit_from_key(&mut app, &form_id, contact_answers("Grace")).unwrap();
    let keys = app.view(|s| s.list_form_keys()).unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].account, account(KEY).to_string());
    assert_eq!(keys[0].form_id, form_id);
    assert_eq!(keys[0].responses, 2);

    // A form key cannot join the team, and a teammate cannot be a form key.
    assert!(app
        .call(|s| s.add_team_member(account(KEY).to_string()))
        .msg()
        .contains("form key"));
    add_bob(&mut app);
    let fid = form_id.clone();
    assert!(app
        .call(move |s| s.register_form_key(account(BOB).to_string(), fid, "x".to_owned()))
        .msg()
        .contains("teammate"));
    // Only an admin issues keys.
    let fid = form_id.clone();
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, move |s| s.register_form_key(
            "ee".repeat(32),
            fid,
            "x".to_owned()
        ))
        .msg()
        .contains("admin"));

    app.call(|s| s.forget_form_key(account(KEY).to_string()))
        .unwrap();
    assert!(app.view(|s| s.list_form_keys()).unwrap().is_empty());
}

#[test]
fn the_team_names_the_workspace() {
    let mut app = workspace();
    app.call(|s| s.set_workspace_name("  Calimero ".to_owned()))
        .unwrap();
    assert_eq!(app.view(|s| s.workspace_name()).unwrap(), "Calimero");
}

#[test]
fn shape_checks() {
    assert!(
        looks_like_number("0")
            && looks_like_number("-3.25")
            && !looks_like_number("3.")
            && !looks_like_number(".")
    );
    assert!(
        looks_like_date("2026-10-23")
            && !looks_like_date("2026-13-01")
            && !looks_like_date("2026-1-01")
    );
    assert!(looks_like_date("2024-02-29") && !looks_like_date("2100-02-29"));
    assert!(looks_like_phone("+1 415 555 0100") && !looks_like_phone("123"));
    assert!(
        looks_like_url("http://x") && !looks_like_url("https://") && !looks_like_url("https://a b")
    );
    assert!(is_field_id("company_size") && !is_field_id("") && !is_field_id(&"a".repeat(41)));
}
