//! Calimero Home: the component its package has to hold.
//!
//! Home keeps no state. Everything it shows and changes is the organization's:
//! its people and roles, its app teams (one per installed app), the invites
//! naming them and their default capabilities, all through core's org routes
//! from the frontend (mero-js `CalimeroClient`). A package carries a
//! `calimero:app` component, so this one answers what it is and nothing else.

use calimero_sdk::prelude::*;

/// What `about` answers: the app and the version of this contract.
const ABOUT: &str = concat!("Calimero Home ", env!("CARGO_PKG_VERSION"));

/// No state: Home is the organization's routes, read by the frontend.
#[app::state(version = 1)]
pub struct Home {}

#[app::logic]
impl Home {
    /// Nothing to set up. The node runs it once, when an instance is created.
    #[app::init]
    pub fn init() -> app::Result<Self> {
        Ok(Self::load())
    }

    /// The app and this contract's version: "Calimero Home 0.0.1".
    #[app::view]
    pub fn about(&self) -> app::Result<String> {
        Ok(ABOUT.to_owned())
    }
}
