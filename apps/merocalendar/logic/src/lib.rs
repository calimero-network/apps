use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use calimero_sdk::borsh::{BorshDeserialize, BorshSerialize};
use calimero_sdk::serde::{Deserialize, Serialize};
use calimero_sdk::types::Error as SdkError;
use calimero_sdk::{app, env};
use calimero_storage::collections::UnorderedMap;

#[app::event]
pub enum Event {
    CalendarEventCreated(String),
    CalendarEventEdited(String),
    CalendarEventDeleted(String),
}

#[app::state(emits = Event)]
#[derive(Debug, PartialEq, PartialOrd, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "calimero_sdk::borsh")]
pub struct Calendar {
    // Key is event.id and the value is event
    events: UnorderedMap<String, CalendarEvent>,
}

#[derive(
    Clone, Debug, PartialEq, PartialOrd, BorshSerialize, BorshDeserialize, Serialize, Deserialize,
)]
#[borsh(crate = "calimero_sdk::borsh")]
#[serde(crate = "calimero_sdk::serde")]
pub struct CalendarEvent {
    id: String,
    title: String,
    description: String,
    owner: String,
    start: String,
    end: String,
    event_type: String,
    color: String,
    peers: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct CreateCalendarEvent {
    title: String,
    description: String,
    owner: String,
    start: String,
    end: String,
    event_type: String,
    color: String,
    peers: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct UpdateCalendarEvent {
    title: Option<String>,
    description: Option<String>,
    owner: Option<String>,
    start: Option<String>,
    end: Option<String>,
    event_type: Option<String>,
    color: Option<String>,
    peers: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
pub enum Error {
    AppError(AppError),
    SdkError(SdkError),
}

#[derive(Debug, Serialize)]
#[serde(crate = "calimero_sdk::serde")]
pub struct AppError {
    message: String,
}

#[app::logic]
impl Calendar {
    #[app::init]
    pub fn init() -> Calendar {
        Calendar {
            events: UnorderedMap::new(),
        }
    }

    pub fn get_events(&self) -> Result<Vec<CalendarEvent>, AppError> {
        let mut all_events = Vec::new();
        let entries = match self.events.entries() {
            Ok(entries) => entries,
            Err(err) => {
                return Err(AppError {
                    message: err.to_string(),
                });
            }
        };

        for (_id, event) in entries {
            all_events.push(event);
        }

        Ok(all_events)
    }

    pub fn create_event(&mut self, event_data: CreateCalendarEvent) -> Result<String, AppError> {
        env::log(&format!("Creating calendar event {:?}", event_data));

        let mut buffer = [0u8; 16];
        env::random_bytes(&mut buffer);
        let id = STANDARD.encode(&buffer);

        let event = CalendarEvent {
            id: id.clone(),
            title: event_data.title,
            description: event_data.description,
            owner: event_data.owner,
            start: event_data.start,
            end: event_data.end,
            event_type: event_data.event_type,
            color: event_data.color,
            peers: event_data.peers,
        };

        if let Err(err) = self.events.insert(id.clone(), event) {
            return Err(AppError {
                message: err.to_string(),
            });
        }

        app::emit!(Event::CalendarEventCreated(id.clone()));

        Ok(id)
    }

    pub fn update_event(
        &mut self,
        event_id: String,
        event_data: UpdateCalendarEvent,
    ) -> Result<String, AppError> {
        env::log(&format!(
            "Updating calendar event {} with {:?}",
            event_id, event_data
        ));

        let mut event = match self.events.get(&event_id) {
            Ok(event) => match event {
                Some(event) => event,
                None => {
                    return Err(AppError {
                        message: format!("Event with {} id doesn't exist", event_id).to_owned(),
                    });
                }
            },
            Err(err) => {
                return Err(AppError {
                    message: err.to_string(),
                })
            }
        };

        if let Some(data) = event_data.title {
            event.title = data
        }
        if let Some(data) = event_data.description {
            event.description = data
        }
        if let Some(data) = event_data.owner {
            event.owner = data
        }
        if let Some(data) = event_data.start {
            event.start = data
        }
        if let Some(data) = event_data.end {
            event.end = data
        }
        if let Some(data) = event_data.event_type {
            event.event_type = data
        }
        if let Some(data) = event_data.color {
            event.color = data
        }
        if let Some(data) = event_data.peers {
            event.peers = data
        }

        if let Err(err) = self.events.insert(event_id.clone(), event) {
            return Err(AppError {
                message: err.to_string(),
            });
        }

        app::emit!(Event::CalendarEventCreated(event_id.clone()));

        Ok(event_id)
    }

    pub fn delete_event(&mut self, event_id: String) -> Result<String, AppError> {
        env::log(&format!("Deleting calendar event {}", event_id));

        match self.events.remove(&event_id) {
            Ok(old) => {
                if old.is_none() {
                    return Err(AppError {
                        message: format!("Event with {} id doesn't exist", event_id).to_owned(),
                    });
                }
            }
            Err(err) => {
                return Err(AppError {
                    message: err.to_string(),
                })
            }
        }

        Ok(event_id)
    }
}
