pub struct UserRow {
    pub id: String,
    pub provider: String,
    pub provider_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub created_at: i64,
}

pub struct MachineRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub machine_secret_hash: String,
    pub status: String,
    pub os: Option<String>,
    pub home_dir: Option<String>,
    pub last_seen_at: Option<i64>,
    pub created_at: i64,
}

pub struct BookmarkRow {
    pub id: String,
    pub user_id: String,
    pub machine_id: String,
    pub path: String,
    pub label: String,
    pub sort_order: i64,
    pub created_at: i64,
}

pub struct ApiTokenRow {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub token_hash: String,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
    pub expires_at: Option<i64>,
}

pub struct RegistrationTokenRow {
    pub id: String,
    pub user_id: String,
    pub machine_name: String,
    pub token_hash: String,
    pub expires_at: i64,
    pub used: bool,
}

pub struct TerminalSessionRow {
    pub id: String,
    pub machine_id: String,
    pub title: String,
    pub cwd: String,
    pub cols: i64,
    pub rows: i64,
    pub created_at: i64,
    pub destroyed_at: Option<i64>,
}
