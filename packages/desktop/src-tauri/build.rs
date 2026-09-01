use std::env;
use std::fs;
use std::path::{Path, PathBuf};

// The Android emulator reaches the host machine on 10.0.2.2, so a debug build
// can always talk to a hub running on the developer's laptop.
const EMULATOR_URL_PATTERN: &str = "http://10.0.2.2:*/*";

const HUB_URL_ENV: &str = "OFFDESK_MOBILE_HUB_URL";

fn main() {
    println!("cargo:rerun-if-env-changed={HUB_URL_ENV}");
    println!("cargo:rerun-if-changed=capabilities");

    // The mobile capability has to grant plugin access to exactly the origin
    // the WebView loads, and that origin is only known at build time. Rather
    // than keep a second copy of it in a checked-in JSON file — which silently
    // rots the moment someone builds against their own hub — copy the
    // capability files into OUT_DIR, fill in `remote.urls` there, and point
    // tauri-build at the copy.
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let capabilities_dir = out_dir.join("capabilities");
    if capabilities_dir.exists() {
        fs::remove_dir_all(&capabilities_dir).expect("failed to clear generated capabilities");
    }
    copy_dir(Path::new("capabilities"), &capabilities_dir);
    write_mobile_remote_urls(&capabilities_dir.join("mobile").join("default.json"));

    // glob (used by tauri-build to collect the files) is happy with forward
    // slashes on every platform; Windows OUT_DIR paths are not.
    let pattern: &'static str = Box::leak(
        format!("{}/**/*", capabilities_dir.display())
            .replace('\\', "/")
            .into_boxed_str(),
    );

    let attributes = tauri_build::Attributes::new().capabilities_path_pattern(pattern);
    if let Err(error) = tauri_build::try_build(attributes) {
        panic!("failed to run tauri-build: {error:#}");
    }
}

/// Rewrite the mobile capability's `remote.urls` to the hub this build targets.
fn write_mobile_remote_urls(path: &Path) {
    let hub_url = env::var(HUB_URL_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let is_mobile = matches!(target_os.as_str(), "android" | "ios");

    let mut urls = Vec::new();
    match hub_url {
        Some(url) => urls.push(match remote_url_pattern(&url) {
            Ok(pattern) => pattern,
            Err(reason) => panic!("{HUB_URL_ENV} ({url}) is not usable: {reason}"),
        }),
        // Desktop builds never load the mobile capability, so an unset hub URL
        // is fine there. A mobile build without one would install an app that
        // points at nothing, so stop now with an explanation instead.
        None if is_mobile => panic!(
            "{HUB_URL_ENV} must be set when building for {target_os}: it is the hub the WebView \
             loads and the only origin the mobile capability grants plugin access to. \
             Example: {HUB_URL_ENV}=https://offdesk.example.com cargo tauri android build --apk"
        ),
        None => {}
    }
    urls.push(EMULATOR_URL_PATTERN.to_string());

    let source = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    let mut capability: serde_json::Value = serde_json::from_str(&source)
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", path.display()));
    capability["remote"] = serde_json::json!({ "urls": urls });

    let rendered = serde_json::to_string_pretty(&capability)
        .expect("failed to serialize the mobile capability");
    fs::write(path, rendered).unwrap_or_else(|e| panic!("failed to write {}: {e}", path.display()));
}

/// Turn a hub URL into the URL pattern Tauri matches remote windows against.
/// Capabilities are scoped per origin, so any path in the configured URL is
/// dropped in favour of a `/*` wildcard.
fn remote_url_pattern(hub_url: &str) -> Result<String, String> {
    let (scheme, rest) = hub_url
        .split_once("://")
        .ok_or("expected an absolute URL, e.g. https://offdesk.example.com")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!("expected an http(s) URL, got scheme `{scheme}`"));
    }

    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() {
        return Err("the URL has no host".into());
    }
    if authority.contains(|c: char| c.is_whitespace() || c == '*') {
        return Err(format!("`{authority}` is not a valid host"));
    }

    let path = &rest[authority.len()..];
    if !path.is_empty() && path != "/" {
        println!(
            "cargo:warning={HUB_URL_ENV} contains a path (`{path}`); capabilities are scoped per \
             origin, so the whole of {scheme}://{authority} is granted access."
        );
    }

    Ok(format!("{scheme}://{authority}/*"))
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap_or_else(|e| panic!("failed to create {}: {e}", to.display()));
    let entries =
        fs::read_dir(from).unwrap_or_else(|e| panic!("failed to read {}: {e}", from.display()));
    for entry in entries {
        let entry = entry.expect("failed to read a capability directory entry");
        let target = to.join(entry.file_name());
        if entry
            .file_type()
            .expect("failed to stat a capability file")
            .is_dir()
        {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target)
                .unwrap_or_else(|e| panic!("failed to copy {}: {e}", entry.path().display()));
        }
    }
}
