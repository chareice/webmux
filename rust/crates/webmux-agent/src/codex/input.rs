use base64::Engine;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use tokio::fs;
use webmux_shared::RunImageAttachmentUpload;

/// Prepared Codex input. The prompt is either a plain string or references
/// temp files containing decoded images.
pub struct PreparedCodexInput {
    /// The prompt text (may reference temp image file paths).
    pub prompt: String,
    /// Paths to temporary image files that should be passed as local_image
    /// arguments. Empty when there are no attachments.
    pub image_paths: Vec<PathBuf>,
    /// Temporary directory holding the images. Dropped to clean up.
    _temp_dir: Option<TempDir>,
}

impl PreparedCodexInput {
    /// Remove the temporary directory and all its contents.
    pub async fn cleanup(self) {
        // The TempDir is dropped here, which removes the directory.
        drop(self._temp_dir);
    }
}

/// Write base64-encoded image attachments to temp files and return the
/// prepared input alongside their paths.
pub async fn prepare_codex_input(
    prompt: &str,
    attachments: &[RunImageAttachmentUpload],
) -> Result<PreparedCodexInput, String> {
    if attachments.is_empty() {
        return Ok(PreparedCodexInput {
            prompt: prompt.to_string(),
            image_paths: Vec::new(),
            _temp_dir: None,
        });
    }

    let temp_dir =
        TempDir::new().map_err(|e| format!("failed to create temp directory: {e}"))?;
    let mut image_paths: Vec<PathBuf> = Vec::new();

    for attachment in attachments {
        let extension = choose_attachment_extension(attachment);
        let file_name = format!("{}{}", attachment.id, extension);
        let file_path = temp_dir.path().join(&file_name);

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&attachment.base64)
            .map_err(|e| format!("failed to decode base64 attachment {}: {e}", attachment.id))?;

        fs::write(&file_path, &bytes)
            .await
            .map_err(|e| format!("failed to write temp image file: {e}"))?;

        image_paths.push(file_path);
    }

    Ok(PreparedCodexInput {
        prompt: prompt.to_string(),
        image_paths,
        _temp_dir: Some(temp_dir),
    })
}

fn choose_attachment_extension(attachment: &RunImageAttachmentUpload) -> String {
    let from_name = Path::new(&attachment.name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    if !from_name.is_empty() {
        return from_name;
    }

    match attachment.mime_type.as_str() {
        "image/png" => ".png".to_string(),
        "image/jpeg" => ".jpg".to_string(),
        "image/webp" => ".webp".to_string(),
        "image/gif" => ".gif".to_string(),
        _ => ".img".to_string(),
    }
}
