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
