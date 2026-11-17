use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow, WindowEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Targets {
    pub sedex: f64,
    pub premium: f64,
    pub vd: f64,
    pub ar: f64,
    pub packaging: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub agency: String,
    pub targets: Targets,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyEntry {
    pub date: String,
    pub pac: i64,
    pub sedex: i64,
    pub premium: i64,
    pub vd: i64,
    pub ar: i64,
    pub packaging: i64,
    pub cellular: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub profile: Option<Profile>,
    pub entries: Vec<DailyEntry>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("card-vendedor.sqlite3"))
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS profile (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           payload TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS entries (
           date TEXT PRIMARY KEY NOT NULL,
           pac INTEGER NOT NULL DEFAULT 0,
           sedex INTEGER NOT NULL DEFAULT 0,
           premium INTEGER NOT NULL DEFAULT 0,
           vd INTEGER NOT NULL DEFAULT 0,
           ar INTEGER NOT NULL DEFAULT 0,
           packaging INTEGER NOT NULL DEFAULT 0,
           cellular INTEGER NOT NULL DEFAULT 0,
           updated_at TEXT NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn validate_entry(entry: &DailyEntry) -> Result<(), String> {
    if entry.date.len() != 10 || entry.date.chars().nth(4) != Some('-') || entry.date.chars().nth(7) != Some('-') {
        return Err("Data inválida. Use o formato AAAA-MM-DD.".into());
    }
    let values = [entry.pac, entry.sedex, entry.premium, entry.vd, entry.ar, entry.packaging, entry.cellular];
    if values.iter().any(|value| *value < 0) {
        return Err("As quantidades não podem ser negativas.".into());
    }
    Ok(())
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<AppState, String> {
    let conn = open_db(&app)?;
    let payload: Option<String> = conn
        .query_row("SELECT payload FROM profile WHERE id = 1", [], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let profile = payload
        .map(|value| serde_json::from_str::<Profile>(&value).map_err(|e| e.to_string()))
        .transpose()?;

    let mut statement = conn
        .prepare("SELECT date, pac, sedex, premium, vd, ar, packaging, cellular, updated_at FROM entries ORDER BY date DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(DailyEntry {
                date: row.get(0)?,
                pac: row.get(1)?,
                sedex: row.get(2)?,
                premium: row.get(3)?,
                vd: row.get(4)?,
                ar: row.get(5)?,
                packaging: row.get(6)?,
                cellular: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(AppState { profile, entries })
}

#[tauri::command]
fn save_profile(app: AppHandle, profile: Profile) -> Result<(), String> {
    if profile.name.trim().is_empty() {
        return Err("Informe o nome do atendente.".into());
    }
    let payload = serde_json::to_string(&profile).map_err(|e| e.to_string())?;
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO profile (id, payload) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        params![payload],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_entry(app: AppHandle, entry: DailyEntry) -> Result<(), String> {
    validate_entry(&entry)?;
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO entries (date, pac, sedex, premium, vd, ar, packaging, cellular, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(date) DO UPDATE SET
           pac=excluded.pac, sedex=excluded.sedex, premium=excluded.premium,
           vd=excluded.vd, ar=excluded.ar, packaging=excluded.packaging,
           cellular=excluded.cellular, updated_at=excluded.updated_at",
        params![entry.date, entry.pac, entry.sedex, entry.premium, entry.vd, entry.ar, entry.packaging, entry.cellular, entry.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_entry(app: AppHandle, date: String) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM entries WHERE date = ?1", params![date])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn replace_state(app: AppHandle, profile: Option<Profile>, entries: Vec<DailyEntry>) -> Result<(), String> {
    for entry in &entries {
        validate_entry(entry)?;
    }
    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entries", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profile", []).map_err(|e| e.to_string())?;
    if let Some(profile) = profile {
        let payload = serde_json::to_string(&profile).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO profile (id, payload) VALUES (1, ?1)", params![payload])
            .map_err(|e| e.to_string())?;
    }
    for entry in entries {
        tx.execute(
            "INSERT INTO entries (date, pac, sedex, premium, vd, ar, packaging, cellular, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![entry.date, entry.pac, entry.sedex, entry.premium, entry.vd, entry.ar, entry.packaging, entry.cellular, entry.updated_at],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let destination = PathBuf::from(&path);
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "xlsx" && extension != "json" {
        return Err("Tipo de arquivo não permitido para exportação.".into());
    }
    fs::write(destination, bytes).map_err(|e| e.to_string())
}

fn show_main_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Abrir Card do Vendedor", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("ícone padrão ausente").clone())
                .tooltip("Card do Vendedor")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            show_main_window(&window);
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![load_state, save_profile, save_entry, delete_entry, replace_state, save_export_file])
        .run(tauri::generate_context!())
        .expect("erro ao executar Card do Vendedor");
}
