use std::env;
use std::error::Error;
use std::io;
use std::path::Path;
use std::process::Command;

fn main() -> Result<(), Box<dyn Error>> {
    for source in [
        "../../package-lock.json",
        "../../scripts/register-typescript.ts",
        "../../scripts/generate-rust-catalog.ts",
        "../../scripts/server-spec-catalog.ts",
        "../specs",
        "../client",
    ] {
        // Spec geometry also uses shared TypeScript utilities under src.
        println!("cargo:rerun-if-changed={source}");
    }

    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .ok_or_else(|| io::Error::other("Cargo did not provide CARGO_MANIFEST_DIR"))?;
    let project = Path::new(&manifest_dir)
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| io::Error::other("the server crate must be inside the game project"))?;
    let output =
        env::var_os("OUT_DIR").ok_or_else(|| io::Error::other("Cargo did not provide OUT_DIR"))?;
    let status = Command::new("node")
        .current_dir(project)
        .args([
            "--import",
            "./scripts/register-typescript.ts",
            "scripts/generate-rust-catalog.ts",
        ])
        .arg(output)
        .status()?;

    if !status.success() {
        return Err(
            io::Error::other(format!("TypeScript spec generation exited with {status}")).into(),
        );
    }

    Ok(())
}
