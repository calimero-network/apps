//! A component app's `.mpk`: `manifest.json` (signed), `app.wasm` (the
//! `calimero:app` component) and, when the app ships one, its built frontend
//! under `frontend/`. The layout and the manifest are `cargo mero bundle`'s for
//! a single-service v1 app, so the node and the registry read both the same way.
//!
//! No `abi` artifact: a component carries its ABI in its own `calimero:abi`
//! section, which is what the node reads, and the manifest's `abi` is the v1
//! (wasmer) ABI used for migrations, which the component runtime does not have
//! yet.

use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use calimero_bundle::{
    verify_frontend_file, BundleArtifact, BundleBuildInfo, BundleFrontend, BundleHandlers,
    BundleLinks, BundleManifest, BundleMetadata, FRONTEND_ROOT, MAX_FRONTEND_BYTES,
    MAX_MANIFEST_BYTES,
};
use eyre::{bail, eyre, Result, WrapErr};
use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};

use crate::meta::App;

/// The manifest schema `cargo mero` writes.
const MANIFEST_VERSION: &str = "1.0";
/// The page a node serves at the app's root.
const ENTRY: &str = "frontend/index.html";
/// The single service's wasm, where a v1 single-service bundle keeps it.
const WASM: &str = "app.wasm";

/// A frontend directory, checked, with the exact bytes each entry was hashed from.
pub struct Frontend {
    pub frontend: BundleFrontend,
    pub contents: Vec<Vec<u8>>,
}

/// What to pack.
pub struct Inputs<'a> {
    pub app: &'a App,
    pub component: &'a [u8],
    pub app_version: &'a str,
    pub min_runtime_version: &'a str,
    pub frontend: Option<&'a Frontend>,
}

/// `{path, hash, size}` for `bytes`; the node checks the bytes against `hash`.
pub fn artifact(path: impl Into<String>, bytes: &[u8]) -> BundleArtifact {
    BundleArtifact {
        path: path.into(),
        hash: hex(&Sha256::digest(bytes)),
        size: bytes.len() as u64,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Walks a built frontend (dot-entries and source maps left out), with the node's
/// own per-file checks, so a bad build fails here rather than at install.
pub fn collect_frontend(dir: &Path) -> Result<Frontend> {
    if !dir.is_dir() {
        bail!(
            "frontend directory {} does not exist; build the frontend first (pnpm -F <app> build)",
            dir.display()
        );
    }
    let mut found = Vec::new();
    walk(dir, FRONTEND_ROOT.trim_end_matches('/'), &mut found)?;
    found.sort_by(|a, b| a.1.cmp(&b.1));
    let mut files = Vec::with_capacity(found.len());
    let mut contents = Vec::with_capacity(found.len());
    let mut total = 0u64;
    for (source, rel) in found {
        let bytes = fs::read(&source).wrap_err_with(|| format!("reading {}", source.display()))?;
        total += bytes.len() as u64;
        files.push(artifact(rel, &bytes));
        contents.push(bytes);
    }
    if total > MAX_FRONTEND_BYTES {
        bail!("the frontend is {total} bytes; a bundle carries at most {MAX_FRONTEND_BYTES}");
    }
    let frontend = BundleFrontend {
        entry: ENTRY.to_owned(),
        files,
    };
    frontend.validate()?;
    for (file, bytes) in frontend.files.iter().zip(&contents) {
        verify_frontend_file(file, bytes)?;
    }
    Ok(Frontend { frontend, contents })
}

fn walk(dir: &Path, rel: &str, out: &mut Vec<(PathBuf, String)>) -> Result<()> {
    for entry in fs::read_dir(dir).wrap_err_with(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|n| eyre!("{} is not UTF-8", n.to_string_lossy()))?;
        if name.starts_with('.') {
            continue;
        }
        let rel = format!("{rel}/{name}");
        // `symlink_metadata`: a link could point outside the build.
        let meta = entry.path().symlink_metadata()?;
        if meta.is_dir() {
            walk(&entry.path(), &rel, out)?;
        } else if meta.is_file() {
            if !rel.ends_with(".map") {
                out.push((entry.path(), rel));
            }
        } else {
            bail!(
                "{} is neither a file nor a directory",
                entry.path().display()
            );
        }
    }
    Ok(())
}

/// The unsigned manifest for `inputs`.
pub fn manifest(inputs: &Inputs<'_>) -> Result<BundleManifest> {
    let meta = &inputs.app.meta;
    Ok(BundleManifest {
        version: MANIFEST_VERSION.to_owned(),
        package: meta.package.clone(),
        app_version: inputs.app_version.to_owned(),
        signer_id: None,
        min_runtime_version: inputs.min_runtime_version.to_owned(),
        metadata: meta
            .name
            .clone()
            .map(|name| -> Result<BundleMetadata> {
                Ok(BundleMetadata {
                    name,
                    description: meta.description.clone(),
                    author: meta.author.clone(),
                    icon: inputs.app.icon()?,
                    tags: meta.tags.clone(),
                    license: meta.license.clone(),
                    category: meta.category.clone(),
                    guide: inputs.app.guide()?,
                })
            })
            .transpose()?,
        // The deep-link slug, defaulting to the package, as cargo-mero does.
        handlers: Some(BundleHandlers {
            slug: Some(meta.slug.clone().unwrap_or_else(|| meta.package.clone())),
        }),
        build_info: inputs.app.sdk.as_ref().map(|sdk| BundleBuildInfo {
            sdk_source: Some(sdk.git.clone()),
            sdk_version: sdk.tag.clone(),
            sdk_rev: None,
        }),
        interfaces: None,
        wasm: Some(artifact(WASM, inputs.component)),
        abi: None,
        services: None,
        frontend: inputs.frontend.map(|f| f.frontend.clone()),
        links: Some(BundleLinks {
            frontend: meta.frontend.clone(),
            github: meta.github.clone(),
            docs: meta.docs.clone(),
        }),
        frontend_aliases: meta.frontend_aliases.clone(),
        outbound: meta.outbound.clone(),
        upgrades: meta.upgrades,
        signature: None,
    })
}

/// Signs `manifest` with `key` and writes the `.mpk` to `output`; returns the signer id.
pub fn write(
    output: &Path,
    manifest: &BundleManifest,
    component: &[u8],
    frontend: Option<&Frontend>,
    key: &ed25519_dalek::SigningKey,
) -> Result<String> {
    let mut value = serde_json::to_value(manifest)?;
    let signer_id =
        calimero_bundle::sign_manifest_json(&mut value, key).wrap_err("signing the manifest")?;
    let manifest_bytes = serde_json::to_vec_pretty(&value)?;
    if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
        bail!(
            "manifest.json is {} bytes; a node refuses more than {MAX_MANIFEST_BYTES} (a large icon or guide?)",
            manifest_bytes.len()
        );
    }

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).wrap_err_with(|| format!("creating {}", parent.display()))?;
    }
    let file = File::create(output).wrap_err_with(|| format!("creating {}", output.display()))?;
    let mut tar = tar::Builder::new(GzEncoder::new(file, Compression::default()));
    // First: the node's manifest scan runs before any signature check and stops
    // a few MiB in.
    append(&mut tar, "manifest.json", &manifest_bytes)?;
    append(&mut tar, WASM, component)?;
    for (file, bytes) in frontend
        .iter()
        .flat_map(|f| f.frontend.files.iter().zip(&f.contents))
    {
        append(&mut tar, &file.path, bytes)?;
    }
    tar.into_inner()
        .wrap_err("finishing the archive")?
        .finish()
        .wrap_err("finishing the gzip stream")?;
    Ok(signer_id)
}

fn append<W: std::io::Write>(tar: &mut tar::Builder<W>, path: &str, bytes: &[u8]) -> Result<()> {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, path, bytes)
        .wrap_err_with(|| format!("adding {path} to the bundle"))
}

/// Every member of a `.mpk`, by path: for tests and `mero-component inspect`.
pub fn members(mpk: &Path) -> Result<Vec<(String, Vec<u8>)>> {
    let file = File::open(mpk).wrap_err_with(|| format!("opening {}", mpk.display()))?;
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(file));
    let mut out = Vec::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?.to_string_lossy().into_owned();
        let mut bytes = Vec::new();
        let _ = entry.read_to_end(&mut bytes)?;
        out.push((path, bytes));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(dir: &Path) -> App {
        App::parse(
            dir,
            r#"
[package]
name = "demo"
version = "0.1.0"
[dependencies]
calimero-app-sdk = { git = "https://github.com/calimero-network/core", tag = "1.0.0-rc.7" }
[package.metadata.calimero]
package = "com.example.demo"
name = "Demo"
frontend = "https://demo.example.com"
"#,
        )
        .expect("app")
    }

    #[test]
    fn packs_a_signed_bundle_the_node_can_verify() {
        let dir = tempfile::tempdir().expect("tempdir");
        let site = dir.path().join("dist");
        fs::create_dir_all(site.join("assets")).expect("mkdir");
        fs::write(
            site.join("index.html"),
            "<!doctype html><html><head><script type=\"module\" src=\"./assets/a.js\"></script></head><body></body></html>",
        )
        .expect("write");
        fs::write(site.join("assets/a.js"), "console.log(1)").expect("write");
        fs::write(site.join("assets/a.js.map"), "{}").expect("write");
        fs::write(site.join(".DS_Store"), "x").expect("write");

        let app = app(dir.path());
        let frontend = collect_frontend(&site).expect("frontend");
        let paths: Vec<&str> = frontend
            .frontend
            .files
            .iter()
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(paths, ["frontend/assets/a.js", "frontend/index.html"]);

        // Not a real component: packing does not look inside the wasm.
        let component = b"\0asm\x0d\0\x01\0";
        let inputs = Inputs {
            app: &app,
            component,
            app_version: "0.1.0",
            min_runtime_version: "1.0.0-rc.7",
            frontend: Some(&frontend),
        };
        let manifest = manifest(&inputs).expect("manifest");
        let out = dir.path().join("demo.mpk");
        let signer = write(
            &out,
            &manifest,
            component,
            Some(&frontend),
            &mero_sign::dev_signing_key(),
        )
        .expect("write");
        assert_eq!(signer, mero_sign::dev_signer_id());

        let members = members(&out).expect("members");
        let names: Vec<&str> = members.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(
            names,
            [
                "manifest.json",
                "app.wasm",
                "frontend/assets/a.js",
                "frontend/index.html"
            ]
        );
        let manifest: serde_json::Value =
            serde_json::from_slice(&members[0].1).expect("manifest json");
        calimero_bundle::verify_manifest_signature(&manifest).expect("signature verifies");
        assert_eq!(manifest["package"], "com.example.demo");
        assert_eq!(manifest["minRuntimeVersion"], "1.0.0-rc.7");
        assert_eq!(manifest["wasm"]["path"], "app.wasm");
        assert_eq!(manifest["wasm"]["hash"], hex(&Sha256::digest(component)));
        assert_eq!(manifest["handlers"]["slug"], "com.example.demo");
        assert_eq!(manifest["buildInfo"]["sdkVersion"], "1.0.0-rc.7");
        assert!(manifest.get("abi").is_none());
        // The node's own reader takes it.
        let typed: BundleManifest = serde_json::from_value(manifest).expect("typed");
        assert_eq!(typed.wasm_artifacts().len(), 1);

        // And the check a node runs at install (`VerifiedBundle::open`): the
        // signature, then every artifact against its signed digest.
        let data: std::sync::Arc<[u8]> = fs::read(&out).expect("read").into();
        let rc7 = semver::Version::parse("1.0.0-rc.7").expect("version");
        let verified =
            calimero_bundle::VerifiedBundle::open(data.clone(), &rc7).expect("a node opens it");
        let contents = verified.contents().expect("digests match");
        assert_eq!(contents.wasm.len(), 1);
        assert_eq!(&*contents.wasm[0].bytes, component);
        assert_eq!(contents.frontend.len(), 2);
        // A node older than the declared minRuntimeVersion refuses it.
        let rc6 = semver::Version::parse("1.0.0-rc.6").expect("version");
        assert!(calimero_bundle::VerifiedBundle::open(data, &rc6).is_err());
    }

    #[test]
    fn refuses_a_frontend_without_an_index() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("app.js"), "1").expect("write");
        assert!(collect_frontend(dir.path()).is_err());
    }
}
