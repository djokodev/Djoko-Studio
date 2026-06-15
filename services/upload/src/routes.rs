use axum::{response::IntoResponse, routing::get, Json, Router};
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "upload";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct StatusResponse {
    pub status: String,
    pub service: String,
}

pub fn router() -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
}

async fn healthz() -> impl IntoResponse {
    Json(StatusResponse {
        status: "ok".to_string(),
        service: SERVICE_NAME.to_string(),
    })
}

async fn readyz() -> impl IntoResponse {
    Json(StatusResponse {
        status: "ok".to_string(),
        service: SERVICE_NAME.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{self, Method, Request, StatusCode},
    };
    use tower::ServiceExt;

    async fn call(method: Method, uri: &str) -> axum::response::Response {
        router()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await
            .expect("route should respond")
    }

    async fn assert_status_response(response: axum::response::Response) {
        assert_eq!(response.status(), StatusCode::OK);

        let content_type = response
            .headers()
            .get(http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .expect("content type header");
        assert!(
            content_type.starts_with("application/json"),
            "expected JSON content type, got {content_type:?}"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: StatusResponse = serde_json::from_slice(&body).expect("parse json");
        assert_eq!(payload.status, "ok");
        assert_eq!(payload.service, SERVICE_NAME);
    }

    #[tokio::test]
    async fn healthz_returns_ok_json() {
        assert_status_response(call(Method::GET, "/healthz").await).await;
    }

    #[tokio::test]
    async fn readyz_returns_ok_json() {
        assert_status_response(call(Method::GET, "/readyz").await).await;
    }

    #[tokio::test]
    async fn unknown_route_returns_not_found() {
        let response = call(Method::GET, "/unknown").await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn healthz_rejects_non_get_methods() {
        let response = call(Method::POST, "/healthz").await;
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }

    #[tokio::test]
    async fn readyz_rejects_non_get_methods() {
        let response = call(Method::POST, "/readyz").await;
        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    }
}
