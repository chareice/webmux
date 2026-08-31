fn main() {
    // Mobile builds bake the hub URL via option_env!; tell cargo to
    // recompile when it changes so dev iteration doesn't need a clean.
    println!("cargo:rerun-if-env-changed=OFFDESK_MOBILE_HUB_URL");
    tauri_build::build()
}
