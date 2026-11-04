//! A typed reference to one of the app's blobs, stored exactly as core's
//! `calimero_sdk::BlobRef` stores one.
//!
//! Core's component runtime (#4815, after `1.0.0-rc.7`) keeps a component's blob
//! for as long as a stored value refers to it, plus one hour after its upload or
//! its last reference, and finds those references by their CBOR encoding: tag
//! 51,739 (`0xCA1B`) around the blob's 32-byte SHA-256. The SDK at the pinned
//! tag has no `BlobRef` yet, so this module writes the same bytes itself:
//!
//! * a node with #4815 counts every mesh, texture and version row here as a
//!   reference and keeps its blob (and refuses a reference to a blob the app
//!   does not hold, `HostDenied`);
//! * a node without it stores the tagged bytes like any other value;
//! * when `component-core-tag` moves past #4815, `use calimero_sdk::BlobRef`
//!   replaces this module with no change to stored state or to the wire.
//!
//! In JSON (arguments, results, events) a reference is the blob id: 64
//! lowercase hex digits, what an upload answers as `id`.

use std::fmt;

use ciborium::tag::Required;
use ciborium::Value;
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The CBOR tag of a blob reference in a stored value (core's `BLOB_REF_TAG`).
pub const BLOB_REF_TAG: u64 = 0xCA1B;

/// A reference to one of the app's blobs: its SHA-256.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct BlobRef([u8; 32]);

impl BlobRef {
    /// The reference to blob `id`: 64 lowercase hex digits. None for anything else.
    #[must_use]
    pub fn parse(id: &str) -> Option<Self> {
        if id.len() != 64 || !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return None;
        }
        let mut out = [0_u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(id.get(2 * i..2 * i + 2)?, 16).ok()?;
        }
        Some(Self(out))
    }

    /// The blob id: 64 lowercase hex digits.
    #[must_use]
    pub fn id(&self) -> String {
        use std::fmt::Write as _;
        self.0.iter().fold(String::with_capacity(64), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
    }
}

impl fmt::Debug for BlobRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BlobRef({})", self.id())
    }
}

impl Serialize for BlobRef {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        if s.is_human_readable() {
            return s.serialize_str(&self.id());
        }
        Required::<Value, BLOB_REF_TAG>(Value::Bytes(self.0.to_vec())).serialize(s)
    }
}

impl<'de> Deserialize<'de> for BlobRef {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        if d.is_human_readable() {
            let id = String::deserialize(d)?;
            return Self::parse(&id).ok_or_else(|| D::Error::custom("not a blob id"));
        }
        let Required(value) = Required::<Value, BLOB_REF_TAG>::deserialize(d)?;
        match value {
            Value::Bytes(b) => <[u8; 32]>::try_from(b.as_slice())
                .map(Self)
                .map_err(|_| D::Error::custom("a blob reference holds 32 bytes")),
            _ => Err(D::Error::custom("a blob reference holds a byte string")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bytes core's host looks for (`calimero_app_host::blobs::REF_HEAD`), in
    /// the encoding the SDK stores values with.
    #[test]
    fn a_ref_is_cores_tagged_byte_string_in_cbor_and_hex_in_json() {
        let r = BlobRef([0xAB; 32]);
        let cbor = calimero_sdk::encoding::value::to_vec(&r).unwrap();
        assert_eq!(&cbor[..5], &[0xD9, 0xCA, 0x1B, 0x58, 0x20]);
        assert_eq!(
            calimero_sdk::encoding::value::from_slice::<BlobRef>(&cbor).unwrap(),
            r
        );
        let id = "ab".repeat(32);
        assert_eq!(BlobRef::parse(&id), Some(r));
        assert_eq!(r.id(), id);
        assert_eq!(BlobRef::parse(&"AB".repeat(32)), None);
        assert_eq!(BlobRef::parse("ab"), None);
    }
}
