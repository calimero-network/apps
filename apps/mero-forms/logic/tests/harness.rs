//! Mero Forms on core's real wasmtime engine (`TestApp`): v1's `TestHost`
//! tests method for method, v1's storage-level write rules as the method checks
//! they became (forged writes: the same call as an account a method refuses),
//! form keys as API keys, public links as tokens, captchas (a real ed25519
//! pass, and Turnstile through `mock_http`), the Mero CRM hand-off through
//! `mock_app`, and the access and wire checks v1 could not express. Every
//! method of the ABI is called here.
//!
//! The harness app is an org app, so an anonymous caller is refused before the
//! app runs (`401`), `public` methods included; a public link's visitor is
//! played here by `gus`, a guest of the organization, which the public methods
//! treat exactly as they treat an anonymous caller.

#![cfg(not(target_arch = "wasm32"))]

mod common;

use std::sync::{Arc, Mutex};

use calimero_app_sdk::testing::{Failure, HttpRequest, HttpResponse, Org, OtherAppCall, TestApp};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const HOUR: u64 = 3_600_000;

/// The owner (the first admin), two members and a guest.
fn app() -> TestApp {
    common::app(Org::new().members(["bob", "cy"]).guests(["gus"]))
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

/// The app error's code and message.
fn err(result: Result<Value, Failure>) -> (String, String) {
    match result {
        Err(Failure::App { code, fields }) => {
            let message = fields["message"].as_str().unwrap_or_default().to_owned();
            (code, message)
        }
        other => panic!("expected an app error, got {other:?}"),
    }
}

fn field(id: &str, kind: &str, label: &str, required: bool, options: &[&str]) -> Value {
    json!({ "id": id, "kind": kind, "label": label, "help": "", "required": required, "options": options })
}

fn contact_fields() -> Value {
    json!([
        field("name", "text", "Name", true, &[]),
        field("email", "email", "Email", true, &[]),
        field("company", "text", "Company", false, &[]),
        field(
            "topic",
            "choice",
            "Topic",
            true,
            &["Cloud", "Desktop", "Other"]
        ),
        field("message", "paragraph", "Message", false, &[]),
    ])
}

fn contact_form(t: &mut TestApp) -> String {
    let id = call(
        t,
        "owner",
        "createForm",
        json!({ "title": "Contact", "description": "Say hello" }),
    );
    let id = id.as_str().expect("an id").to_owned();
    call(
        t,
        "owner",
        "updateForm",
        json!({ "formId": id, "title": "Contact", "description": "Say hello", "fields": contact_fields() }),
    );
    id
}

fn answer(field_id: &str, values: &[&str]) -> Value {
    json!({ "fieldId": field_id, "values": values })
}

fn contact_answers(name: &str) -> Value {
    json!([
        answer("name", &[name]),
        answer("email", &["ada@example.com"]),
        answer("company", &["Analytical Engines"]),
        answer("topic", &["Cloud"]),
        answer("message", &["Hello"]),
    ])
}

/// A website's form key: the API key `key-site` of the owner's account,
/// registered for `form_id`.
fn issue_key(t: &mut TestApp, form_id: &str) {
    call(
        t,
        "owner",
        "registerFormKey",
        json!({ "account": "key-site", "formId": form_id, "label": "calimero.network" }),
    );
}

fn submit_from_key(t: &mut TestApp, form_id: &str, answers: Value) -> Result<Value, Failure> {
    t.api_key("key-site", "owner").call(
        "submitResponse",
        json!({ "formId": form_id, "answers": answers, "source": "/contact/" }),
    )
}

fn add_bob(t: &mut TestApp) {
    call(t, "owner", "addTeamMember", json!({ "who": "bob" }));
}

fn names(t: &TestApp, account: &str) -> Vec<String> {
    t.events_for(account).into_iter().map(|(n, _)| n).collect()
}

// ── forms ────────────────────────────────────────────────────────────────────

#[test]
fn a_form_is_built_from_typed_fields() {
    let mut t = app();
    let id = contact_form(&mut t);
    let form = view(&mut t, "owner", "getForm", json!({ "formId": id }));
    assert_eq!(form["title"], json!("Contact"));
    assert_eq!(form["open"], json!(true));
    assert_eq!(form["public"], json!(false));
    assert_eq!(form["linkCap"], json!(30));
    assert_eq!(form["createdBy"], json!("owner"));
    // u64s are decimal strings on the wire.
    assert_eq!(form["createdAt"], json!(common::T0.to_string()));
    let ids: Vec<&str> = form["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["name", "email", "company", "topic", "message"]);

    // Options are dropped from kinds that do not take them; labels trimmed.
    let form = call(
        &mut t,
        "owner",
        "updateForm",
        json!({ "formId": id, "title": "Contact", "description": "",
                "fields": [field("name", "text", " Name ", true, &["stray"])] }),
    );
    assert_eq!(form["fields"][0]["label"], json!("Name"));
    assert_eq!(form["fields"][0]["options"], json!([]));

    let list = view(&mut t, "owner", "listForms", json!({}));
    assert_eq!(list.as_array().map(Vec::len), Some(1));
    assert_eq!(list[0]["fields"], json!(1));
    assert_eq!(list[0]["responses"], json!(0));
    assert_eq!(
        view(&mut t, "gus", "fieldKinds", json!({}))
            .as_array()
            .map(Vec::len),
        Some(9)
    );
}

#[test]
fn fields_are_checked() {
    let mut t = app();
    let id = contact_form(&mut t);
    let mut bad = |fields: Value| {
        err(t.as_("owner").call(
            "updateForm",
            json!({ "formId": id, "title": "Contact", "description": "", "fields": fields }),
        ))
    };
    let cases = [
        (
            json!([field("Name", "text", "Name", true, &[])]),
            "lowercase",
        ),
        (
            json!([field("1st", "text", "Name", true, &[])]),
            "lowercase",
        ),
        (
            json!([
                field("a", "text", "A", true, &[]),
                field("a", "email", "B", true, &[])
            ]),
            "two fields",
        ),
        (
            json!([field("a", "rating", "A", true, &[])]),
            "unknown kind",
        ),
        (
            json!([field("a", "text", "  ", true, &[])]),
            "label is required",
        ),
        (
            json!([field("a", "choice", "A", true, &[])]),
            "at least one option",
        ),
        (
            json!([field("a", "choice", "A", true, &[" "])]),
            "option is required",
        ),
    ];
    for (fields, want) in cases {
        let (code, message) = bad(fields);
        assert_eq!(code, "Invalid");
        assert!(message.contains(want), "{message} should say {want}");
    }
    let (code, message) = err(t
        .as_("owner")
        .call("createForm", json!({ "title": " ", "description": "" })));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Invalid", "title is required")
    );
}

#[test]
fn the_website_submits_and_the_team_reads_it() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    issue_key(&mut t, &form_id);
    let id = submit_from_key(&mut t, &form_id, contact_answers("  Ada Lovelace ")).unwrap();
    let id = id.as_str().unwrap().to_owned();
    assert_eq!(id.len(), 32);

    let responses = view(
        &mut t,
        "owner",
        "listResponses",
        json!({ "formId": form_id }),
    );
    assert_eq!(responses["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(responses["next"], Value::Null);
    let r = &responses["items"][0];
    assert_eq!(r["id"], json!(id));
    assert_eq!(r["submittedBy"], json!("key-site"));
    assert_eq!(r["source"], json!("/contact/"));
    assert_eq!(r["answers"].as_array().map(Vec::len), Some(5));
    assert_eq!(r["answers"][0]["label"], json!("Name"));
    assert_eq!(r["answers"][0]["values"], json!(["Ada Lovelace"]));
    assert_eq!(r["answers"][3]["kind"], json!("choice"));
    assert_eq!(r["archived"], json!(false));
    assert_eq!(r["crmDeal"], json!(""));

    let summary = &view(&mut t, "owner", "listForms", json!({}))[0];
    assert_eq!(summary["responses"], json!(1));
    assert_eq!(summary["newResponses"], json!(1));
    assert_eq!(summary["lastResponseAt"], json!(common::T0.to_string()));
}

#[test]
fn every_answer_is_checked_against_its_field() {
    let mut t = app();
    let id = call(
        &mut t,
        "owner",
        "createForm",
        json!({ "title": "Everything", "description": "" }),
    );
    let id = id.as_str().unwrap().to_owned();
    let fields = json!([
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
            &["Cloud", "Desktop", "SDK"]
        ),
    ]);
    call(
        &mut t,
        "owner",
        "updateForm",
        json!({ "formId": id, "title": "Everything", "description": "", "fields": fields }),
    );
    let mut submit = |answers: Value| {
        t.as_("owner").call(
            "submitResponse",
            json!({ "formId": id, "answers": answers, "source": "" }),
        )
    };
    let long = "x".repeat(501);
    let cases = [
        (json!([answer("e", &["nope"])]), "email address"),
        (json!([answer("p", &["call me"])]), "phone number"),
        (json!([answer("n", &["1e5"])]), "a number"),
        (json!([answer("n", &["1.2.3"])]), "a number"),
        (json!([answer("u", &["calimero.network"])]), "https://"),
        (json!([answer("d", &["2026-02-30"])]), "YYYY-MM-DD"),
        (json!([answer("c", &["Premium"])]), "one of the options"),
        (json!([answer("c", &["Free", "Basic"])]), "one answer"),
        (
            json!([answer("x", &["Cloud", "Mobile"])]),
            "not one of the options",
        ),
        (json!([answer("zz", &["?"])]), "no field"),
        (json!([answer("t", &["a"]), answer("t", &["b"])]), "twice"),
        (json!([answer("t", &[long.as_str()])]), "too long"),
    ];
    for (answers, want) in cases {
        let (code, message) = err(submit(answers));
        assert_eq!(code, "Invalid");
        assert!(message.contains(want), "{message} should say {want}");
    }
    let ok = submit(json!([
        answer("e", &[" ada@example.com "]),
        answer("p", &["+44 (0) 20-7946 0958"]),
        answer("n", &["-12.50"]),
        answer("u", &["https://calimero.network"]),
        answer("d", &["2028-02-29"]),
        answer("c", &["Basic"]),
        // Ticked out of order and twice; stored once each, in form order.
        answer("x", &["SDK", "Cloud", "SDK"]),
    ]))
    .unwrap();
    let r = view(&mut t, "owner", "getResponse", json!({ "id": ok }));
    let by_id = |fid: &str| {
        r["answers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["fieldId"] == json!(fid))
            .unwrap()["values"]
            .clone()
    };
    assert_eq!(by_id("e"), json!(["ada@example.com"]));
    assert_eq!(by_id("x"), json!(["Cloud", "SDK"]));
    // A blank optional field is stored, empty, so every field has an answer.
    assert_eq!(by_id("t"), json!([]));
}

#[test]
fn required_fields_and_closed_forms() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    issue_key(&mut t, &form_id);
    let (_, message) = err(submit_from_key(
        &mut t,
        &form_id,
        json!([answer("name", &["Ada"]), answer("topic", &["Cloud"])]),
    ));
    assert!(message.contains("Email is required"));
    submit_from_key(
        &mut t,
        &form_id,
        json!([
            answer("name", &["Ada"]),
            answer("email", &["a@b.co"]),
            answer("topic", &["Cloud"])
        ]),
    )
    .unwrap();

    call(
        &mut t,
        "owner",
        "setFormOpen",
        json!({ "formId": form_id, "open": false }),
    );
    let (code, message) = err(submit_from_key(&mut t, &form_id, contact_answers("Ada")));
    assert_eq!(code, "Refused");
    assert!(message.contains("closed"));

    // A form with no fields yet takes nothing.
    let empty = call(
        &mut t,
        "owner",
        "createForm",
        json!({ "title": "Empty", "description": "" }),
    );
    let (_, message) = err(t.as_("owner").call(
        "submitResponse",
        json!({ "formId": empty, "answers": [], "source": "" }),
    ));
    assert!(message.contains("no fields yet"));
}

#[test]
fn a_form_key_answers_only_its_own_form_and_nothing_else() {
    let mut t = app();
    let contact = contact_form(&mut t);
    let other = call(
        &mut t,
        "owner",
        "createForm",
        json!({ "title": "Other", "description": "" }),
    );
    call(
        &mut t,
        "owner",
        "updateForm",
        json!({ "formId": other, "title": "Other", "description": "", "fields": [field("q", "text", "Q", true, &[])] }),
    );
    issue_key(&mut t, &contact);
    let (code, message) = err(t.api_key("key-site", "owner").call(
        "submitResponse",
        json!({ "formId": other, "answers": [answer("q", &["hi"])], "source": "" }),
    ));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Forbidden", "this form key is for another form")
    );
    // It reads the questions it answers...
    assert_eq!(
        t.api_key("key-site", "owner")
            .view("getForm", json!({ "formId": contact }))
            .unwrap()["title"],
        json!("Contact")
    );
    // ...and is never the admin whose account it belongs to.
    let (code, _) = err(t
        .api_key("key-site", "owner")
        .view("listResponses", json!({ "formId": contact })));
    assert_eq!(code, "Forbidden");
    let (code, _) = err(t
        .api_key("key-site", "owner")
        .call("setFormOpen", json!({ "formId": contact, "open": false })));
    assert_eq!(code, "Forbidden");
    assert_eq!(
        t.api_key("key-site", "owner")
            .view("amIAdmin", json!({}))
            .unwrap(),
        json!(false)
    );
    assert_eq!(
        t.api_key("key-site", "owner")
            .view("amITeam", json!({}))
            .unwrap(),
        json!(false)
    );

    // An API key the register does not know acts as its account.
    let id = t
        .api_key("key-script", "owner")
        .call(
            "submitResponse",
            json!({ "formId": other, "answers": [answer("q", &["hi"])], "source": "" }),
        )
        .unwrap();
    let r = view(&mut t, "owner", "getResponse", json!({ "id": id }));
    assert_eq!(r["submittedBy"], json!("owner"));
}

#[test]
fn a_response_keeps_the_fields_it_was_sent_with() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    issue_key(&mut t, &form_id);
    let id = submit_from_key(&mut t, &form_id, contact_answers("Ada")).unwrap();
    call(
        &mut t,
        "owner",
        "updateForm",
        json!({ "formId": form_id, "title": "Contact", "description": "",
                "fields": [field("name", "text", "Full name", true, &[])] }),
    );
    let r = view(&mut t, "owner", "getResponse", json!({ "id": id }));
    assert_eq!(r["answers"].as_array().map(Vec::len), Some(5));
    assert_eq!(r["answers"][0]["label"], json!("Name"));
    assert_eq!(r["answers"][1]["fieldId"], json!("email"));
}

// ── the team ─────────────────────────────────────────────────────────────────

#[test]
fn only_the_team_builds_forms_and_reads_responses() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    // bob reaches the app (an org member) but is not on the team.
    assert_eq!(view(&mut t, "bob", "amITeam", json!({})), json!(false));
    assert_eq!(view(&mut t, "bob", "myAccount", json!({})), json!("bob"));
    for (method, args, is_view) in [
        ("listForms", json!({}), true),
        ("listResponses", json!({ "formId": form_id }), true),
        ("listTeam", json!({}), true),
        ("listLinks", json!({ "formId": form_id }), true),
        ("captchaSettings", json!({}), true),
        (
            "createForm",
            json!({ "title": "x", "description": "" }),
            false,
        ),
        (
            "setFormOpen",
            json!({ "formId": form_id, "open": false }),
            false,
        ),
        ("setWorkspaceName", json!({ "name": "x" }), false),
        ("deleteForm", json!({ "formId": form_id }), false),
        ("sendToCrm", json!({ "id": "x" }), false),
        ("getResponse", json!({ "id": "x" }), true),
    ] {
        let result = if is_view {
            t.as_("bob").view(method, args)
        } else {
            t.as_("bob").call(method, args)
        };
        let (code, message) = err(result);
        assert_eq!(code, "Forbidden", "{method}");
        assert_eq!(message, "only the team may do this", "{method}");
    }
    // Admin-only, even for the team.
    add_bob(&mut t);
    for (method, args) in [
        ("addTeamMember", json!({ "who": "cy" })),
        ("removeTeamMember", json!({ "who": "owner" })),
        (
            "registerFormKey",
            json!({ "account": "k", "formId": form_id, "label": "x" }),
        ),
        ("forgetFormKey", json!({ "account": "k" })),
        ("setCaptchaSecret", json!({ "siteKey": "s", "secret": "x" })),
        ("setCaptchaSiteKey", json!({ "siteKey": "s" })),
        ("clearCaptchaSecret", json!({})),
    ] {
        let (code, message) = err(t.as_("bob").call(method, args));
        assert_eq!(
            (code.as_str(), message.as_str()),
            ("Forbidden", "only an admin may do this"),
            "{method}"
        );
    }
    let (code, _) = err(t.as_("bob").view("listFormKeys", json!({})));
    assert_eq!(code, "Forbidden");
    // Anyone who reaches the app may answer an open form and read it.
    submit_any(&mut t, "gus", &form_id);
    assert_eq!(
        view(&mut t, "gus", "getForm", json!({ "formId": form_id }))["id"],
        json!(form_id)
    );
    assert_eq!(view(&mut t, "gus", "workspaceName", json!({})), json!(""));
}

fn submit_any(t: &mut TestApp, who: &str, form_id: &str) -> String {
    call(
        t,
        who,
        "submitResponse",
        json!({ "formId": form_id, "answers": contact_answers("Ada"), "source": "" }),
    )
    .as_str()
    .unwrap()
    .to_owned()
}

#[test]
fn admins_manage_the_team() {
    let mut t = app();
    assert_eq!(
        view(&mut t, "owner", "listTeam", json!({})),
        json!([{ "account": "owner", "admin": true }])
    );
    add_bob(&mut t);
    call(&mut t, "owner", "addTeamMember", json!({ "who": "  cy " }));
    assert_eq!(
        view(&mut t, "bob", "listTeam", json!({})),
        json!([
            { "account": "bob", "admin": false },
            { "account": "cy", "admin": false },
            { "account": "owner", "admin": true },
        ])
    );
    assert_eq!(view(&mut t, "bob", "amITeam", json!({})), json!(true));
    assert_eq!(view(&mut t, "bob", "amIAdmin", json!({})), json!(false));
    assert_eq!(view(&mut t, "owner", "amIAdmin", json!({})), json!(true));
    call(&mut t, "owner", "removeTeamMember", json!({ "who": "cy" }));
    // An admin stays an admin.
    call(
        &mut t,
        "owner",
        "removeTeamMember",
        json!({ "who": "owner" }),
    );
    assert_eq!(view(&mut t, "cy", "amITeam", json!({})), json!(false));
    assert_eq!(view(&mut t, "owner", "amIAdmin", json!({})), json!(true));
    let (code, _) = err(t.as_("owner").call("addTeamMember", json!({ "who": " " })));
    assert_eq!(code, "Invalid");
    // A guest of the organization, or an account outside it, cannot join.
    for who in ["gus", "mallory"] {
        let (code, message) = err(t.as_("owner").call("addTeamMember", json!({ "who": who })));
        assert_eq!(code, "Refused");
        assert!(message.contains("member of the workspace's organization"));
    }
    // A form key cannot join the team, nor a teammate become a key.
    let form_id = contact_form(&mut t);
    issue_key(&mut t, &form_id);
    let (_, message) = err(t
        .as_("owner")
        .call("addTeamMember", json!({ "who": "key-site" })));
    assert_eq!(message, "a form key cannot join the team");
    let (_, message) = err(t.as_("owner").call(
        "registerFormKey",
        json!({ "account": "bob", "formId": form_id, "label": "x" }),
    ));
    assert_eq!(message, "a teammate cannot be a form key");
}

#[test]
fn a_teammate_builds_forms_and_works_responses() {
    let mut t = app();
    add_bob(&mut t);
    let form_id = call(
        &mut t,
        "bob",
        "createForm",
        json!({ "title": "Feedback", "description": "" }),
    );
    call(
        &mut t,
        "bob",
        "updateForm",
        json!({ "formId": form_id, "title": "Feedback", "description": "",
                "fields": [field("q", "text", "Q", true, &[])] }),
    );
    assert_eq!(
        view(&mut t, "owner", "getForm", json!({ "formId": form_id }))["createdBy"],
        json!("bob")
    );
    let id = call(
        &mut t,
        "cy",
        "submitResponse",
        json!({ "formId": form_id, "answers": [answer("q", &["ok"])], "source": "" }),
    );
    let r = call(
        &mut t,
        "bob",
        "setArchived",
        json!({ "id": id, "archived": true }),
    );
    assert_eq!(r["archived"], json!(true));
    assert_eq!(
        view(&mut t, "owner", "listForms", json!({}))[0]["newResponses"],
        json!(0)
    );
    call(
        &mut t,
        "bob",
        "setArchived",
        json!({ "id": id, "archived": false }),
    );
    assert_eq!(
        view(&mut t, "owner", "listForms", json!({}))[0]["newResponses"],
        json!(1)
    );
    // Both teammates' writes survive: one log orders them.
    call(
        &mut t,
        "owner",
        "setWorkspaceName",
        json!({ "name": " Growth " }),
    );
    assert_eq!(
        view(&mut t, "bob", "workspaceName", json!({})),
        json!("Growth")
    );
    call(
        &mut t,
        "bob",
        "setFormOpen",
        json!({ "formId": form_id, "open": false }),
    );
    let form = view(&mut t, "owner", "getForm", json!({ "formId": form_id }));
    assert_eq!(form["open"], json!(false));
    assert_eq!(form["title"], json!("Feedback"));
}

#[test]
fn a_response_is_sent_to_the_crm_once() {
    let mut t = app();
    add_bob(&mut t);
    let form_id = contact_form(&mut t);
    let id = submit_any(&mut t, "gus", &form_id);
    let r = call(
        &mut t,
        "bob",
        "recordCrmDeal",
        json!({ "id": id, "crmContext": "crm-app", "crmDeal": "deal-1" }),
    );
    assert_eq!(r["crmDeal"], json!("deal-1"));
    assert_eq!(r["crmContext"], json!("crm-app"));
    assert_eq!(r["crmSentBy"], json!("bob"));
    assert_eq!(
        view(&mut t, "owner", "listForms", json!({}))[0]["newResponses"],
        json!(0)
    );
    let (code, message) = err(t.as_("owner").call(
        "recordCrmDeal",
        json!({ "id": id, "crmContext": "crm-app", "crmDeal": "deal-2" }),
    ));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Refused", "this response was already sent to the CRM")
    );
    let (code, _) = err(t.as_("owner").call(
        "recordCrmDeal",
        json!({ "id": "nope", "crmContext": "c", "crmDeal": "d" }),
    ));
    assert_eq!(code, "NotFound");
}

#[test]
fn the_crm_link_maps_fields_the_form_has() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let link = |name: &str, email: &str| {
        json!({ "contextId": "crm-app", "stageId": "lead", "nameField": name, "emailField": email,
                "phoneField": "", "organizationField": "company", "titleField": "" })
    };
    let (_, message) = err(t.as_("owner").call(
        "setCrmLink",
        json!({ "formId": form_id, "link": link("", "email") }),
    ));
    assert!(message.contains("contact's name"));
    let (_, message) = err(t.as_("owner").call(
        "setCrmLink",
        json!({ "formId": form_id, "link": link("name", "mail") }),
    ));
    assert!(message.contains("no field \"mail\""));
    let form = call(
        &mut t,
        "owner",
        "setCrmLink",
        json!({ "formId": form_id, "link": link("name", "email") }),
    );
    assert_eq!(form["crm"]["contextId"], json!("crm-app"));
    assert_eq!(form["crm"]["organizationField"], json!("company"));
    // Unlinking needs nothing else.
    let form = call(
        &mut t,
        "owner",
        "setCrmLink",
        json!({ "formId": form_id, "link": { "contextId": "" } }),
    );
    assert_eq!(form["crm"]["stageId"], json!(""));
}

#[test]
fn a_form_with_responses_is_closed_not_deleted() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let empty = call(
        &mut t,
        "owner",
        "createForm",
        json!({ "title": "Empty", "description": "" }),
    );
    call(&mut t, "owner", "deleteForm", json!({ "formId": empty }));
    let (code, _) = err(t.as_("owner").view("getForm", json!({ "formId": empty })));
    assert_eq!(code, "NotFound");
    submit_any(&mut t, "owner", &form_id);
    let (code, message) = err(t
        .as_("owner")
        .call("deleteForm", json!({ "formId": form_id })));
    assert_eq!(code, "Refused");
    assert!(message.contains("close it instead"));
}

#[test]
fn events_carry_ids_never_answers() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let id = submit_any(&mut t, "gus", &form_id);
    let events = t.events_for("bob");
    let (name, data) = events.last().unwrap();
    assert_eq!(name, "Submitted");
    assert_eq!(data, &json!({ "id": id, "formId": form_id }));
    assert!(names(&t, "bob").contains(&"FormChanged".to_owned()));
    call(
        &mut t,
        "owner",
        "setArchived",
        json!({ "id": id, "archived": true }),
    );
    assert_eq!(
        t.events_for("bob").last().unwrap(),
        &("ResponseChanged".to_owned(), json!({ "id": id }))
    );
    // Events go to the organization's members, never to its guests (nor to
    // anyone a public instance reaches): gus sent the response and hears none.
    assert!(t.events_for("gus").is_empty());
}

#[test]
fn admins_issue_form_keys_and_see_what_each_sent() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    issue_key(&mut t, &form_id);
    let (_, message) = err(t.as_("owner").call(
        "registerFormKey",
        json!({ "account": "key-2", "formId": "nope", "label": "x" }),
    ));
    assert_eq!(message, "no form nope");
    let (_, message) = err(t.as_("owner").call(
        "registerFormKey",
        json!({ "account": "key-2", "formId": form_id, "label": " " }),
    ));
    assert_eq!(message, "label is required");
    submit_from_key(&mut t, &form_id, contact_answers("Ada")).unwrap();
    t.advance(5_000);
    submit_from_key(&mut t, &form_id, contact_answers("Bea")).unwrap();
    let keys = view(&mut t, "owner", "listFormKeys", json!({}));
    assert_eq!(keys.as_array().map(Vec::len), Some(1));
    assert_eq!(keys[0]["account"], json!("key-site"));
    assert_eq!(keys[0]["label"], json!("calimero.network"));
    assert_eq!(keys[0]["formId"], json!(form_id));
    assert_eq!(keys[0]["createdBy"], json!("owner"));
    assert_eq!(keys[0]["responses"], json!(2));
    assert_eq!(
        keys[0]["lastResponseAt"],
        json!((common::T0 + 5_000).to_string())
    );

    call(
        &mut t,
        "owner",
        "forgetFormKey",
        json!({ "account": "key-site" }),
    );
    assert_eq!(view(&mut t, "owner", "listFormKeys", json!({})), json!([]));
}

#[test]
fn responses_read_newest_first() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let first = submit_any(&mut t, "owner", &form_id);
    t.advance(1_000);
    let second = submit_any(&mut t, "bob", &form_id);
    let list = view(
        &mut t,
        "owner",
        "listResponses",
        json!({ "formId": form_id }),
    );
    let ids: Vec<&str> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [second.as_str(), first.as_str()]);
    assert_eq!(
        view(
            &mut t,
            "owner",
            "listResponses",
            json!({ "formId": "other" })
        ),
        json!({ "items": [], "next": null })
    );
}

/// Responses grow without bound, so they are read one page at a time; the
/// cursor of one page gives the next, older one.
#[test]
fn responses_are_read_in_pages() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let other = contact_form(&mut t);
    let mut sent = Vec::new();
    for _ in 0..5 {
        sent.push(submit_any(&mut t, "owner", &form_id));
        submit_any(&mut t, "owner", &other);
        t.advance(1_000);
    }
    sent.reverse();
    let mut read = Vec::new();
    let mut cursor = Value::Null;
    let mut pages = 0;
    loop {
        let page = view(
            &mut t,
            "owner",
            "listResponses",
            json!({ "formId": form_id, "cursor": cursor, "limit": 2 }),
        );
        pages += 1;
        for r in page["items"].as_array().unwrap() {
            assert_eq!(r["formId"], json!(form_id));
            read.push(r["id"].as_str().unwrap().to_owned());
        }
        cursor = page["next"].clone();
        if cursor.is_null() {
            break;
        }
    }
    assert_eq!(read, sent);
    assert_eq!(pages, 3);
    // No limit is 100; over 1,000 is 1,000.
    let all = view(
        &mut t,
        "owner",
        "listResponses",
        json!({ "formId": form_id, "limit": 5000 }),
    );
    assert_eq!(all["items"].as_array().map(Vec::len), Some(5));
}

// ── public links ─────────────────────────────────────────────────────────────

/// The token in link `n`'s URL: the secret only the URL carries.
fn token(n: u8) -> String {
    format!("tok-{n:02}-{}", "q".repeat(30))
}

/// Link `n`'s id: the SHA-256 of its token, what the team registers.
fn link_id(n: u8) -> String {
    hex::encode(Sha256::digest(token(n).as_bytes()))
}

/// A contact form, made public.
fn public_form(t: &mut TestApp) -> String {
    let form_id = contact_form(t);
    call(
        t,
        "owner",
        "setFormPublic",
        json!({ "formId": form_id, "public": true }),
    );
    form_id
}

fn make_link(t: &mut TestApp, form_id: &str, n: u8, label: &str) -> Value {
    call(
        t,
        "owner",
        "createLink",
        json!({ "formId": form_id, "link": link_id(n), "label": label }),
    )
}

/// A visitor answering through link `n` (`gus` plays the anonymous visitor).
fn via_link(
    t: &mut TestApp,
    n: u8,
    captcha: Value,
    captcha_token: Value,
) -> Result<Value, Failure> {
    t.as_("gus").call(
        "submitViaLink",
        json!({ "link": token(n), "answers": contact_answers("Visitor"), "captcha": captcha, "captchaToken": captcha_token }),
    )
}

#[test]
fn a_link_takes_responses_only_while_its_form_is_public() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let made = make_link(&mut t, &form_id, 1, " newsletter ");
    assert_eq!(made["id"], json!(link_id(1)));
    assert_eq!(made["label"], json!("newsletter"));
    assert_eq!(made["responses"], json!(0));
    assert_eq!(made["createdBy"], json!("owner"));

    let seen = view(&mut t, "gus", "linkForm", json!({ "link": token(1) }));
    assert_eq!(seen["formId"], json!(form_id));
    assert_eq!(seen["accepting"], json!(false));
    assert_eq!(seen["captcha"], json!(false));
    assert_eq!(seen["captchaByNode"], json!(false));
    assert_eq!(seen["captchaSiteKey"], json!(""));
    assert_eq!(seen["fields"].as_array().map(Vec::len), Some(5));

    let (code, message) = err(via_link(&mut t, 1, Value::Null, Value::Null));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Refused", "this form is not taking responses from links")
    );
    call(
        &mut t,
        "owner",
        "setFormPublic",
        json!({ "formId": form_id, "public": true }),
    );
    let id = via_link(&mut t, 1, Value::Null, Value::Null).unwrap();
    let r = view(&mut t, "owner", "getResponse", json!({ "id": id }));
    assert_eq!(r["link"], json!(link_id(1)));
    assert_eq!(r["source"], json!("public link · newsletter"));
    assert_eq!(r["submittedBy"], json!("gus"));
    let links = view(&mut t, "owner", "listLinks", json!({ "formId": form_id }));
    assert_eq!(links[0]["responses"], json!(1));
    assert_eq!(links[0]["lastHour"], json!(1));

    // A wrong answer is refused like any other response.
    let (code, _) = err(t.as_("gus").call(
        "submitViaLink",
        json!({ "link": token(1), "answers": [answer("email", &["nope"])], "captcha": null, "captchaToken": null }),
    ));
    assert_eq!(code, "Invalid");

    call(
        &mut t,
        "owner",
        "setFormOpen",
        json!({ "formId": form_id, "open": false }),
    );
    let (_, message) = err(via_link(&mut t, 1, Value::Null, Value::Null));
    assert_eq!(message, "this form is closed");
}

/// The forged-write check for links: only the token opens a link. Its id (what
/// the team's list shows) is not a token, and a link reaches nothing but its
/// own form.
#[test]
fn only_the_token_opens_a_link_and_a_link_reaches_nothing_else() {
    let mut t = app();
    let form_id = public_form(&mut t);
    make_link(&mut t, &form_id, 1, "");
    for link in [link_id(1), token(2), String::new(), "x".repeat(300)] {
        let (code, message) = err(t.as_("gus").view("linkForm", json!({ "link": link })));
        assert_eq!(
            (code.as_str(), message.as_str()),
            ("Refused", "this link no longer works")
        );
    }
    // The same visitor reaches none of the team's methods.
    let (code, _) = err(t
        .as_("gus")
        .view("listResponses", json!({ "formId": form_id })));
    assert_eq!(code, "Forbidden");
    let (code, _) = err(t.as_("gus").call(
        "createLink",
        json!({ "formId": form_id, "link": link_id(2), "label": "" }),
    ));
    assert_eq!(code, "Forbidden");
}

#[test]
fn a_deleted_or_unknown_link_answers_nothing() {
    let mut t = app();
    let form_id = public_form(&mut t);
    make_link(&mut t, &form_id, 1, "a");
    let gone = call(&mut t, "owner", "deleteLink", json!({ "link": link_id(1) }));
    assert_eq!(gone["label"], json!("a"));
    assert_eq!(gone["createdBy"], json!("owner"));
    let (code, message) = err(via_link(&mut t, 1, Value::Null, Value::Null));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Refused", "this link no longer works")
    );
    let (code, _) = err(t
        .as_("owner")
        .call("deleteLink", json!({ "link": link_id(1) })));
    assert_eq!(code, "NotFound");
    assert_eq!(
        view(&mut t, "owner", "listLinks", json!({ "formId": form_id })),
        json!([])
    );
    let (_, message) = err(t.as_("owner").call(
        "createLink",
        json!({ "formId": form_id, "link": "abc", "label": "" }),
    ));
    assert!(message.contains("SHA-256"));
    make_link(&mut t, &form_id, 3, "");
    let (_, message) = err(t.as_("owner").call(
        "createLink",
        json!({ "formId": form_id, "link": link_id(3), "label": "" }),
    ));
    assert_eq!(message, "this link already exists");
    let (code, _) = err(t.as_("owner").call(
        "createLink",
        json!({ "formId": "nope", "link": link_id(4), "label": "" }),
    ));
    assert_eq!(code, "NotFound");
}

#[test]
fn a_form_has_at_most_a_hundred_links() {
    let mut t = app();
    let form_id = public_form(&mut t);
    for n in 0..100u8 {
        make_link(&mut t, &form_id, n, "");
    }
    let (code, message) = err(t.as_("owner").call(
        "createLink",
        json!({ "formId": form_id, "link": link_id(100), "label": "" }),
    ));
    assert_eq!(code, "Refused");
    assert!(message.contains("at most 100"));
    assert_eq!(
        view(&mut t, "owner", "listLinks", json!({ "formId": form_id }))
            .as_array()
            .map(Vec::len),
        Some(100)
    );
}

#[test]
fn a_link_is_capped_per_hour() {
    let mut t = app();
    let form_id = public_form(&mut t);
    make_link(&mut t, &form_id, 1, "");
    let (_, message) = err(t
        .as_("owner")
        .call("setLinkCap", json!({ "formId": form_id, "perHour": 0 })));
    assert!(message.contains("between 1 and"));
    call(
        &mut t,
        "owner",
        "setLinkCap",
        json!({ "formId": form_id, "perHour": 2 }),
    );
    via_link(&mut t, 1, Value::Null, Value::Null).unwrap();
    via_link(&mut t, 1, Value::Null, Value::Null).unwrap();
    let (_, message) = err(via_link(&mut t, 1, Value::Null, Value::Null));
    assert!(message.contains("this hour"));
    // The next clock hour takes responses again.
    t.advance(HOUR);
    via_link(&mut t, 1, Value::Null, Value::Null).unwrap();
    let links = view(&mut t, "owner", "listLinks", json!({ "formId": form_id }));
    assert_eq!(links[0]["responses"], json!(3));
    assert_eq!(links[0]["lastHour"], json!(1));
}

#[test]
fn only_the_team_manages_links() {
    let mut t = app();
    let form_id = public_form(&mut t);
    for (method, args) in [
        (
            "setFormPublic",
            json!({ "formId": form_id, "public": false }),
        ),
        ("setLinkCap", json!({ "formId": form_id, "perHour": 5 })),
        ("setCaptchaKey", json!({ "formId": form_id, "key": "" })),
        (
            "createLink",
            json!({ "formId": form_id, "link": link_id(1), "label": "" }),
        ),
        ("deleteLink", json!({ "link": link_id(1) })),
    ] {
        let (code, _) = err(t.as_("bob").call(method, args));
        assert_eq!(code, "Forbidden", "{method}");
    }
    let (code, _) = err(t.as_("bob").view("listLinks", json!({ "formId": form_id })));
    assert_eq!(code, "Forbidden");
}

#[test]
fn deleting_a_form_takes_its_links_with_it() {
    let mut t = app();
    let form_id = public_form(&mut t);
    make_link(&mut t, &form_id, 1, "");
    call(&mut t, "owner", "deleteForm", json!({ "formId": form_id }));
    let (_, message) = err(t.as_("gus").view("linkForm", json!({ "link": token(1) })));
    assert_eq!(message, "this link no longer works");
    // The token's id is free again.
    let other = contact_form(&mut t);
    make_link(&mut t, &other, 1, "");
}

// ── captchas ─────────────────────────────────────────────────────────────────

fn verifier() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn pass(form_id: &str, link: &str, nonce: &str, expires_ms: u64) -> Value {
    let message = format!("mero-forms/captcha/v1|{form_id}|{link}|{nonce}|{expires_ms}");
    let signature = verifier().sign(message.as_bytes());
    json!({ "nonce": nonce, "expiresMs": expires_ms.to_string(), "signature": hex::encode(signature.to_bytes()) })
}

#[test]
fn a_captcha_pass_is_checked_and_spent_once() {
    let mut t = app();
    let form_id = public_form(&mut t);
    make_link(&mut t, &form_id, 1, "");
    let key = hex::encode(verifier().verifying_key().to_bytes());
    let form = call(
        &mut t,
        "owner",
        "setCaptchaKey",
        json!({ "formId": form_id, "key": key.to_uppercase() }),
    );
    assert_eq!(form["captchaKey"], json!(key));
    let seen = view(&mut t, "gus", "linkForm", json!({ "link": token(1) }));
    assert_eq!(seen["captcha"], json!(true));
    assert_eq!(seen["captchaByNode"], json!(false));
    let now = common::T0;
    let nonce = "ab".repeat(16);

    let (_, message) = err(via_link(&mut t, 1, Value::Null, Value::Null));
    assert_eq!(message, "this form needs a captcha");
    // Signed for another link, expired, too long-lived, malformed, forged.
    for (captcha, want) in [
        (
            pass(&form_id, &link_id(2), &nonce, now + 60_000),
            "not valid for this form",
        ),
        (pass(&form_id, &link_id(1), &nonce, now - 1), "expired"),
        (
            pass(&form_id, &link_id(1), &nonce, now + 11 * 60_000),
            "too long",
        ),
        (pass(&form_id, &link_id(1), "zz", now + 60_000), "malformed"),
        (
            json!({ "nonce": nonce, "expiresMs": (now + 60_000).to_string(), "signature": "00".repeat(64) }),
            "not valid for this form",
        ),
    ] {
        let (code, message) = err(via_link(&mut t, 1, captcha, Value::Null));
        assert_eq!(code, "Refused");
        assert!(message.contains(want), "{message} should say {want}");
    }
    let good = pass(&form_id, &link_id(1), &nonce, now + 60_000);
    via_link(&mut t, 1, good.clone(), Value::Null).unwrap();
    let (_, message) = err(via_link(&mut t, 1, good, Value::Null));
    assert!(message.contains("already used"));

    // A spent pass is dropped once it has expired, by the next one accepted.
    t.advance(120_000);
    let next = "cd".repeat(16);
    via_link(
        &mut t,
        1,
        pass(&form_id, &link_id(1), &next, now + 180_000),
        Value::Null,
    )
    .unwrap();
    // Turned off, a link needs none.
    call(
        &mut t,
        "owner",
        "setCaptchaKey",
        json!({ "formId": form_id, "key": "" }),
    );
    via_link(&mut t, 1, Value::Null, Value::Null).unwrap();
    let (code, _) = err(t
        .as_("owner")
        .call("setCaptchaKey", json!({ "formId": form_id, "key": "abc" })));
    assert_eq!(code, "Invalid");
}

/// What Cloudflare saw: every request the mock answered.
type Seen = Arc<Mutex<Vec<HttpRequest>>>;

/// Cloudflare's `siteverify`, answering `status` and `body` to every request.
fn cloudflare(t: &mut TestApp, status: u16, body: &'static str) -> Seen {
    let seen: Seen = Arc::default();
    let log = Arc::clone(&seen);
    t.mock_http("challenges.cloudflare.com", move |r: &HttpRequest| {
        log.lock().unwrap().push(r.clone());
        HttpResponse {
            status,
            headers: vec![("content-type".into(), "application/json".into())],
            body: body.as_bytes().to_vec(),
        }
    });
    seen
}

/// A public form whose captcha the contract checks with Cloudflare.
fn turnstile_form(t: &mut TestApp) -> String {
    let form_id = public_form(t);
    make_link(t, &form_id, 1, "");
    let form = call(
        t,
        "owner",
        "setCaptchaKey",
        json!({ "formId": form_id, "key": " TurnStile " }),
    );
    assert_eq!(form["captchaKey"], json!("turnstile"));
    form_id
}

#[test]
fn a_turnstile_token_is_checked_with_cloudflare_from_the_call() {
    let mut t = app();
    let form_id = turnstile_form(&mut t);
    let seen = cloudflare(&mut t, 200, r#"{"success":true,"error-codes":[]}"#);
    let page = view(&mut t, "gus", "linkForm", json!({ "link": token(1) }));
    assert_eq!(page["captcha"], json!(true));
    assert_eq!(page["captchaByNode"], json!(true));

    // No token, or one that cannot be a token: refused before anything is sent.
    let (_, message) = err(via_link(&mut t, 1, Value::Null, Value::Null));
    assert_eq!(message, "this form needs a captcha");
    let (_, message) = err(via_link(&mut t, 1, Value::Null, json!("a b&secret=x")));
    assert_eq!(message, "the captcha token is malformed");
    // A wrong answer spends no token either: it is refused before the check.
    let (code, _) = err(t.as_("gus").call(
        "submitViaLink",
        json!({ "link": token(1), "answers": [answer("email", &["nope"])], "captcha": null, "captchaToken": "XXXX.good" }),
    ));
    assert_eq!(code, "Invalid");
    assert!(seen.lock().unwrap().is_empty());

    let id = via_link(&mut t, 1, Value::Null, json!(" XXXX.good-token_1 ")).unwrap();
    let r = view(&mut t, "owner", "getResponse", json!({ "id": id }));
    assert_eq!(r["link"], json!(link_id(1)));
    assert_eq!(r["formId"], json!(form_id));
    let requests = seen.lock().unwrap().clone();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.method, "POST");
    assert_eq!(
        request.url,
        "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    // The secret is named for the node to fill in, never held by the app.
    assert_eq!(
        String::from_utf8_lossy(&request.body),
        "secret={{secret:TURNSTILE_SECRET}}&response=XXXX.good-token_1"
    );
    assert!(request
        .headers
        .iter()
        .any(|(k, v)| k.eq_ignore_ascii_case("content-type")
            && v == "application/x-www-form-urlencoded"));
}

#[test]
fn a_turnstile_check_that_fails_or_cannot_happen_refuses_the_response() {
    for (status, body, want) in [
        (
            200,
            r#"{"success":false,"error-codes":["invalid-input-response"]}"#,
            "was not solved",
        ),
        (
            200,
            r#"{"success":false,"error-codes":["timeout-or-duplicate"]}"#,
            "expired or was already used",
        ),
        (
            200,
            r#"{"success":false,"error-codes":["invalid-input-secret"]}"#,
            "no valid Turnstile secret",
        ),
        (500, "oops", "Cloudflare answered 500"),
        (200, "<html>", "an unreadable answer"),
    ] {
        let mut t = app();
        let form_id = turnstile_form(&mut t);
        cloudflare(&mut t, status, body);
        let (code, message) = err(via_link(&mut t, 1, Value::Null, json!("tok")));
        assert_eq!(code, "Refused", "{body}");
        assert!(message.contains(want), "{message} should say {want}");
        // Nothing was stored, and the link's count did not move.
        let page = view(
            &mut t,
            "owner",
            "listResponses",
            json!({ "formId": form_id }),
        );
        assert_eq!(page["items"], json!([]));
        assert_eq!(
            view(&mut t, "owner", "listLinks", json!({ "formId": form_id }))[0]["responses"],
            json!(0)
        );
    }
    // Cloudflare unreachable (no host answers: the gate refused it, or the
    // network failed): refused, never passed.
    let mut t = app();
    turnstile_form(&mut t);
    let (code, message) = err(via_link(&mut t, 1, Value::Null, json!("tok")));
    assert_eq!(code, "Refused");
    assert!(
        message.starts_with("the captcha could not be checked"),
        "{message}"
    );
}

#[test]
fn the_team_sets_its_turnstile_site_key_but_no_secret() {
    let mut t = app();
    turnstile_form(&mut t);
    let settings = call(
        &mut t,
        "owner",
        "setCaptchaSiteKey",
        json!({ "siteKey": " 0x4AAAAAAA-site_key " }),
    );
    assert_eq!(
        settings,
        json!({ "siteKey": "0x4AAAAAAA-site_key", "secretSet": false, "teeAvailable": false, "needsResealing": false })
    );
    assert_eq!(
        view(&mut t, "gus", "linkForm", json!({ "link": token(1) }))["captchaSiteKey"],
        json!("0x4AAAAAAA-site_key")
    );
    assert_eq!(
        view(&mut t, "owner", "captchaSettings", json!({}))["siteKey"],
        json!("0x4AAAAAAA-site_key")
    );
    let (code, _) = err(t
        .as_("owner")
        .call("setCaptchaSiteKey", json!({ "siteKey": "<script>" })));
    assert_eq!(code, "Invalid");
    // A team-held secret needs a TEE to seal it to: not in this release.
    let (code, message) = err(t.as_("owner").call(
        "setCaptchaSecret",
        json!({ "siteKey": "0x4AAA", "secret": "s" }),
    ));
    assert_eq!(code, "Unsupported");
    assert!(message.contains("TURNSTILE_SECRET"));
    let cleared = json!({ "siteKey": "", "secretSet": false, "teeAvailable": false, "needsResealing": false });
    assert_eq!(
        call(&mut t, "owner", "clearCaptchaSecret", json!({})),
        cleared
    );
    call(
        &mut t,
        "owner",
        "setCaptchaSiteKey",
        json!({ "siteKey": "k" }),
    );
    assert_eq!(
        call(
            &mut t,
            "owner",
            "setCaptchaSiteKey",
            json!({ "siteKey": "" })
        ),
        cleared
    );
}

// ── Mero CRM ─────────────────────────────────────────────────────────────────

/// What the mock Mero CRM instance `crm-app` was asked.
type Asked = Arc<Mutex<Vec<OtherAppCall>>>;

/// Mero CRM's `importFormResponse` on the instance `crm-app`, answering
/// `answer` to every call.
fn crm(t: &mut TestApp, answer: Result<Value, Value>) -> Asked {
    let asked: Asked = Arc::default();
    let log = Arc::clone(&asked);
    t.mock_app("crm-app", move |c: &OtherAppCall| {
        log.lock().unwrap().push(c.clone());
        answer.clone()
    });
    asked
}

/// A contact form linked to the `lead` stage of `crm-app`.
fn linked_form(t: &mut TestApp) -> String {
    let form_id = contact_form(t);
    call(
        t,
        "owner",
        "setCrmLink",
        json!({ "formId": form_id, "link": { "contextId": "crm-app", "stageId": "lead",
                "nameField": "name", "emailField": "email", "phoneField": "",
                "organizationField": "company", "titleField": "" } }),
    );
    form_id
}

#[test]
fn send_to_crm_hands_a_response_to_mero_crm_in_one_call() {
    let mut t = app();
    add_bob(&mut t);
    let form_id = linked_form(&mut t);
    let id = call(
        &mut t,
        "gus",
        "submitResponse",
        json!({ "formId": form_id, "answers": contact_answers("Ada Lovelace"), "source": "/contact/" }),
    );
    let asked = crm(
        &mut t,
        Ok(json!({ "contactId": "contact-1", "dealId": "deal-1" })),
    );
    let r = call(&mut t, "bob", "sendToCrm", json!({ "id": id }));
    assert_eq!(r["crmContext"], json!("crm-app"));
    assert_eq!(r["crmDeal"], json!("deal-1"));
    assert_eq!(r["crmSentBy"], json!("bob"));
    assert_eq!(r["crmSentAt"], json!(common::T0.to_string()));

    let calls = asked.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    assert!(!calls[0].view);
    assert_eq!(calls[0].method, "importFormResponse");
    let args = &calls[0].args;
    assert_eq!(args["stageId"], json!("lead"));
    assert_eq!(
        args["contact"],
        json!({ "name": "Ada Lovelace", "email": "ada@example.com", "phone": "",
                "organization": "Analytical Engines", "jobTitle": "" })
    );
    assert_eq!(
        args["deal"],
        json!({ "title": "Ada Lovelace · Analytical Engines", "organization": "Analytical Engines",
                "source": "Mero Forms · Contact" })
    );
    assert_eq!(
        args["note"],
        json!("From the form \"Contact\":\n\nName: Ada Lovelace\nEmail: ada@example.com\nCompany: Analytical Engines\nTopic: Cloud\nMessage: Hello\nSent from: /contact/")
    );
    let external = args["externalRef"].as_str().unwrap();
    assert!(
        external.starts_with("mero-forms:")
            && external.ends_with(&format!(":{}", id.as_str().unwrap()))
    );

    // In CRM for the whole team; the second send is refused before Mero CRM
    // is asked again.
    assert_eq!(
        view(&mut t, "owner", "listForms", json!({}))[0]["newResponses"],
        json!(0)
    );
    let (code, message) = err(t.as_("owner").call("sendToCrm", json!({ "id": id })));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Refused", "this response was already sent to the CRM")
    );
    assert_eq!(asked.lock().unwrap().len(), 1);
    assert_eq!(
        t.events_for("bob").last().unwrap(),
        &("ResponseChanged".to_owned(), json!({ "id": id }))
    );
}

#[test]
fn send_to_crm_records_nothing_when_mero_crm_refuses() {
    let mut t = app();
    let form_id = linked_form(&mut t);
    let id = submit_any(&mut t, "owner", &form_id);
    crm(
        &mut t,
        Err(json!({ "code": "NotFound", "fields": { "message": "no stage lead" } })),
    );
    let (code, message) = err(t.as_("owner").call("sendToCrm", json!({ "id": id })));
    assert_eq!(code, "Refused");
    assert!(
        message.starts_with("Mero CRM refused the hand-off"),
        "{message}"
    );
    assert!(message.contains("no stage lead"), "{message}");
    let r = view(&mut t, "owner", "getResponse", json!({ "id": id }));
    assert_eq!(r["crmDeal"], json!(""));

    // An answer with no deal id records nothing either.
    let mut t = app();
    let form_id = linked_form(&mut t);
    let id = submit_any(&mut t, "owner", &form_id);
    crm(&mut t, Ok(json!({ "dealId": " " })));
    let (code, _) = err(t.as_("owner").call("sendToCrm", json!({ "id": id })));
    assert_eq!(code, "Refused");
    // Nor does an instance that answers nothing (not Mero CRM, not in the
    // organization, or not allowing this app).
    let mut t = app();
    let form_id = linked_form(&mut t);
    let id = submit_any(&mut t, "owner", &form_id);
    let (code, message) = err(t.as_("owner").call("sendToCrm", json!({ "id": id })));
    assert_eq!(code, "Refused");
    assert!(
        message.starts_with("Mero CRM refused the hand-off"),
        "{message}"
    );
}

#[test]
fn send_to_crm_needs_a_linked_form_and_the_team() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let id = submit_any(&mut t, "owner", &form_id);
    let (code, message) = err(t.as_("owner").call("sendToCrm", json!({ "id": id })));
    assert_eq!(
        (code.as_str(), message.as_str()),
        ("Refused", "this form is not connected to a CRM pipeline")
    );
    let (code, _) = err(t.as_("owner").call("sendToCrm", json!({ "id": "nope" })));
    assert_eq!(code, "NotFound");
    // Off the team: refused before anything is sent.
    let asked = crm(&mut t, Ok(json!({ "dealId": "d" })));
    let (code, _) = err(t.as_("bob").call("sendToCrm", json!({ "id": id })));
    assert_eq!(code, "Forbidden");
    assert!(asked.lock().unwrap().is_empty());
}

#[test]
fn the_crm_payload_falls_back_and_clips_like_v1() {
    let mut t = app();
    let form_id = call(
        &mut t,
        "owner",
        "createForm",
        json!({ "title": "Short", "description": "" }),
    );
    call(
        &mut t,
        "owner",
        "updateForm",
        json!({ "formId": form_id, "title": "Short", "description": "", "fields": [
            field("email", "email", "Email", false, &[]),
            field("about", "paragraph", "About", false, &[]),
        ] }),
    );
    call(
        &mut t,
        "owner",
        "setCrmLink",
        json!({ "formId": form_id, "link": { "contextId": "crm-app", "stageId": "s1",
                "nameField": "about", "emailField": "email" } }),
    );
    let long = "y".repeat(500);
    let id = call(
        &mut t,
        "owner",
        "submitResponse",
        json!({ "formId": form_id, "answers": [answer("about", &[long.as_str()])], "source": "" }),
    );
    let asked = crm(&mut t, Ok(json!({ "dealId": "deal-9" })));
    call(&mut t, "owner", "sendToCrm", json!({ "id": id }));
    let args = asked.lock().unwrap()[0].args.clone();
    let name = args["contact"]["name"].as_str().unwrap();
    assert_eq!(name.chars().count(), 120);
    assert!(name.ends_with('…'));
    assert_eq!(args["contact"]["email"], json!(""));
    // The note keeps the whole answer; no source line without a source.
    assert!(args["note"].as_str().unwrap().ends_with(&long));

    // Nothing to name the contact by: "Form response".
    let id = call(
        &mut t,
        "owner",
        "submitResponse",
        json!({ "formId": form_id, "answers": [], "source": "" }),
    );
    call(&mut t, "owner", "sendToCrm", json!({ "id": id }));
    let args = asked.lock().unwrap()[1].args.clone();
    assert_eq!(args["contact"]["name"], json!("Form response"));
    assert_eq!(args["deal"]["title"], json!("Form response"));
}

// ── access and wire ──────────────────────────────────────────────────────────

/// The org decides who reaches the app; the methods decide the rest.
#[test]
fn who_reaches_the_workspace() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    let refused = |status: u16, code: &str| {
        Err(Failure::Refused {
            status,
            code: code.to_owned(),
        })
    };
    assert_eq!(
        t.anonymous().view("listForms", json!({})),
        refused(401, "UNAUTHENTICATED")
    );
    // The harness app is an org app: anonymous is refused before the app
    // runs, `public` methods included. On a node, an instance whose owner made
    // it public lets anonymous callers reach `linkForm` and `submitViaLink`
    // (and only those: every other method is not `public`, `401`).
    assert_eq!(
        t.anonymous().view("linkForm", json!({ "link": token(1) })),
        refused(401, "UNAUTHENTICATED")
    );
    assert_eq!(
        t.anonymous().call(
            "submitViaLink",
            json!({ "link": token(1), "answers": [], "captcha": null, "captchaToken": null })
        ),
        refused(401, "UNAUTHENTICATED")
    );
    assert_eq!(
        t.as_("mallory").call(
            "submitResponse",
            json!({ "formId": form_id, "answers": contact_answers("x"), "source": "" })
        ),
        refused(404, "NOT_FOUND")
    );
    add_bob(&mut t);
    t.remove_member("bob");
    assert_eq!(
        t.as_("bob").view("listForms", json!({})),
        refused(404, "NOT_FOUND")
    );
}

#[test]
fn malformed_arguments_and_v1_names_are_refused() {
    let mut t = app();
    let form_id = contact_form(&mut t);
    for args in [
        json!({}),
        json!({ "form_id": form_id, "answers": [], "source": "" }),
        json!({ "formId": form_id, "answers": [{ "field_id": "name", "values": [] }], "source": "" }),
    ] {
        let (code, _) = err(t.as_("owner").call("submitResponse", args));
        assert_eq!(code, "BadArgs");
    }
    let (code, _) = err(t.as_("owner").call("list_forms", json!({})));
    assert_eq!(code, "UnknownMethod");
    let (code, _) = err(t
        .as_("owner")
        .view("createForm", json!({ "title": "x", "description": "" })));
    assert_eq!(code, "NotAView");
}
