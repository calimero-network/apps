use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};

#[app::state]
#[derive(Default, BorshDeserialize, BorshSerialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct MeroDocsState {
    // Application state will be added here
}

#[app::event]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub enum MeroDocsEvent {
    // Events will be added here
    Placeholder,
}

#[app::logic]
impl MeroDocsState {
    #[app::init]
    pub fn init() -> MeroDocsState {
        MeroDocsState::default()
    }

    // Application methods will be added here
}
