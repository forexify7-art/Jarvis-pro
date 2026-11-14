// The web app (public/) is the whole UI. This shell only hosts it in a native
// WebView; all AI keys and logic stay on the J.A.R.V.I.S. server.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running J.A.R.V.I.S.");
}
