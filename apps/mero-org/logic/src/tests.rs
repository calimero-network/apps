//! Drives `Org` through `TestHost`: real CRDT state, no node.
use calimero_sdk::testing::TestHost;

use super::*;

pub const FOUNDER: [u8; 32] = [0xA1; 32];
pub const ANA: [u8; 32] = [0xB2; 32];
#[allow(dead_code)] // used by later tasks
pub const BOB: [u8; 32] = [0xC3; 32];
pub const STRANGER: [u8; 32] = [0xE0; 32];

pub fn hex32(b: [u8; 32]) -> String {
    hex::encode(b)
}

pub fn founded() -> TestHost<Org> {
    let mut app = TestHost::new(Org::init);
    app.set_account(FOUNDER);
    app.set_device(FOUNDER);
    // `init` ran under TestHost's default identity; re-found so FOUNDER is admin.
    app.call(|s| s.roles = AccessControl::new_admin_caller());
    app
}

#[test]
fn the_founder_is_the_first_admin() {
    let app = founded();
    let view = app.view(|s| s.org()).unwrap();
    assert_eq!(view.admins, vec![hex32(FOUNDER)]);
    assert_eq!(view.name, "");
}

#[test]
fn only_an_admin_changes_settings() {
    let mut app = founded();
    app.call(|s| s.set_settings("Calimero".to_owned(), String::new()))
        .unwrap();
    let err = app
        .call_as_account(STRANGER, STRANGER, |s| {
            s.set_settings("Evil".to_owned(), String::new())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("admin"), "{err:?}");
    assert_eq!(app.view(|s| s.org()).unwrap().name, "Calimero");
}

#[test]
fn the_last_admin_cannot_resign() {
    let mut app = founded();
    let err = app.call(|s| s.revoke_admin(hex32(FOUNDER))).unwrap_err();
    assert!(format!("{err:?}").contains("last admin"), "{err:?}");
    app.call(|s| s.grant_admin(hex32(ANA))).unwrap();
    app.call(|s| s.revoke_admin(hex32(FOUNDER))).unwrap();
    assert_eq!(app.view(|s| s.admins()).unwrap(), vec![hex32(ANA)]);
}

pub fn claim(app: &mut TestHost<Org>, who: [u8; 32], name: &str) -> MemberView {
    app.call_as_account(who, who, |s| {
        s.claim_membership(name.to_owned(), name.to_lowercase())
    })
    .unwrap()
}

#[test]
fn a_namespace_member_claims_once() {
    let mut app = founded();
    let m = claim(&mut app, ANA, "Ana");
    assert_eq!(m.account, hex32(ANA));
    assert_eq!(m.status, STATUS_ENROLLED);
    assert_eq!((m.display_name.as_str(), m.handle.as_str()), ("Ana", "ana"));
    let err = app
        .call_as_account(ANA, ANA, |s| {
            s.claim_membership("Ana again".to_owned(), "ana2".to_owned())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("already a member"), "{err:?}");
    assert_eq!(app.view(|s| s.members()).unwrap().len(), 1);
}

#[test]
fn a_claim_needs_a_name_and_a_handle() {
    let mut app = founded();
    let err = app
        .call_as_account(ANA, ANA, |s| {
            s.claim_membership(String::new(), "ana".to_owned())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("display_name"), "{err:?}");
    assert!(app.view(|s| s.member(hex32(ANA))).unwrap().is_none());
}

#[test]
fn only_the_owner_edits_a_profile() {
    let mut app = founded();
    claim(&mut app, ANA, "Ana");
    app.call_as_account(ANA, ANA, |s| {
        s.update_profile("Ana R.".to_owned(), String::new())
    })
    .unwrap();
    assert_eq!(
        app.view(|s| s.member(hex32(ANA)))
            .unwrap()
            .unwrap()
            .display_name,
        "Ana R."
    );
    let err = app
        .call_as_account(BOB, BOB, |s| {
            s.update_profile_of(hex32(ANA), "Hacked".to_owned(), String::new())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("own profile"), "{err:?}");
    assert_eq!(
        app.view(|s| s.member(hex32(ANA)))
            .unwrap()
            .unwrap()
            .display_name,
        "Ana R."
    );
}

#[test]
fn only_an_admin_moves_status() {
    let mut app = founded();
    claim(&mut app, ANA, "Ana");
    let err = app
        .call_as_account(ANA, ANA, |s| {
            s.set_member_status(hex32(ANA), STATUS_ACTIVE.to_owned())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("admin"), "{err:?}");
    app.call(|s| s.set_member_status(hex32(ANA), STATUS_SUSPENDED.to_owned()))
        .unwrap();
    assert_eq!(
        app.view(|s| s.member(hex32(ANA))).unwrap().unwrap().status,
        STATUS_SUSPENDED
    );
    let err = app
        .call(|s| s.set_member_status(hex32(ANA), "banana".to_owned()))
        .unwrap_err();
    assert!(format!("{err:?}").contains("unknown status"), "{err:?}");
}

fn enrolled(app: &mut TestHost<Org>, who: [u8; 32], name: &str) {
    claim(app, who, name);
}

#[test]
fn groups_nest_and_cannot_cycle() {
    let mut app = founded();
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    let plat = app
        .call(|s| s.create_group("Platform".to_owned(), eng.id.clone()))
        .unwrap();
    assert_eq!(plat.parent, eng.id);
    let err = app
        .call(|s| s.move_group(eng.id.clone(), plat.id.clone()))
        .unwrap_err();
    assert!(format!("{err:?}").contains("cycle"), "{err:?}");
    let err = app
        .call(|s| s.create_group("Orphan".to_owned(), "nope".to_owned()))
        .unwrap_err();
    assert!(format!("{err:?}").contains("no group"), "{err:?}");
}

#[test]
fn membership_is_admin_only_and_listed_on_the_member() {
    let mut app = founded();
    enrolled(&mut app, ANA, "ana");
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    let err = app
        .call_as_account(ANA, ANA, |s| {
            s.set_membership(eng.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned())
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("admin"), "{err:?}");
    app.call(|s| s.set_membership(eng.id.clone(), hex32(ANA), ROLE_LEAD.to_owned()))
        .unwrap();
    let m = app.view(|s| s.member(hex32(ANA))).unwrap().unwrap();
    assert_eq!(m.groups, vec![eng.id.clone()]);
    let gm = app.view(|s| s.group_members(eng.id.clone())).unwrap();
    assert_eq!(gm.len(), 1);
    let err = app
        .call(|s| s.set_membership(eng.id.clone(), hex32(STRANGER), ROLE_MEMBER.to_owned()))
        .unwrap_err();
    assert!(format!("{err:?}").contains("no member"), "{err:?}");
}

#[test]
fn deleting_a_group_cascades_memberships_and_children() {
    let mut app = founded();
    enrolled(&mut app, ANA, "ana");
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    let plat = app
        .call(|s| s.create_group("Platform".to_owned(), eng.id.clone()))
        .unwrap();
    app.call(|s| s.set_membership(plat.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned()))
        .unwrap();
    app.call(|s| s.delete_group(eng.id.clone())).unwrap();
    assert!(app.view(|s| s.groups()).unwrap().is_empty());
    assert!(app
        .view(|s| s.member(hex32(ANA)))
        .unwrap()
        .unwrap()
        .groups
        .is_empty());
}
