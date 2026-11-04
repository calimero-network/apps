//! `mero-component`: build a component app (`calimero-sdk`, `wasm32-wasip2`)
//! and pack it into a signed `.mpk`.
//!
//! ```text
//! mero-component build  apps/kv-store/logic            # res/kv_store.wasm + res/abi.json
//! mero-component bundle apps/kv-store/logic --dev      # dist/com.calimero.kv-store-<v>.mpk
//! mero-component abi    apps/kv-store/logic/res/kv_store.wasm
//! mero-component inspect apps/kv-store/logic/dist/com.calimero.kv-store-0.1.0.mpk
//! ```
//!
//! `build` is core's `calimero-app-build` (the builder `mero-app-build` and the
//! SDK's own test harness use): `cargo build --release --target wasm32-wasip2`,
//! then the `calimero:abi` section lifted to the component's top level, where
//! the node reads it. `bundle` writes what `cargo mero bundle` writes for a
//! single-service v1 app, from the same `[package.metadata.calimero]` table.

mod bundle;
mod meta;

use std::fs;
use std::path::{Path, PathBuf};

use clap::{Parser, Subcommand};
use eyre::{bail, Result, WrapErr};

use crate::meta::App;

#[derive(Parser)]
#[command(name = "mero-component", version, about)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Build the crate into a `calimero:app` component: `<crate>/res/<lib>.wasm`
    /// and its ABI as `<crate>/res/abi.json`.
    Build {
        /// The app's crate (the directory holding its Cargo.toml).
        crate_dir: PathBuf,
        /// Where to write the wasm and abi.json (default `<crate>/res`).
        #[arg(long)]
        out_dir: Option<PathBuf>,
    },
    /// Build, then pack a signed `.mpk`.
    Bundle {
        crate_dir: PathBuf,
        /// Sign with the well-known development key: fine on `merod local`,
        /// refused by the registry.
        #[arg(long, conflicts_with = "key")]
        dev: bool,
        /// Sign with a production key file (`cargo mero key generate`). Also read
        /// from `MERO_SIGN_KEY`.
        #[arg(long, env = "MERO_SIGN_KEY")]
        key: Option<PathBuf>,
        /// The release's version (default: the crate's `version`).
        #[arg(long)]
        app_version: Option<String>,
        /// Override `min-runtime-version` from the metadata table.
        #[arg(long)]
        min_runtime_version: Option<String>,
        /// A built frontend to pack (default: `frontend-dir` from the metadata).
        #[arg(long, conflicts_with = "no_frontend")]
        frontend_dir: Option<PathBuf>,
        /// Ship no frontend even when `frontend-dir` is set.
        #[arg(long)]
        no_frontend: bool,
        /// Use this component instead of building one (e.g. CI's build artifact).
        #[arg(long)]
        wasm: Option<PathBuf>,
        /// Where to write the bundle (default `<crate>/dist/<package>-<version>.mpk`).
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Print a component's ABI (the `calimero:abi` section) as JSON.
    Abi { wasm: PathBuf },
    /// List a `.mpk`'s files and print its manifest, after checking its signature.
    Inspect { mpk: PathBuf },
}

fn main() -> Result<()> {
    match Cli::parse().cmd {
        Cmd::Build { crate_dir, out_dir } => {
            let app = App::load(&crate_dir)?;
            let out_dir = out_dir.unwrap_or_else(|| crate_dir.join("res"));
            let wasm = build(&app, &out_dir)?;
            println!("{}", wasm.display());
        }
        Cmd::Bundle {
            crate_dir,
            dev,
            key,
            app_version,
            min_runtime_version,
            frontend_dir,
            no_frontend,
            wasm,
            output,
        } => {
            // The key first: a missing one should fail before a long build.
            let key = match (dev, key) {
                (true, _) => {
                    eprintln!("• signing with the DEVELOPMENT key: fine for merod local, refused by the registry");
                    mero_sign::dev_signing_key()
                }
                (false, Some(path)) => mero_sign::load_signing_key(&path)?,
                (false, None) => bail!("pass --dev, or --key FILE (or set MERO_SIGN_KEY)"),
            };
            let app = App::load(&crate_dir)?;
            let app_version = app_version.unwrap_or_else(|| app.crate_version.clone());
            if app_version.is_empty() {
                bail!("no app version: set `version` in Cargo.toml or pass --app-version");
            }
            let min_runtime_version = min_runtime_version
                .or_else(|| app.meta.min_runtime_version.clone())
                .ok_or_else(|| {
                    eyre::eyre!(
                        "no min-runtime-version: set it in [package.metadata.calimero] (the core \
                         release the app builds against, e.g. \"1.0.0-rc.9\")"
                    )
                })?;
            let frontend_dir = if no_frontend {
                None
            } else {
                frontend_dir.or_else(|| app.frontend_dir())
            };
            // Before the build: a missing frontend build is the likelier mistake.
            let frontend = frontend_dir
                .as_deref()
                .map(bundle::collect_frontend)
                .transpose()?;
            let component = match wasm {
                Some(path) => {
                    fs::read(&path).wrap_err_with(|| format!("reading {}", path.display()))?
                }
                None => {
                    let path = build(&app, &crate_dir.join("res"))?;
                    fs::read(&path)?
                }
            };
            let inputs = bundle::Inputs {
                app: &app,
                component: &component,
                app_version: &app_version,
                min_runtime_version: &min_runtime_version,
                frontend: frontend.as_ref(),
            };
            let manifest = bundle::manifest(&inputs)?;
            let output = output.unwrap_or_else(|| {
                crate_dir
                    .join("dist")
                    .join(format!("{}-{app_version}.mpk", app.meta.package))
            });
            let signer = bundle::write(&output, &manifest, &component, frontend.as_ref(), &key)?;
            eprintln!(
                "✓ {}\n  package  {}\n  version  {app_version}\n  signer   {signer}\n  frontend {}",
                output.display(),
                app.meta.package,
                frontend.as_ref().map_or_else(
                    || "none".to_owned(),
                    |f| format!("{} files", f.frontend.files.len())
                ),
            );
            println!("{}", output.display());
        }
        Cmd::Inspect { mpk } => {
            let members = bundle::members(&mpk)?;
            let Some((_, manifest)) = members.iter().find(|(p, _)| p == "manifest.json") else {
                bail!("{} has no manifest.json", mpk.display());
            };
            let manifest: serde_json::Value = serde_json::from_slice(manifest)?;
            calimero_bundle::verify_manifest_signature(&manifest)
                .wrap_err("the manifest signature does not verify")?;
            for (path, bytes) in &members {
                eprintln!("{:>10}  {path}", bytes.len());
            }
            println!("{}", serde_json::to_string_pretty(&manifest)?);
        }
        Cmd::Abi { wasm } => {
            let bytes = fs::read(&wasm).wrap_err_with(|| format!("reading {}", wasm.display()))?;
            match calimero_app_build::abi_of(&bytes)? {
                Some(abi) => println!("{}", serde_json::to_string_pretty(&abi)?),
                None => bail!("{} has no calimero:abi section", wasm.display()),
            }
        }
    }
    Ok(())
}

/// Builds `app` and writes `<out_dir>/<lib>.wasm` and `<out_dir>/abi.json`.
fn build(app: &App, out_dir: &Path) -> Result<PathBuf> {
    // One target dir per crate unless CARGO_TARGET_DIR says otherwise (CI shares one).
    // Absolute: `build_component` runs cargo inside the crate.
    let target = match std::env::var_os("CARGO_TARGET_DIR") {
        Some(dir) => std::path::absolute(PathBuf::from(dir))?,
        None => app.dir.join("target"),
    };
    eprintln!("• building {} for wasm32-wasip2", app.crate_name);
    let built = calimero_app_build::build_component(&app.dir, &target)
        .wrap_err_with(|| format!("building {}", app.dir.display()))?;
    let Some(abi) = built.abi else {
        bail!(
            "{} built without a calimero:abi section: is its logic block `#[app::logic]`?",
            app.crate_name
        );
    };
    fs::create_dir_all(out_dir).wrap_err_with(|| format!("creating {}", out_dir.display()))?;
    let wasm = out_dir.join(format!("{}.wasm", app.lib_name()));
    fs::write(&wasm, &built.component).wrap_err_with(|| format!("writing {}", wasm.display()))?;
    // Committed beside the crate and diffed in CI, as v1's res/abi.json is: the
    // frontend's tests read it to check the client covers every method.
    let mut text = serde_json::to_string_pretty(&abi)?;
    text.push('\n');
    fs::write(out_dir.join("abi.json"), text)?;
    eprintln!(
        "• {} ({} bytes, imports: {})",
        wasm.display(),
        built.component.len(),
        built.imports.join(", ")
    );
    Ok(wasm)
}
