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
    assert_eq!(app.view(|s| s.links.writers()), both);
    assert_eq!(app.view(|s| s.captcha_seen.writers()), both);

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

// ── Public links ────────────────────────────────────────────────────────────

const LINK: &str = "aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11";
const VERIFIER_KEY: &str = "5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e";

/// A public contact form with one link.
fn public_form(app: &mut TestHost<MeroForms>) -> String {
    let form_id = contact_form(app);
    let f = form_id.clone();
    app.call(move |s| s.set_form_public(f, true)).unwrap();
    let f = form_id.clone();
    app.call(move |s| {
        s.create_link(
            f,
            LINK.to_owned(),
            "grant-1".to_owned(),
            "newsletter".to_owned(),
        )
    })
    .unwrap();
    form_id
}

fn via_link(
    app: &mut TestHost<MeroForms>,
    name: &str,
    captcha: Option<CaptchaPass>,
) -> app::Result<String> {
    let answers = contact_answers(name);
    app.call(move |s| s.submit_via_link(LINK.to_owned(), answers, captcha, None))
}

fn via_link_token(
    app: &mut TestHost<MeroForms>,
    name: &str,
    token: Option<&str>,
) -> app::Result<String> {
    let answers = contact_answers(name);
    let token = token.map(str::to_owned);
    app.call(move |s| s.submit_via_link(LINK.to_owned(), answers, None, token))
}

fn responses(app: &mut TestHost<MeroForms>, form_id: &str) -> usize {
    let f = form_id.to_owned();
    app.view(move |s| s.list_responses(f)).unwrap().len()
}

fn siteverify(status: u16, body: &str) -> Result<calimero_sdk::outbound::OutboundResponse, String> {
    Ok(calimero_sdk::outbound::OutboundResponse {
        status,
        body: body.as_bytes().to_vec(),
    })
}

fn now_ms() -> u64 {
    env::time_now() / 1_000_000
}

/// A pass the test verifier accepts: its signature's first byte is 1, and it
/// signs exactly the message the contract builds.
fn pass(form_id: &str, nonce: &str, expires_ms: u64) -> CaptchaPass {
    let message = captcha_message(form_id, LINK, nonce, expires_ms);
    let mut signature = [0u8; 64];
    signature[0] = 1;
    signature[1..33].copy_from_slice(&simple_digest(message.as_bytes()));
    CaptchaPass {
        nonce: nonce.to_owned(),
        expires_ms,
        signature: hex::encode(signature),
    }
}

/// Not cryptography: a stand-in binding of signature to message for the test
/// verifier, so a pass for one message fails for another.
fn simple_digest(bytes: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, b) in bytes.iter().enumerate() {
        out[i % 32] = out[i % 32].wrapping_mul(31).wrapping_add(*b);
    }
    out
}

fn test_verifier(signature: &[u8; 64], public_key: &[u8; 32], message: &[u8]) -> bool {
    signature[0] == 1
        && signature[1..33] == simple_digest(message)
        && hex::encode(public_key) == VERIFIER_KEY
}

#[test]
fn a_link_takes_responses_only_while_its_form_is_public() {
    let mut app = workspace();
    let form_id = contact_form(&mut app);
    let f = form_id.clone();
    app.call(move |s| {
        s.create_link(
            f,
            LINK.to_owned(),
            "grant-1".to_owned(),
            "newsletter".to_owned(),
        )
    })
    .unwrap();

    // Off by default: the visitor sees the form but cannot answer it.
    let shown = app.view(|s| s.link_form(LINK.to_owned())).unwrap();
    assert_eq!(shown.form_id, form_id);
    assert_eq!(shown.fields, contact_fields());
    assert!(!shown.accepting);
    assert!(via_link(&mut app, "Ada", None)
        .msg()
        .contains("not taking responses from links"));

    let f = form_id.clone();
    app.call(move |s| s.set_form_public(f, true)).unwrap();
    let id = via_link(&mut app, "Ada", None).unwrap();
    let response = app.view(|s| s.get_response(id)).unwrap();
    assert_eq!(response.link, LINK);
    assert_eq!(response.source, "public link · newsletter");

    // Switching it off again stops the link without deleting it.
    let f = form_id.clone();
    app.call(move |s| s.set_form_public(f, false)).unwrap();
    assert!(via_link(&mut app, "Grace", None).is_err());
    let f = form_id.clone();
    let links = app.view(move |s| s.list_links(f)).unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!((links[0].responses, links[0].last_hour), (1, 1));

    // A closed form refuses it too.
    let f = form_id.clone();
    app.call(move |s| s.set_form_public(f, true)).unwrap();
    let f = form_id.clone();
    app.call(move |s| s.set_form_open(f, false)).unwrap();
    assert!(via_link(&mut app, "Grace", None).msg().contains("closed"));
}

#[test]
fn a_deleted_or_unknown_link_answers_nothing() {
    let mut app = workspace();
    let _ = public_form(&mut app);
    let gone = app.call(|s| s.delete_link(LINK.to_owned())).unwrap();
    assert_eq!(gone.grant_id, "grant-1");
    assert!(app
        .view(|s| s.link_form(LINK.to_owned()))
        .msg()
        .contains("no longer works"));
    assert!(via_link(&mut app, "Ada", None)
        .msg()
        .contains("no longer works"));
}

#[test]
fn a_link_is_capped_per_hour() {
    let mut app = workspace();
    let form_id = public_form(&mut app);
    let f = form_id.clone();
    app.call(move |s| s.set_link_cap(f, 2)).unwrap();
    via_link(&mut app, "One", None).unwrap();
    via_link(&mut app, "Two", None).unwrap();
    assert!(via_link(&mut app, "Three", None)
        .msg()
        .contains("this hour"));
    // The team's own entries do not count against a link.
    let f = form_id.clone();
    app.call(move |s| s.submit_response(f, contact_answers("By hand"), String::new()))
        .unwrap();
    let f = form_id.clone();
    assert!(app.call(move |s| s.set_link_cap(f, 0)).is_err());
}

#[test]
fn a_captcha_pass_is_checked_and_spent_once() {
    tests_support::set_verifier(test_verifier);
    let mut app = workspace();
    let form_id = public_form(&mut app);
    let f = form_id.clone();
    app.call(move |s| s.set_captcha_key(f, VERIFIER_KEY.to_owned()))
        .unwrap();
    assert!(app.view(|s| s.link_form(LINK.to_owned())).unwrap().captcha);

    let nonce = "0123456789abcdef0123456789abcdef";
    let later = now_ms() + 5 * 60 * 1_000;

    assert!(via_link(&mut app, "Ada", None)
        .msg()
        .contains("needs a captcha"));
    // Signed for another form: refused.
    assert!(via_link(&mut app, "Ada", Some(pass("other", nonce, later)))
        .msg()
        .contains("not valid for this form"));
    // Expired, or valid for too long: refused.
    assert!(via_link(
        &mut app,
        "Ada",
        Some(pass(&form_id, nonce, now_ms() - 60_000))
    )
    .msg()
    .contains("expired"));
    assert!(via_link(
        &mut app,
        "Ada",
        Some(pass(&form_id, nonce, now_ms() + 3_600_000))
    )
    .msg()
    .contains("too long"));

    via_link(&mut app, "Ada", Some(pass(&form_id, nonce, later))).unwrap();
    // The same pass again: refused.
    assert!(
        via_link(&mut app, "Ada", Some(pass(&form_id, nonce, later)))
            .msg()
            .contains("already used")
    );
    // A fresh one: taken.
    via_link(
        &mut app,
        "Grace",
        Some(pass(&form_id, "fedcba9876543210fedcba9876543210", later)),
    )
    .unwrap();

    let f = form_id.clone();
    assert!(app
        .call(move |s| s.set_captcha_key(f, "not hex".to_owned()))
        .is_err());
}

#[test]
fn only_the_team_manages_links() {
    let mut app = workspace();
    let form_id = public_form(&mut app);
    let f = form_id.clone();
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, move |s| s.set_form_public(f, false))
        .msg()
        .contains("only the team"));
    let f = form_id.clone();
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, move |s| s.list_links(f))
        .is_err());
    assert!(app
        .call_as_account(BOB, BOB_DEVICE, |s| s.delete_link(LINK.to_owned()))
        .is_err());
    // A link id is the token's SHA-256, nothing else.
    let f = form_id.clone();
    assert!(app
        .call(move |s| s.create_link(f, "short".to_owned(), "g".to_owned(), String::new()))
        .is_err());
}

#[test]
fn deleting_a_form_takes_its_links_with_it() {
    let mut app = workspace();
    let form_id = public_form(&mut app);
    app.call(move |s| s.delete_form(form_id)).unwrap();
    assert!(app.view(|s| s.link_form(LINK.to_owned())).is_err());
}

#[test]
fn a_turnstile_form_has_the_node_check_the_token() {
    let mut app = workspace();
    let form_id = public_form(&mut app);
    let f = form_id.clone();
    let view = app
        .call(move |s| s.set_captcha_key(f, " Turnstile ".to_owned()))
        .unwrap();
    assert_eq!(view.captcha_key, NODE_VERIFIES_TURNSTILE);
    let link = app.view(|s| s.link_form(LINK.to_owned())).unwrap();
    assert!(link.captcha && link.captcha_by_node);

    // No token, or a signed pass instead of one: refused before any request.
    assert!(via_link_token(&mut app, "Ada", None)
        .msg()
        .contains("needs a captcha"));
    let nonce = "0123456789abcdef0123456789abcdef";
    assert!(via_link(
        &mut app,
        "Ada",
        Some(pass(&form_id, nonce, now_ms() + 60_000))
    )
    .msg()
    .contains("needs a captcha"));
    assert!(via_link_token(&mut app, "Ada", Some("a token?"))
        .msg()
        .contains("malformed"));

    // With no node to ask, nothing is stored unchecked.
    assert!(via_link_token(&mut app, "Ada", Some("0.AbC-d_e"))
        .msg()
        .contains("could not be checked"));
    assert_eq!(responses(&mut app, &form_id), 0);

    // A key form still checks passes, and empty still turns captchas off.
    let f = form_id.clone();
    app.call(move |s| s.set_captcha_key(f, String::new()))
        .unwrap();
    via_link_token(&mut app, "Ada", None).unwrap();
    assert_eq!(responses(&mut app, &form_id), 1);
}

#[test]
fn the_siteverify_request_names_the_secret_and_never_holds_it() {
    let request = turnstile_request(" 0.AbC-d_e ", TURNSTILE_SECRET).unwrap();
    assert_eq!(request.method, OutboundMethod::Post);
    assert_eq!(request.url, TURNSTILE_SITEVERIFY);
    assert_eq!(
        String::from_utf8(request.body).unwrap(),
        "secret={{secret:TURNSTILE_SECRET_KEY}}&response=0.AbC-d_e"
    );
    assert!(request
        .headers
        .iter()
        .any(|(k, v)| k == "Content-Type" && v == "application/x-www-form-urlencoded"));

    // Nothing that could escape the form body, and nothing too long.
    for bad in ["", "a&secret=x", "a b", "a=b", &"a".repeat(2049)] {
        assert!(
            turnstile_request(bad, TURNSTILE_SECRET).is_err(),
            "{bad:?} was taken"
        );
    }
    assert!(turnstile_request(&"a".repeat(2048), TURNSTILE_SECRET).is_ok());
}

#[test]
fn a_team_without_a_tee_is_told_to_add_one_before_setting_a_captcha_secret() {
    let mut app = workspace();
    let err = app
        .call(|s| s.set_captcha_secret("0x4AAAsite".to_owned(), "0x4AAAsecret".to_owned()))
        .msg();
    assert!(err.contains("no TEE node"), "{err}");
    let settings = app.view(|s| s.captcha_settings()).unwrap();
    assert!(!settings.secret_set && !settings.tee_available);
}

#[test]
fn the_captcha_secret_is_stored_sealed_and_only_its_placeholder_is_sent() {
    let mut app = workspace();
    let form_id = public_form(&mut app);
    let f = form_id.clone();
    app.call(move |s| s.set_captcha_key(f, NODE_VERIFIES_TURNSTILE.to_owned()))
        .unwrap();
    app.set_tee_sealing_key(Some([7; 32]));

    for (site, secret) in [
        ("", "s"),
        ("bad key", "s"),
        ("site", ""),
        ("site", &"s".repeat(501)),
    ] {
        let (site, secret) = (site.to_owned(), secret.to_owned());
        assert!(app
            .call(move |s| s.set_captcha_secret(site, secret))
            .is_err());
    }
    let settings = app
        .call(|s| s.set_captcha_secret(" 0x4AAAsite ".to_owned(), "0x4AAAsecret".to_owned()))
        .unwrap();
    assert_eq!(
        settings,
        CaptchaSettings {
            site_key: "0x4AAAsite".to_owned(),
            secret_set: true,
            tee_available: true,
            needs_resealing: false,
        }
    );
    let link = app.view(|s| s.link_form(LINK.to_owned())).unwrap();
    assert_eq!(link.captcha_site_key, "0x4AAAsite");

    let secret = app.view(|s| s.turnstile_secret()).unwrap();
    assert!(
        secret.starts_with("{{sealed:") && secret.ends_with("}}"),
        "a placeholder the TEE fills in: {secret}"
    );
    let body = String::from_utf8(turnstile_request("0.tok", &secret).unwrap().body).unwrap();
    assert_eq!(body, format!("secret={secret}&response=0.tok"));

    // The namespace's TEEs changed: the secret still opens on the TEEs that
    // hold the old key, and the admin is told to set it again.
    app.set_tee_sealing_key(Some([8; 32]));
    assert!(app.view(|s| s.captcha_settings()).unwrap().needs_resealing);

    let cleared = app.call(|s| s.clear_captcha_secret()).unwrap();
    assert!(!cleared.secret_set && cleared.site_key.is_empty());
    assert_eq!(
        app.view(|s| s.turnstile_secret()).unwrap(),
        TURNSTILE_SECRET
    );
}

#[test]
fn cloudflare_decides_and_every_doubt_refuses() {
    turnstile_verdict(siteverify(200, r#"{"success":true,"error-codes":[]}"#)).unwrap();

    let refused = |outcome| format!("{:?}", turnstile_verdict(outcome).unwrap_err());
    assert!(refused(siteverify(
        200,
        r#"{"success":false,"error-codes":["invalid-input-response"]}"#
    ))
    .contains("not solved"));
    assert!(refused(siteverify(
        200,
        r#"{"success":false,"error-codes":["timeout-or-duplicate"]}"#
    ))
    .contains("already used"));
    assert!(refused(siteverify(500, r#"{"success":true}"#)).contains("answered 500"));
    assert!(refused(siteverify(200, "<html>")).contains("unreadable"));
    assert!(refused(siteverify(200, "{}")).contains("unreadable"));
    assert!(refused(Err("NotApproved: the namespace has not approved https://challenges.cloudflare.com/turnstile/v0/ for this app".to_owned()))
        .contains("ask an admin"));
    assert!(refused(Err("AwaitingApproval: https://challenges.cloudflare.com/turnstile/v0/ is a URL prefix this app declares".to_owned()))
        .contains("this version"));
    assert!(refused(Err(
        "challenges.cloudflare.com is not a host this node's operator allows".to_owned()
    ))
    .contains("not a host"));
    assert!(refused(Err(
        "SealedUnavailable: this node is not a TEE of the namespace, and no TEE of the \
         namespace answered in time"
            .to_owned()
    ))
    .contains("TEE node"));
}
