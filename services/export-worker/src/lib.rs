pub mod ffmpeg;
pub mod http;
pub mod model;
pub mod service;
pub mod storage;

use std::sync::Arc;

use axum::Router;

use crate::{ffmpeg::FfmpegRunner, service::ExportService, storage::ExportStorage};

pub fn build_router(storage: Arc<dyn ExportStorage>, ffmpeg: Arc<dyn FfmpegRunner>) -> Router {
    http::build_router(ExportService::new(storage, ffmpeg))
}
