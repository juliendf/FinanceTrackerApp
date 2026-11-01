fn main() {
    // `sqlx::migrate!` reads the migrations directory at compile time. Cargo only
    // tracks the files the previous build included, so a *new* migration file
    // would not rebuild the crate that embeds it and would be silently skipped —
    // this makes adding a file a change the compiler notices.
    println!("cargo:rerun-if-changed=migrations");

    tauri_build::build()
}
