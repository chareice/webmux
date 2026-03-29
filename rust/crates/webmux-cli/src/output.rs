/// Output mode for command results.
#[derive(Clone, Copy)]
pub enum OutputMode {
    Text,
    Json,
}

impl From<&crate::OutputFormat> for OutputMode {
    fn from(fmt: &crate::OutputFormat) -> Self {
        match fmt {
            crate::OutputFormat::Text => OutputMode::Text,
            crate::OutputFormat::Json => OutputMode::Json,
        }
    }
}
