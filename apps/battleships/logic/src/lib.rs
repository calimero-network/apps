//! Lobby service — match directory, player stats, and history.
//!
//! ## What holds against a node that does not run this code
//!
//! Every member runs their own node, and a patched one skips every check in
//! these methods. What every node enforces is the storage type:
//!
//! * `players` is `UserStorage`: each account writes only its own slot, so
//!   nobody can repoint another member's account at a key of their choosing.
//! * `matches` is `Authored`: a match is owned by the member who created it,
//!   and only they can link its game context.
//! * `results` is `WriteOnce`: a reported result can be neither edited nor
//!   removed. Which reports COUNT is the reader's question — see
//!   [`LobbyState::result_of`] — and stats are derived from those, never
//!   stored, so there is no counter for a member to bump.

use std::collections::BTreeSet;

use battleships_types::{GameError, PublicKey};
use calimero_sdk::abi::AbiType;
use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as AppError;
use calimero_storage::collections::{
    Authored, Frozen, IndexedMap, LwwRegister, UnorderedMap, UserStorage, WriteOnce,
};
use calimero_storage::env as storage_env;

pub mod events;
use events::Event;

// ---------------------------------------------------------------------------
// Lobby data models
// ---------------------------------------------------------------------------

#[derive(
    AbiType, Debug, Clone, PartialEq, Eq, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub enum MatchStatus {
    Pending,
    Active,
    Finished,
}

/// A match as its creator recorded it, keyed by match id and owned by them.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MatchEntry {
    pub player1: String,
    pub player2: String,
    /// The ACCOUNT player 2 registered their key under — what the game
    /// context checks player 2's rows against.
    pub player2_account: String,
    pub context_id: Option<String>,
    pub created_ms: u64,
}

/// A match as a client sees it. `status` and `winner` are derived from the
/// results, never stored.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchSummary {
    pub match_id: String,
    pub player1: String,
    pub player2: String,
    pub player2_account: String,
    pub status: MatchStatus,
    pub context_id: Option<String>,
    pub winner: Option<String>,
    pub created_ms: u64,
}

/// Flat snapshot of a player's stats — what consumers see over the wire.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerStatsView {
    pub wins: u64,
    pub losses: u64,
    pub games_played: u64,
}

/// One reported result, keyed `"<match_id>/<nonce>"`.
///
/// Indexed by winner and loser, so a player's stats are two index seeks rather
/// than a scan of every match, and by match, so the reader can gather every
/// report of one match.
#[derive(
    AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize, app::Indexed,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct MatchRecord {
    #[index]
    pub match_id: String,
    #[index]
    pub winner: String,
    #[index]
    pub loser: String,
    pub finished_ms: u64,
}

/// One member's account paired with the player key they play as.
///
/// ⚠️ THESE ARE TWO DIFFERENT ID SPACES AND NOTHING ELSE JOINS THEM. Group
/// membership — what `/admin-api/groups/{id}/members` returns and what the
/// lobby lists as a row — is keyed by ACCOUNT. A player is a CONTEXT MEMBER,
/// identified by the device/context key that `create_match` takes and that
/// `from_executor_id` reads. Both are 64 hex since rc.27, so mixing them up is
/// silent.
///
/// The node cannot supply the mapping: a node that JOINS a context only ever
/// lists its OWN context identity and never learns the ones already there
/// (measured across three local nodes — the creator saw all three keys, each
/// joiner saw exactly one, and that does not change with time). So the pairing
/// has to be recorded by the one party who knows both halves — the caller,
/// about itself — and replicated as ordinary contract state.
#[derive(AbiType, Debug, Clone, BorshSerialize, BorshDeserialize, Serialize, Deserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct PlayerEntry {
    /// The member's ACCOUNT id, as group membership keys it.
    pub account: String,
    /// The key that member plays as — what `create_match` expects.
    pub player: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// The caller, as a PublicKey.
///
/// `env::executor_id()` no longer exists. This is the DEVICE, not the account,
/// and the choice is forced by what a "player" is in this app: a player is a
/// CONTEXT MEMBER. The lobby records `player2` from a member key, the game
/// context is initialised with `{"player1": <memberPublicKey>, "player2": …}`,
/// and the frontend reads the same id from `/contexts/{id}/identities-owned`.
///
/// (Ownership is the exception: owner stamps and `UserStorage` are keyed by the
/// ACCOUNT, which is why `register_player` pairs the two.)
fn from_executor_id() -> Result<PublicKey, GameError> {
    let v = calimero_sdk::env::device_id();
    if v.len() != 32 {
        return Err(GameError::Invalid("executor id length".into()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&v);
    Ok(PublicKey(arr))
}

/// A storage failure, as the `GameError` the inner functions return.
fn storage(e: calimero_storage::collections::StoreError) -> GameError {
    GameError::Invalid(format!("storage: {e}"))
}

fn account_hex(bytes: &[u8; 32]) -> String {
    hex::encode(bytes)
}

// ---------------------------------------------------------------------------
// Lobby state
// ---------------------------------------------------------------------------

#[app::state(emits = for<'a> Event<'a>)]
pub struct LobbyState {
    created_ms: Frozen<u64>,
    /// match id -> the match, owned by the member who created it.
    matches: Authored<UnorderedMap<String, MatchEntry>>,
    /// `"<match_id>/<nonce>"` -> a result a game context reported.
    results: WriteOnce<IndexedMap<String, MatchRecord>>,
    /// account -> the player key that account plays as, written only by it.
    ///
    /// `LwwRegister` so a member who rejoins with a fresh context identity
    /// converges on the newer key.
    players: UserStorage<LwwRegister<String>>,
}

#[app::logic]
impl LobbyState {
    #[app::init]
    pub fn init() -> LobbyState {
        LobbyState {
            created_ms: Frozen::new(storage_env::time_now()),
            matches: Authored::new(),
            results: WriteOnce::new(),
            players: UserStorage::new(),
        }
    }

    // ---- Lobby API ----

    pub fn create_match(&mut self, player2: String) -> app::Result<String> {
        let caller = from_executor_id().map_err(|e| AppError::msg(e.to_string()))?;
        let caller_hex = caller.to_hex();
        let now = storage_env::time_now();
        let mut nonce_bytes = [0u8; 4];
        calimero_sdk::env::random_bytes(&mut nonce_bytes);
        let id = self
            .create_match_with_id(&caller_hex, &player2, now, &hex::encode(nonce_bytes))
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::MatchCreated { id: &id });
        app::emit!(Event::MatchListUpdated {});
        Ok(id)
    }

    /// Testable inner: deterministic given an explicit nonce, no event emits.
    /// The match_id is `{creator_hex}-{ts}-{nonce_hex}`. The 32-bit nonce
    /// makes a same-(creator, ts) collision astronomically unlikely; we still
    /// reject one if it ever happens (defensive — random-bytes giving the
    /// same 4 bytes twice is a hardware fault, not a runtime concern).
    pub(crate) fn create_match_with_id(
        &mut self,
        caller_hex: &str,
        player2_hex: &str,
        now_ms: u64,
        nonce_hex: &str,
    ) -> Result<String, GameError> {
        // Reject self-matches: the turn protocol assumes two distinct players.
        if caller_hex == player2_hex {
            return Err(GameError::Invalid(
                "cannot create match against self".into(),
            ));
        }
        // Reject malformed player2 keys early so the game context can validate
        // its caller against a real key.
        PublicKey::from_hex(player2_hex)
            .map_err(|e| GameError::Invalid(format!("player2 is not a valid hex key: {e}")))?;
        let player2_account = self.account_for(player2_hex)?;
        if player2_account == account_hex(&calimero_sdk::env::account_id()) {
            return Err(GameError::Invalid(
                "cannot create match against self".into(),
            ));
        }
        let match_id = format!("{caller_hex}-{now_ms}-{nonce_hex}");
        if self.matches.contains(&match_id).map_err(storage)? {
            return Err(GameError::MatchIdCollision);
        }
        self.matches
            .insert(
                match_id.clone(),
                MatchEntry {
                    player1: caller_hex.to_string(),
                    player2: player2_hex.to_string(),
                    player2_account,
                    context_id: None,
                    created_ms: now_ms,
                },
            )
            .map_err(storage)?;
        Ok(match_id)
    }

    pub fn set_match_context_id(
        &mut self,
        match_id: String,
        context_id: String,
    ) -> app::Result<()> {
        self.set_match_context_id_inner(&match_id, &context_id)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::MatchListUpdated {});
        Ok(())
    }

    pub(crate) fn set_match_context_id_inner(
        &mut self,
        match_id: &str,
        context_id: &str,
    ) -> Result<(), GameError> {
        let match_id = match_id.to_string();
        let entry = self
            .matches
            .get(&match_id)
            .map_err(storage)?
            .ok_or(GameError::Invalid("unknown match_id".into()))?;
        // Only the Pending -> Active transition. Re-linking a match would point
        // it at a different game, whose results would then count for it.
        if entry.context_id.is_some() {
            return Err(GameError::Invalid("match not in Pending state".into()));
        }
        // Storage refuses anyone but the creator; saying so here is kinder.
        if !self.matches.owned_by_me(&match_id).map_err(storage)? {
            return Err(GameError::Forbidden(
                "only the match's creator links it".into(),
            ));
        }
        self.matches
            .modify(&match_id, |entry| {
                entry.context_id = Some(context_id.to_string());
            })
            .map_err(storage)?;
        Ok(())
    }

    /// Record the caller's own account -> player key pairing.
    ///
    /// Called when a member opens the lobby. Idempotent: re-registering the
    /// same pair is a no-op write, and it is cheap enough to call on every
    /// open, which is what makes it self-healing for members who joined before
    /// this method existed.
    ///
    /// This is the ONLY way the other nodes ever learn the pairing — see
    /// `PlayerEntry`. The slot is the caller's own, so nobody else can write it.
    pub fn register_player(&mut self) -> app::Result<String> {
        let player_hex = from_executor_id()
            .map_err(|e| AppError::msg(e.to_string()))?
            .to_hex();
        let unchanged = self
            .players
            .get()?
            .is_some_and(|registered| *registered.get() == player_hex);
        if !unchanged {
            let _previous = self.players.insert(LwwRegister::new(player_hex.clone()))?;
            app::emit!(Event::PlayersUpdated {});
        }
        Ok(player_hex)
    }

    /// Every account -> player key pairing recorded so far.
    pub fn get_players(&self) -> app::Result<Vec<PlayerEntry>> {
        Ok(self
            .players
            .entries()?
            .map(|(account, key)| PlayerEntry {
                account: account_hex(account.as_bytes()),
                player: key.get().clone(),
            })
            .collect())
    }

    pub fn get_matches(&self) -> app::Result<Vec<MatchSummary>> {
        let mut out = Vec::new();
        for (match_id, entry) in self.matches.entries()? {
            let result = self.result_of(&match_id, &entry)?;
            out.push(MatchSummary {
                status: match (&result, &entry.context_id) {
                    (Some(_), _) => MatchStatus::Finished,
                    (None, Some(_)) => MatchStatus::Active,
                    (None, None) => MatchStatus::Pending,
                },
                winner: result.map(|r| r.winner),
                match_id,
                player1: entry.player1,
                player2: entry.player2,
                player2_account: entry.player2_account,
                context_id: entry.context_id,
                created_ms: entry.created_ms,
            });
        }
        Ok(out)
    }

    /// A player's record, derived from the results: two index seeks, then one
    /// check per match that the result counts.
    pub fn get_player_stats(&self, player: String) -> app::Result<Option<PlayerStatsView>> {
        let wins = self.counted(&player, "winner")?;
        let losses = self.counted(&player, "loser")?;
        if wins == 0 && losses == 0 {
            return Ok(None);
        }
        Ok(Some(PlayerStatsView {
            wins,
            losses,
            games_played: wins.saturating_add(losses),
        }))
    }

    /// Every finished match, oldest first — one result per match.
    pub fn get_history(&self) -> app::Result<Vec<MatchRecord>> {
        let mut out = Vec::new();
        for (match_id, entry) in self.matches.entries()? {
            if let Some(record) = self.result_of(&match_id, &entry)? {
                out.push(record);
            }
        }
        out.sort_by(|a, b| (a.finished_ms, &a.match_id).cmp(&(b.finished_ms, &b.match_id)));
        Ok(out)
    }

    /// Recorded by the game context when a match ends.
    ///
    /// ⚠️ `#[app::xcall]` is what makes this reachable from another context at
    /// all. Without it the ABI carries no `xcall_callable` for any method and
    /// the node rejects the dispatch as "not an xcall entry point" — which is
    /// how a finished match silently recorded no winner, no history and no
    /// stats. `from_same_app` narrows callers to contexts running this same
    /// application id, enforced by the node — but ANY such context, including
    /// one a member creates to report a match it is not, so the method also
    /// checks the call came from THIS match's game context.
    #[app::xcall(from_same_app)]
    pub fn on_match_finished(
        &mut self,
        match_id: String,
        winner: String,
        loser: String,
    ) -> app::Result<()> {
        let origin = calimero_sdk::env::xcall_origin();
        let now = storage_env::time_now();
        self.on_match_finished_inner(&match_id, &winner, &loser, origin, now)
            .map_err(|e| AppError::msg(e.to_string()))?;
        app::emit!(Event::MatchListUpdated {});
        app::emit!(Event::PlayerStatsUpdated {});
        Ok(())
    }

    pub(crate) fn on_match_finished_inner(
        &mut self,
        match_id: &str,
        winner: &str,
        loser: &str,
        origin: Option<[u8; 32]>,
        finished_ms: u64,
    ) -> Result<(), GameError> {
        let id = match_id.to_string();
        let entry = self
            .matches
            .get(&id)
            .map_err(storage)?
            .ok_or(GameError::Invalid("unknown match_id".into()))?;
        let from_its_game = entry
            .context_id
            .as_deref()
            .and_then(|ctx| hex::decode(ctx).ok())
            .zip(origin)
            .is_some_and(|(linked, origin)| linked == origin);
        if !from_its_game {
            return Err(GameError::Forbidden(
                "a result is reported only by the match's own game context".into(),
            ));
        }
        if !Self::are_the_players(&entry, winner, loser) {
            return Err(GameError::Invalid(
                "winner and loser must be the match's two players".into(),
            ));
        }
        // Idempotent on purpose. xcall dispatch is fire-and-forget, and both
        // players' nodes can report the same decision, so this may be
        // delivered more than once. A repeat writes nothing; and even two
        // rows for one match count once, because stats are derived per match.
        if self
            .result_of(&id, &entry)?
            .is_some_and(|known| known.winner == winner)
        {
            return Ok(());
        }
        let key = (0..16u64)
            .map(|offset| format!("{match_id}/{}", finished_ms.saturating_add(offset)))
            .find(|key| !self.results.contains(key).unwrap_or(true))
            .ok_or(GameError::Invalid(
                "could not find a free slot to write to".into(),
            ))?;
        self.results
            .insert(
                key,
                MatchRecord {
                    match_id: match_id.to_string(),
                    winner: winner.to_string(),
                    loser: loser.to_string(),
                    finished_ms,
                },
            )
            .map_err(storage)?;
        Ok(())
    }
}

impl LobbyState {
    /// The account that registered `player` as its key — exactly one, or the
    /// match cannot say whose rows player 2's are.
    fn account_for(&self, player: &str) -> Result<String, GameError> {
        let accounts: Vec<String> = self
            .players
            .entries()
            .map_err(storage)?
            .filter(|(_, key)| key.get().eq_ignore_ascii_case(player))
            .map(|(account, _)| account_hex(account.as_bytes()))
            .collect();
        match accounts.as_slice() {
            [one] => Ok(one.clone()),
            [] => Err(GameError::Invalid(
                "that player has not opened the lobby yet".into(),
            )),
            _ => Err(GameError::Invalid(
                "more than one member has registered that player key".into(),
            )),
        }
    }

    fn are_the_players(entry: &MatchEntry, winner: &str, loser: &str) -> bool {
        winner != loser
            && [winner, loser]
                .iter()
                .all(|p| *p == entry.player1 || *p == entry.player2)
    }

    /// The result of a match, if one counts.
    ///
    /// A report counts only if it names the match's two players and was
    /// written by one of them — the creator (the entry's owner stamp) or the
    /// player 2 account the entry recorded — which is who a game context's
    /// report runs as. The result stands only if every counting report agrees
    /// on the winner: a player who files a contrary report can dispute a
    /// result, but never take it.
    fn result_of(
        &self,
        match_id: &String,
        entry: &MatchEntry,
    ) -> Result<Option<MatchRecord>, GameError> {
        let creator = self
            .matches
            .owner_of(match_id)
            .map_err(storage)?
            .map(|a| account_hex(a.as_bytes()));
        let mut counting: Vec<MatchRecord> = Vec::new();
        for (key, record) in self
            .results
            .query("match_id")
            .eq(match_id.as_str())
            .entries()
            .map_err(storage)?
        {
            let author = self
                .results
                .owner_of(&key)
                .map_err(storage)?
                .map(|a| account_hex(a.as_bytes()));
            let by_a_player = author.is_some()
                && (author == creator || author.as_deref() == Some(entry.player2_account.as_str()));
            if by_a_player && Self::are_the_players(entry, &record.winner, &record.loser) {
                counting.push(record);
            }
        }
        let winners: BTreeSet<&str> = counting.iter().map(|r| r.winner.as_str()).collect();
        if winners.len() != 1 {
            return Ok(None);
        }
        Ok(counting.into_iter().min_by_key(|r| r.finished_ms))
    }

    /// How many matches `player` is the counted `side` ("winner" / "loser") of.
    fn counted(&self, player: &str, side: &str) -> app::Result<u64> {
        let matches: BTreeSet<String> = self
            .results
            .query(side)
            .eq(player)
            .entries()?
            .into_iter()
            .map(|(_, record)| record.match_id)
            .collect();
        let mut count = 0u64;
        for match_id in matches {
            let Some(entry) = self.matches.get(&match_id)? else {
                continue;
            };
            let counts = self.result_of(&match_id, &entry)?.is_some_and(|r| {
                if side == "winner" {
                    r.winner == player
                } else {
                    r.loser == player
                }
            });
            count += u64::from(counts);
        }
        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use calimero_sdk::testing::TestHost;

    use super::*;

    const ALICE: [u8; 32] = [0xA1; 32];
    const ALICE_KEY: [u8; 32] = [0xA2; 32];
    const BOB: [u8; 32] = [0xB0; 32];
    const BOB_KEY: [u8; 32] = [0xB2; 32];
    const CAROL: [u8; 32] = [0xC0; 32];
    const CAROL_KEY: [u8; 32] = [0xC2; 32];
    const GAME_CTX: [u8; 32] = [0x6A; 32];

    /// A lobby where Alice and Bob have each registered their player key.
    fn lobby() -> TestHost<LobbyState> {
        let mut app = TestHost::new(LobbyState::init);
        for (account, key) in [(ALICE, ALICE_KEY), (BOB, BOB_KEY)] {
            app.call_as_account(account, key, |s| s.register_player())
                .expect("register");
        }
        app
    }

    /// Alice challenges Bob and links the game context.
    fn linked() -> (TestHost<LobbyState>, String) {
        let mut app = lobby();
        let id = app
            .call_as_account(ALICE, ALICE_KEY, |s| s.create_match(hex::encode(BOB_KEY)))
            .expect("create");
        app.call_as_account(ALICE, ALICE_KEY, |s| {
            s.set_match_context_id(id.clone(), hex::encode(GAME_CTX))
        })
        .expect("link");
        (app, id)
    }

    fn report(
        app: &mut TestHost<LobbyState>,
        account: [u8; 32],
        id: &str,
        winner: [u8; 32],
        loser: [u8; 32],
        origin: Option<[u8; 32]>,
    ) -> Result<(), GameError> {
        let (winner, loser) = (hex::encode(winner), hex::encode(loser));
        app.call_as_account(account, account, |s| {
            s.on_match_finished_inner(id, &winner, &loser, origin, 1_000)
        })
    }

    fn summary(app: &TestHost<LobbyState>, id: &str) -> MatchSummary {
        app.view(|s| s.get_matches())
            .expect("matches")
            .into_iter()
            .find(|m| m.match_id == id)
            .expect("match")
    }

    #[test]
    fn create_match_records_both_players_and_player_twos_account() {
        let (app, id) = linked();
        assert!(id.starts_with(&hex::encode(ALICE_KEY)));
        let m = summary(&app, &id);
        assert_eq!(m.player1, hex::encode(ALICE_KEY));
        assert_eq!(m.player2, hex::encode(BOB_KEY));
        assert_eq!(m.player2_account, hex::encode(BOB));
        assert_eq!(m.status, MatchStatus::Active);
        assert_eq!(m.context_id, Some(hex::encode(GAME_CTX)));
    }

    #[test]
    fn create_match_rejects_self_malformed_and_unregistered_opponents() {
        let mut app = lobby();
        let mut create =
            |player2: String| app.call_as_account(ALICE, ALICE_KEY, |s| s.create_match(player2));
        assert!(create(hex::encode(ALICE_KEY)).is_err(), "self");
        assert!(create("zzzz-not-hex-zzzz".into()).is_err(), "malformed");
        assert!(
            create(hex::encode(CAROL_KEY)).is_err(),
            "never opened the lobby"
        );
    }

    #[test]
    fn a_player_key_two_accounts_claim_is_not_matched_to_either() {
        let mut app = lobby();
        // Carol registers Bob's key as hers: she can write only her OWN slot,
        // but that slot can say anything.
        app.call_as_account(CAROL, BOB_KEY, |s| s.register_player())
            .expect("carol registers");
        assert!(app
            .call_as_account(ALICE, ALICE_KEY, |s| s.create_match(hex::encode(BOB_KEY)))
            .is_err());
    }

    #[test]
    fn a_member_can_only_register_their_own_key() {
        let mut app = lobby();
        // Carol, from her own device, can rewrite only her own slot — Bob's
        // pairing is his.
        app.call_as_account(CAROL, CAROL_KEY, |s| s.register_player())
            .expect("carol registers");
        let players = app.view(|s| s.get_players()).expect("players");
        let bob = players
            .iter()
            .find(|p| p.account == hex::encode(BOB))
            .expect("bob");
        assert_eq!(bob.player, hex::encode(BOB_KEY));
        assert_eq!(players.len(), 3);
    }

    #[test]
    fn only_the_creator_links_a_match_and_only_once() {
        let mut app = lobby();
        let id = app
            .call_as_account(ALICE, ALICE_KEY, |s| s.create_match(hex::encode(BOB_KEY)))
            .expect("create");
        assert!(app
            .call_as_account(BOB, BOB_KEY, |s| s
                .set_match_context_id(id.clone(), "ab".into()))
            .is_err());
        app.call_as_account(ALICE, ALICE_KEY, |s| {
            s.set_match_context_id(id.clone(), hex::encode(GAME_CTX))
        })
        .expect("link");
        assert!(app
            .call_as_account(ALICE, ALICE_KEY, |s| s
                .set_match_context_id(id.clone(), "cd".into()))
            .is_err());
    }

    #[test]
    fn a_result_counts_once_and_only_from_the_matchs_own_game() {
        let (mut app, id) = linked();
        // Not from this match's game context, or from no context at all.
        assert!(report(&mut app, BOB, &id, BOB_KEY, ALICE_KEY, Some([0x99; 32])).is_err());
        assert!(report(&mut app, BOB, &id, BOB_KEY, ALICE_KEY, None).is_err());
        // Not naming the match's players.
        assert!(report(&mut app, BOB, &id, CAROL_KEY, ALICE_KEY, Some(GAME_CTX)).is_err());

        report(&mut app, BOB, &id, BOB_KEY, ALICE_KEY, Some(GAME_CTX)).expect("bob's node");
        report(&mut app, ALICE, &id, BOB_KEY, ALICE_KEY, Some(GAME_CTX)).expect("alice's node");

        let m = summary(&app, &id);
        assert_eq!(m.status, MatchStatus::Finished);
        assert_eq!(m.winner, Some(hex::encode(BOB_KEY)));
        let bob = app
            .view(|s| s.get_player_stats(hex::encode(BOB_KEY)))
            .expect("stats")
            .expect("bob has played");
        assert_eq!((bob.wins, bob.losses, bob.games_played), (1, 0, 1));
        let alice = app
            .view(|s| s.get_player_stats(hex::encode(ALICE_KEY)))
            .expect("stats")
            .expect("alice has played");
        assert_eq!((alice.wins, alice.losses), (0, 1));
        assert_eq!(app.view(|s| s.get_history()).expect("history").len(), 1);
    }

    #[test]
    fn a_report_written_by_someone_outside_the_match_does_not_count() {
        let (mut app, id) = linked();
        // Carol writes a result row straight into the map, around the xcall.
        app.call_as_account(CAROL, CAROL_KEY, |s| {
            s.results
                .insert(
                    format!("{id}/1"),
                    MatchRecord {
                        match_id: id.clone(),
                        winner: hex::encode(ALICE_KEY),
                        loser: hex::encode(BOB_KEY),
                        finished_ms: 1,
                    },
                )
                .expect("her own row");
        });
        assert_eq!(summary(&app, &id).status, MatchStatus::Active);
        assert!(app
            .view(|s| s.get_player_stats(hex::encode(ALICE_KEY)))
            .expect("stats")
            .is_none());
    }

    #[test]
    fn a_contrary_report_disputes_a_result_but_cannot_take_it() {
        let (mut app, id) = linked();
        report(&mut app, BOB, &id, BOB_KEY, ALICE_KEY, Some(GAME_CTX)).expect("bob wins");
        // Alice, around the contract, files the opposite result.
        app.call_as_account(ALICE, ALICE_KEY, |s| {
            s.results
                .insert(
                    format!("{id}/2"),
                    MatchRecord {
                        match_id: id.clone(),
                        winner: hex::encode(ALICE_KEY),
                        loser: hex::encode(BOB_KEY),
                        finished_ms: 2,
                    },
                )
                .expect("her own row");
        });
        let m = summary(&app, &id);
        assert_eq!(m.winner, None);
        assert!(app
            .view(|s| s.get_player_stats(hex::encode(ALICE_KEY)))
            .expect("stats")
            .is_none());
    }

    #[test]
    fn a_result_cannot_be_rewritten() {
        let (mut app, id) = linked();
        report(&mut app, BOB, &id, BOB_KEY, ALICE_KEY, Some(GAME_CTX)).expect("bob wins");
        let key = app.view(|s| s.results.entries().expect("rows").next().expect("row").0);
        let rewritten = app.call_as_account(BOB, BOB, |s| {
            s.results.insert(
                key.clone(),
                MatchRecord {
                    match_id: id.clone(),
                    winner: hex::encode(ALICE_KEY),
                    loser: hex::encode(BOB_KEY),
                    finished_ms: 3,
                },
            )
        });
        assert!(rewritten.is_err());
        assert_eq!(summary(&app, &id).winner, Some(hex::encode(BOB_KEY)));
    }

    #[test]
    fn init_populates_created_ms() {
        let app = TestHost::new(LobbyState::init);
        assert!(app.view(|s| *s.created_ms.get().expect("created")) > 0);
    }
}
