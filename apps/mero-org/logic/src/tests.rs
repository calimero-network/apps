//! Drives `Org` through `TestHost`: real CRDT state, no node.
use calimero_sdk::testing::TestHost;

use super::*;

trait ViewAs<S> {
    fn view_as<R>(&mut self, who: [u8; 32], f: impl FnOnce(&S) -> R) -> R;
}
impl ViewAs<Org> for TestHost<Org> {
    fn view_as<R>(&mut self, who: [u8; 32], f: impl FnOnce(&Org) -> R) -> R {
        self.call_as_account(who, who, |s| f(s))
    }
}

pub const FOUNDER: [u8; 32] = [0xA1; 32];
pub const ANA: [u8; 32] = [0xB2; 32];
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

const DRIVE_NS: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const APP_ID: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const PEER: &str = "/ip4/10.0.0.1/udp/2528/quic-v1/p2p/12D3KooWAdmin";

#[test]
fn access_goes_to_groups_and_placements_follow_memberships() {
    let mut app = founded();
    enrolled(&mut app, ANA, "ana");
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    app.call(|s| s.set_membership(eng.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned()))
        .unwrap();
    let drive = app
        .call(|s| {
            s.register_app(
                DRIVE_NS.to_owned(),
                "com.calimero.mero-drive-docs".to_owned(),
                "Drive".to_owned(),
                APP_READY.to_owned(),
                APP_ID.to_owned(),
                vec![PEER.to_owned()],
            )
        })
        .unwrap();
    assert_eq!(drive.id, DRIVE_NS);
    app.call(|s| s.set_access(eng.id.clone(), DRIVE_NS.to_owned(), 7))
        .unwrap();
    let want = app.view(|s| s.desired_placements()).unwrap();
    assert_eq!(want.len(), 1);
    assert_eq!(
        (
            want[0].account.as_str(),
            want[0].app.as_str(),
            want[0].group.as_str(),
            want[0].capabilities
        ),
        (hex32(ANA).as_str(), DRIVE_NS, eng.id.as_str(), 7)
    );
    assert_eq!(
        app.view(|s| s.member(hex32(ANA))).unwrap().unwrap().apps,
        vec![DRIVE_NS.to_owned()]
    );
    // A suspended member is not placed anywhere.
    app.call(|s| s.set_member_status(hex32(ANA), STATUS_SUSPENDED.to_owned()))
        .unwrap();
    assert!(app.view(|s| s.desired_placements()).unwrap().is_empty());
}

#[test]
fn the_reconciler_records_enrolment_and_the_member_reads_their_own() {
    let mut app = founded();
    enrolled(&mut app, ANA, "ana");
    enrolled(&mut app, BOB, "bob");
    app.call(|s| {
        s.register_app(
            DRIVE_NS.to_owned(),
            "p".to_owned(),
            "Drive".to_owned(),
            APP_READY.to_owned(),
            APP_ID.to_owned(),
            vec![PEER.to_owned()],
        )
    })
    .unwrap();
    app.call(|s| {
        s.record_enrolment(
            hex32(ANA),
            DRIVE_NS.to_owned(),
            ENROL_ADDED.to_owned(),
            vec![],
            String::new(),
        )
    })
    .unwrap();
    let mine = app.view_as(ANA, |s| s.my_enrolments()).unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].state, ENROL_ADDED);
    assert!(app.view_as(BOB, |s| s.my_enrolments()).unwrap().is_empty());
    let err = app
        .call_as_account(ANA, ANA, |s| {
            s.record_enrolment(
                hex32(ANA),
                DRIVE_NS.to_owned(),
                ENROL_PLACED.to_owned(),
                vec![],
                String::new(),
            )
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("admin"), "{err:?}");
}

#[test]
fn deleting_a_group_drops_its_access_rows() {
    let mut app = founded();
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    app.call(|s| {
        s.register_app(
            DRIVE_NS.to_owned(),
            "p".to_owned(),
            "Drive".to_owned(),
            APP_READY.to_owned(),
            APP_ID.to_owned(),
            vec![PEER.to_owned()],
        )
    })
    .unwrap();
    app.call(|s| s.set_access(eng.id.clone(), DRIVE_NS.to_owned(), 7))
        .unwrap();
    app.call(|s| s.delete_group(eng.id.clone())).unwrap();
    assert!(app.view(|s| s.access_rows()).unwrap().is_empty());
}

#[test]
fn activity_is_hash_chained_and_pages_newest_first() {
    let mut app = founded();
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    app.call(|s| s.rename_group(eng.id.clone(), "Eng".to_owned()))
        .unwrap();
    let page = app.view(|s| s.activity(0, 10)).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.rows[0].verb, "group_renamed");
    assert_eq!(page.rows[1].verb, "group_created");
    assert_eq!(page.rows[1].prev_hash, "");
    assert_eq!(page.rows[0].prev_hash, page.rows[1].hash);
    assert_eq!(page.rows[0].actor, hex32(FOUNDER));
    assert!(app.view(|s| s.verify_activity()).unwrap());
    let page = app.view(|s| s.activity(1, 10)).unwrap();
    assert_eq!(page.rows.len(), 1);
    assert_eq!(page.rows[0].index, 0);
}

#[test]
fn an_admin_cannot_be_suspended_or_removed_until_revoked() {
    let mut app = founded();
    claim(&mut app, ANA, "Ana");
    app.call(|s| s.grant_admin(hex32(ANA))).unwrap();
    for status in [STATUS_SUSPENDED, STATUS_LEFT] {
        let err = app
            .call(|s| s.set_member_status(hex32(ANA), status.to_owned()))
            .unwrap_err();
        assert!(format!("{err:?}").contains("revoke admin first"), "{err:?}");
    }
    assert_eq!(
        app.view(|s| s.member(hex32(ANA))).unwrap().unwrap().status,
        STATUS_ENROLLED
    );
    app.call(|s| s.revoke_admin(hex32(ANA))).unwrap();
    app.call(|s| s.set_member_status(hex32(ANA), STATUS_LEFT.to_owned()))
        .unwrap();
    assert_eq!(
        app.view(|s| s.member(hex32(ANA))).unwrap().unwrap().status,
        STATUS_LEFT
    );
}

#[test]
fn a_first_membership_activates_and_the_last_one_going_reverts_to_enrolled() {
    let mut app = founded();
    claim(&mut app, ANA, "Ana");
    let status =
        |app: &mut TestHost<Org>| app.view(|s| s.member(hex32(ANA))).unwrap().unwrap().status;
    let eng = app
        .call(|s| s.create_group("Engineering".to_owned(), String::new()))
        .unwrap();
    let ops = app
        .call(|s| s.create_group("Ops".to_owned(), String::new()))
        .unwrap();
    app.call(|s| s.set_membership(eng.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned()))
        .unwrap();
    assert_eq!(status(&mut app), STATUS_ACTIVE);
    app.call(|s| s.set_membership(ops.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned()))
        .unwrap();
    app.call(|s| s.remove_membership(eng.id.clone(), hex32(ANA)))
        .unwrap();
    assert_eq!(status(&mut app), STATUS_ACTIVE, "one membership remains");
    app.call(|s| s.remove_membership(ops.id.clone(), hex32(ANA)))
        .unwrap();
    assert_eq!(status(&mut app), STATUS_ENROLLED);
    // The cascade in delete_group reverts too.
    app.call(|s| s.set_membership(eng.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned()))
        .unwrap();
    assert_eq!(status(&mut app), STATUS_ACTIVE);
    app.call(|s| s.delete_group(eng.id.clone())).unwrap();
    assert_eq!(status(&mut app), STATUS_ENROLLED);
    // A suspended member stays suspended when memberships change.
    app.call(|s| s.set_member_status(hex32(ANA), STATUS_SUSPENDED.to_owned()))
        .unwrap();
    app.call(|s| s.set_membership(ops.id.clone(), hex32(ANA), ROLE_MEMBER.to_owned()))
        .unwrap();
    assert_eq!(status(&mut app), STATUS_SUSPENDED);
}

#[test]
fn an_app_carries_what_a_member_follows_it_with() {
    let mut app = founded();
    let drive = app
        .call(|s| {
            s.register_app(
                DRIVE_NS.to_owned(),
                "p".to_owned(),
                "Drive".to_owned(),
                APP_READY.to_owned(),
                APP_ID.to_owned(),
                vec![PEER.to_owned()],
            )
        })
        .unwrap();
    assert_eq!(drive.application_id, APP_ID);
    assert_eq!(drive.peer_addrs, vec![PEER.to_owned()]);

    let moved = "/ip4/10.0.0.2/udp/2528/quic-v1/p2p/12D3KooWAdmin".to_owned();
    app.call(|s| s.set_app_peers(DRIVE_NS.to_owned(), vec![moved.clone()]))
        .unwrap();
    let apps = app.view(|s| s.apps()).unwrap();
    assert_eq!(apps[0].peer_addrs, vec![moved]);
}

#[test]
fn only_the_admin_who_registered_an_app_moves_its_peers() {
    let mut app = founded();
    enrolled(&mut app, ANA, "ana");
    app.call(|s| s.grant_admin(hex32(ANA))).unwrap();
    app.call(|s| {
        s.register_app(
            DRIVE_NS.to_owned(),
            "p".to_owned(),
            "Drive".to_owned(),
            APP_READY.to_owned(),
            APP_ID.to_owned(),
            vec![],
        )
    })
    .unwrap();
    let err = app
        .call_as_account(ANA, ANA, |s| {
            s.set_app_peers(DRIVE_NS.to_owned(), vec![PEER.to_owned()])
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("registered the app"), "{err:?}");
}

#[test]
fn an_app_is_refused_a_bad_application_id_or_too_many_peers() {
    let mut app = founded();
    let register = |app: &mut TestHost<Org>, application_id: &str, peers: Vec<String>| {
        app.call(|s| {
            s.register_app(
                DRIVE_NS.to_owned(),
                "p".to_owned(),
                "Drive".to_owned(),
                APP_READY.to_owned(),
                application_id.to_owned(),
                peers,
            )
        })
    };
    assert!(register(&mut app, "abcd", vec![]).is_err());
    let too_many = vec![PEER.to_owned(); MAX_PEER_ADDRS + 1];
    assert!(register(&mut app, APP_ID, too_many).is_err());
    let too_long = vec!["a".repeat(MAX_PEER_ADDR + 1)];
    assert!(register(&mut app, APP_ID, too_long).is_err());
    assert!(register(&mut app, APP_ID, vec![PEER.to_owned()]).is_ok());
}
