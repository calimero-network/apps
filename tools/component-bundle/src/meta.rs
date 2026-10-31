//! `[package.metadata.calimero]` of a component app, read the way `cargo mero`
//! reads it for a v1 app: the same kebab-case keys, so an app keeps its table
//! when it moves to the component SDK.

use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use eyre::{bail, eyre, Result, WrapErr};
use serde::Deserialize;

/// The crate a component app is, with its bundle metadata.
#[derive(Debug, Clone)]
pub struct App {
    /// The crate's directory (the one holding `Cargo.toml`).
    pub dir: PathBuf,
    /// The cargo package name (`kv-store`).
    pub crate_name: String,
    /// The cargo version, the app version when none is given.
    pub crate_version: String,
    /// The `calimero-app-sdk` dependency's git source and tag, when it names one.
    pub sdk: Option<SdkSource>,
    pub meta: Meta,
}

/// Where `calimero-app-sdk` comes from: written into the manifest's `buildInfo`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SdkSource {
    pub git: String,
    pub tag: Option<String>,
}

/// `[package.metadata.calimero]`. `deny_unknown_fields` turns a snake_case typo
/// into an error instead of a field silently left out of the manifest.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "kebab-case", deny_unknown_fields)]
pub struct Meta {
    pub package: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    /// A PNG path relative to the crate, or `"default"` (no icon: cargo-mero's
    /// built-in mark is not reachable from here), or absent.
    pub icon: Option<String>,
    /// A Markdown file relative to the crate; its text goes into the manifest.
    pub guide: Option<String>,
    pub slug: Option<String>,
    pub license: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub github: Option<String>,
    pub docs: Option<String>,
    pub min_runtime_version: Option<String>,
    pub frontend: Option<String>,
    #[serde(default)]
    pub frontend_aliases: Vec<String>,
    #[serde(default)]
    pub outbound: Vec<String>,
    pub upgrades: Option<calimero_bundle::UpgradeAuthority>,
    /// A built frontend, relative to the crate, packed into the bundle.
    pub frontend_dir: Option<String>,
    /// Multi-service bundles are not supported for component apps yet; the key is
    /// accepted only so the error can say so.
    #[serde(default)]
    pub services: Vec<toml::Value>,
}

#[derive(Deserialize)]
struct Manifest {
    package: Package,
    #[serde(default)]
    dependencies: toml::Table,
}

#[derive(Deserialize)]
struct Package {
    name: String,
    #[serde(default)]
    version: Option<toml::Value>,
    #[serde(default)]
    metadata: Option<toml::Table>,
}

impl App {
    /// Reads `dir/Cargo.toml`. `dir` is made absolute: the builder runs cargo
    /// inside the crate, where a relative path would mean something else.
    pub fn load(dir: &Path) -> Result<Self> {
        let dir =
            &fs::canonicalize(dir).wrap_err_with(|| format!("{} does not exist", dir.display()))?;
        let path = dir.join("Cargo.toml");
        let text =
            fs::read_to_string(&path).wrap_err_with(|| format!("reading {}", path.display()))?;
        Self::parse(dir, &text).wrap_err_with(|| format!("in {}", path.display()))
    }

    /// Parses a `Cargo.toml` whose crate lives in `dir`.
    pub fn parse(dir: &Path, text: &str) -> Result<Self> {
        let manifest: Manifest = toml::from_str(text)?;
        let sdk = manifest
            .dependencies
            .get("calimero-app-sdk")
            .ok_or_else(|| eyre!("not a component app: no `calimero-app-sdk` dependency"))?;
        let sdk = sdk.as_table().and_then(|t| {
            Some(SdkSource {
                git: t.get("git")?.as_str()?.to_owned(),
                tag: t
                    .get("tag")
                    .and_then(toml::Value::as_str)
                    .map(str::to_owned),
            })
        });
        let table = manifest
            .package
            .metadata
            .as_ref()
            .and_then(|m| m.get("calimero"))
            .cloned()
            .ok_or_else(|| {
                eyre!(
                    "no [package.metadata.calimero] table; add one with a reverse-DNS app id:\n\n\
                     [package.metadata.calimero]\npackage = \"com.example.my-app\""
                )
            })?;
        let meta: Meta = table.try_into().wrap_err("[package.metadata.calimero]")?;
        if !meta.services.is_empty() {
            bail!("`services` (multi-service bundles) is not supported for component apps yet");
        }
        validate_package_id(&meta.package)?;
        // A `version.workspace = true` cannot apply to a standalone crate, so a
        // version is a plain string here (or absent: then `--app-version`).
        let crate_version = match manifest.package.version {
            Some(toml::Value::String(v)) => v,
            _ => String::new(),
        };
        Ok(Self {
            dir: dir.to_owned(),
            crate_name: manifest.package.name,
            crate_version,
            sdk,
            meta,
        })
    }

    /// `name` with `-` as `_`: the file cargo writes for this crate.
    pub fn lib_name(&self) -> String {
        self.crate_name.replace('-', "_")
    }

    /// The icon as the `data:` URI the manifest carries, if any.
    pub fn icon(&self) -> Result<Option<String>> {
        match self.meta.icon.as_deref() {
            None => Ok(None),
            Some("default") => {
                eprintln!(
                    "warning: icon = \"default\" names cargo-mero's built-in mark, which this tool \
                     does not carry; the bundle ships without an icon"
                );
                Ok(None)
            }
            Some(rel) => {
                let path = self.dir.join(rel);
                let bytes =
                    fs::read(&path).wrap_err_with(|| format!("reading icon {}", path.display()))?;
                if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    bail!("icon {} is not a PNG", path.display());
                }
                Ok(Some(format!(
                    "data:image/png;base64,{}",
                    STANDARD.encode(bytes)
                )))
            }
        }
    }

    /// The guide's text, if a guide is configured.
    pub fn guide(&self) -> Result<Option<String>> {
        self.meta
            .guide
            .as_deref()
            .map(|rel| {
                let path = self.dir.join(rel);
                fs::read_to_string(&path)
                    .wrap_err_with(|| format!("reading guide {}", path.display()))
            })
            .transpose()
    }

    /// `frontend-dir`, resolved against the crate.
    pub fn frontend_dir(&self) -> Option<PathBuf> {
        self.meta.frontend_dir.as_deref().map(|d| self.dir.join(d))
    }
}

/// A reverse-DNS id: at least two dot-separated labels of `[a-z0-9-]`.
pub fn validate_package_id(id: &str) -> Result<()> {
    let labels: Vec<&str> = id.split('.').collect();
    let ok = labels.len() >= 2
        && labels.iter().all(|l| {
            !l.is_empty()
                && l.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        });
    if !ok {
        bail!("package `{id}` is not a reverse-DNS id like `com.example.my-app`");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const APP: &str = r#"
[package]
name = "kv-store"
version = "0.1.0"

[dependencies]
calimero-app-sdk = { git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.7" }

[package.metadata.calimero]
package = "com.calimero.kv-store"
name = "KV Store"
tags = ["example"]
frontend = "https://mero-kv-store.vercel.app"
frontend-dir = "../app/dist"
"#;

    #[test]
    fn reads_the_calimero_table_and_the_sdk_source() {
        let app = App::parse(Path::new("/x/logic"), APP).expect("parse");
        assert_eq!(app.crate_name, "kv-store");
        assert_eq!(app.lib_name(), "kv_store");
        assert_eq!(app.crate_version, "0.1.0");
        assert_eq!(app.meta.package, "com.calimero.kv-store");
        assert_eq!(app.meta.tags, ["example"]);
        assert_eq!(
            app.sdk,
            Some(SdkSource {
                git: "https://github.com/calimero-network/core".into(),
                tag: Some("1.0.0-rc.7".into()),
            })
        );
        assert_eq!(
            app.frontend_dir(),
            Some(PathBuf::from("/x/logic/../app/dist"))
        );
    }

    #[test]
    fn refuses_a_v1_crate() {
        let v1 = APP.replace("calimero-app-sdk", "calimero-sdk");
        let err = App::parse(Path::new("."), &v1).unwrap_err();
        assert!(
            format!("{err:#}").contains("not a component app"),
            "{err:#}"
        );
    }

    #[test]
    fn refuses_an_unknown_key() {
        let typo = APP.replace("frontend-dir", "frontend_dir");
        assert!(App::parse(Path::new("."), &typo).is_err());
    }

    #[test]
    fn refuses_a_bad_package_id() {
        for id in ["kv", "Com.Example.App", "com..app", "com.ex ample.app"] {
            assert!(validate_package_id(id).is_err(), "{id}");
        }
        validate_package_id("com.calimero.kv-store").expect("valid");
    }
}
