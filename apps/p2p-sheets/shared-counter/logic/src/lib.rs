#![allow(clippy::len_without_is_empty)]

use calimero_sdk::app;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::Serialize;
use calimero_storage::collections::{LwwRegister, UnorderedMap};
use thiserror::Error;

const COUNTER_KEY: &str = "counter";

#[app::state(emits = Event)]
#[derive(Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct AppState {
    items: UnorderedMap<String, LwwRegister<String>>,
}

#[app::event]
pub enum Event {
    Incremented { value: i64 },
    Decremented { value: i64 },
}

#[derive(Debug, Error, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
#[serde(tag = "kind", content = "data")]
pub enum Error {
    #[error("counter value is invalid")]
    InvalidValue,
}

#[app::logic]
impl AppState {
    #[app::init]
    pub fn init() -> AppState {
        AppState {
            items: UnorderedMap::new(),
        }
    }

    fn current_value(&self) -> app::Result<i64> {
        Ok(self
            .items
            .get(COUNTER_KEY)?
            .map(|v| v.get().parse::<i64>().unwrap_or(0))
            .unwrap_or(0))
    }

    pub fn increment(&mut self) -> app::Result<i64> {
        app::log!("Incrementing counter");

        let value = self.current_value()? + 1;
        self.items
            .insert(COUNTER_KEY.to_string(), value.to_string().into())?;
        app::emit!(Event::Incremented { value });

        Ok(value)
    }

    pub fn decrement(&mut self) -> app::Result<i64> {
        app::log!("Decrementing counter");

        let value = self.current_value()? - 1;
        self.items
            .insert(COUNTER_KEY.to_string(), value.to_string().into())?;
        app::emit!(Event::Decremented { value });

        Ok(value)
    }

    pub fn get_value(&self) -> app::Result<i64> {
        app::log!("Getting counter value");

        self.current_value()
    }
}
