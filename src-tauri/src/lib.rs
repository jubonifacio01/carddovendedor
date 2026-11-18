use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
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
    #[serde(alias = "cellular")]
    pub monthly_product_qty: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyProduct {
    pub month: String,
    pub name: String,
    pub target: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub profile: Option<Profile>,
    pub entries: Vec<DailyEntry>,
    #[serde(default)]
    pub monthly_products: Vec<MonthlyProduct>,
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
         );
         CREATE TABLE IF NOT EXISTS monthly_products (
           month TEXT PRIMARY KEY NOT NULL,
           name TEXT NOT NULL,
           target INTEGER NOT NULL DEFAULT 0
         );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn validate_entry(entry: &DailyEntry) -> Result<(), String> {
    if entry.date.len() != 10 || entry.date.chars().nth(4) != Some('-') || entry.date.chars().nth(7) != Some('-') {
        return Err("Data inválida. Use o formato AAAA-MM-DD.".into());
    }
    let values = [entry.pac, entry.sedex, entry.premium, entry.vd, entry.ar, entry.packaging, entry.monthly_product_qty];
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
                monthly_product_qty: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    let mut product_statement = conn
        .prepare("SELECT month, name, target FROM monthly_products ORDER BY month DESC")
        .map_err(|e| e.to_string())?;
    let product_rows = product_statement
        .query_map([], |row| Ok(MonthlyProduct {
            month: row.get(0)?,
            name: row.get(1)?,
            target: row.get(2)?,
        }))
        .map_err(|e| e.to_string())?;
    let mut monthly_products = Vec::new();
    for row in product_rows {
        monthly_products.push(row.map_err(|e| e.to_string())?);
    }
    Ok(AppState { profile, entries, monthly_products })
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
        params![entry.date, entry.pac, entry.sedex, entry.premium, entry.vd, entry.ar, entry.packaging, entry.monthly_product_qty, entry.updated_at],
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
fn save_monthly_product(app: AppHandle, product: MonthlyProduct) -> Result<(), String> {
    if product.month.len() != 7 || product.month.chars().nth(4) != Some('-') {
        return Err("Mês inválido. Use o formato AAAA-MM.".into());
    }
    if product.name.trim().is_empty() {
        return Err("Informe o nome do produto sazonal.".into());
    }
    if product.target < 0 {
        return Err("A meta não pode ser negativa.".into());
    }
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO monthly_products (month, name, target) VALUES (?1, ?2, ?3)
         ON CONFLICT(month) DO UPDATE SET name = excluded.name, target = excluded.target",
        params![product.month, product.name.trim(), product.target],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn replace_state(app: AppHandle, state: AppState) -> Result<(), String> {
    for entry in &state.entries {
        validate_entry(entry)?;
    }
    if let Some(profile) = &state.profile {
        if profile.name.trim().is_empty() {
            return Err("O backup não contém o nome do atendente.".into());
        }
        let targets = [profile.targets.sedex, profile.targets.premium, profile.targets.vd, profile.targets.ar, profile.targets.packaging];
        if targets.iter().any(|target| !target.is_finite() || *target < 0.0) {
            return Err("O backup contém uma meta inválida.".into());
        }
    }
    for product in &state.monthly_products {
        if product.month.len() != 7
            || product.month.chars().nth(4) != Some('-')
            || product.name.trim().is_empty()
            || product.target < 0
        {
            return Err("Há uma configuração de produto mensal inválida no backup.".into());
        }
    }

    let mut conn = open_db(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM entries", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM profile", []).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM monthly_products", []).map_err(|e| e.to_string())?;

    if let Some(profile) = &state.profile {
        let payload = serde_json::to_string(profile).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO profile (id, payload) VALUES (1, ?1)", params![payload])
            .map_err(|e| e.to_string())?;
    }
    for entry in &state.entries {
        tx.execute(
            "INSERT INTO entries (date, pac, sedex, premium, vd, ar, packaging, cellular, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![entry.date, entry.pac, entry.sedex, entry.premium, entry.vd, entry.ar, entry.packaging, entry.monthly_product_qty, entry.updated_at],
        )
        .map_err(|e| format!("Não foi possível importar o lançamento de {}: {e}", entry.date))?;
    }
    for product in &state.monthly_products {
        tx.execute(
            "INSERT INTO monthly_products (month, name, target) VALUES (?1, ?2, ?3)",
            params![product.month, product.name.trim(), product.target],
        ).map_err(|e| format!("Não foi possível importar a configuração de {}: {e}", product.month))?;
    }
    tx.commit().map_err(|e| format!("Não foi possível concluir a restauração: {e}"))?;
    Ok(())
}

#[tauri::command]
fn read_backup_file(path: String) -> Result<String, String> {
    let source = PathBuf::from(path);
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or_default();
    if !extension.eq_ignore_ascii_case("json") {
        return Err("Selecione um arquivo de backup com extensão .json.".into());
    }
    let metadata = fs::metadata(&source).map_err(|e| format!("Não foi possível acessar o arquivo: {e}"))?;
    if metadata.len() > 10 * 1024 * 1024 {
        return Err("O arquivo de backup é maior que o limite de 10 MB.".into());
    }
    fs::read_to_string(&source).map_err(|e| format!("Não foi possível ler o backup: {e}"))
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

#[tauri::command]
fn set_window_mode(app: AppHandle, compact: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "A janela principal não foi encontrada.".to_string())?;

    // Garante que set_size altere o tamanho visível, mesmo se o painel estiver maximizado.
    let _ = window.unmaximize();

    if compact {
        // 10 × 3 cm aproximados em unidades lógicas (96 DPI): 378 × 113 px.
        window.set_min_size(Some(LogicalSize::new(378.0, 113.0))).map_err(|e| e.to_string())?;
        window.set_size(LogicalSize::new(378.0, 113.0)).map_err(|e| e.to_string())?;
        window.set_max_size(Some(LogicalSize::new(378.0, 113.0))).map_err(|e| e.to_string())?;
        window.set_resizable(false).map_err(|e| e.to_string())?;
    } else {
        let full_size = LogicalSize::new(1080.0, 270.0);
        window.set_max_size(None::<LogicalSize<f64>>).map_err(|e| e.to_string())?;
        window.set_min_size(Some(LogicalSize::new(1000.0, 250.0))).map_err(|e| e.to_string())?;
        window.set_resizable(true).map_err(|e| e.to_string())?;
        window.set_size(full_size).map_err(|e| e.to_string())?;
    }

    let _ = window.set_always_on_top(true);
    position_panel_near_taskbar(&window);
    Ok(())
}

fn position_panel_near_taskbar(window: &WebviewWindow) {
    // Posiciona o painel sobre a área de trabalho, acima da barra de tarefas.
    // Usa o monitor principal como fallback quando a janela ainda está oculta.
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let size = window.outer_size().unwrap_or(PhysicalSize::new(1080, 270));
        let margin = 12_i32;
        let work_x = work_area.position.x;
        let work_y = work_area.position.y;
        let work_width = work_area.size.width as i32;
        let work_height = work_area.size.height as i32;
        let x = (work_x + work_width - size.width as i32 - margin).max(work_x + margin);
        let y = (work_y + work_height - size.height as i32 - margin).max(work_y + margin);
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn show_main_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    position_panel_near_taskbar(window);
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_main_window(window: &WebviewWindow) {
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if visible && !minimized {
        let _ = window.hide();
    } else {
        show_main_window(window);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Abrir Card do Vendedor", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Minimizar painel", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair do aplicativo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &hide_item, &quit_item])?;

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
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
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
                            toggle_main_window(&window);
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
        .invoke_handler(tauri::generate_handler![load_state, save_profile, save_entry, save_monthly_product, delete_entry, replace_state, read_backup_file, save_export_file, set_window_mode])
        .run(tauri::generate_context!())
        .expect("erro ao executar Card do Vendedor");
}
