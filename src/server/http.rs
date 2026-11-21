use std::io;
use std::path::{Path, PathBuf};

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use percent_encoding::percent_decode_str;
use tokio::fs::File;
use tokio_util::io::ReaderStream;

/// Serve the production client files and the public health check.
pub fn asset_router(directory: impl AsRef<Path>) -> io::Result<Router> {
    Ok(Router::new()
        .fallback(serve_assets)
        .with_state(std::path::absolute(directory)?))
}

async fn serve_assets(State(root): State<PathBuf>, request: Request) -> Response {
    let raw = request
        .uri()
        .path_and_query()
        .map_or("/", |value| value.as_str());
    let head = request.method() == Method::HEAD;
    if raw == "/healthz" {
        return (
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            if head { "" } else { "ok" },
        )
            .into_response();
    }

    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            request
                .uri()
                .authority()
                .map(|authority| authority.as_str())
        });
    if host == Some("www.unicorn-mining.co") {
        return (
            StatusCode::PERMANENT_REDIRECT,
            [(header::LOCATION, format!("https://unicorn-mining.co{raw}"))],
        )
            .into_response();
    }
    if !head && request.method() != Method::GET {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, "GET, HEAD")],
        )
            .into_response();
    }

    let pathname = match request_path(request.uri().path()) {
        Ok(path) => path,
        Err(status) => return status.into_response(),
    };
    let file = root.join(&pathname);
    let details = match tokio::fs::metadata(&file).await {
        Ok(details) if details.is_file() => details,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let opened = match File::open(&file).await {
        Ok(file) => file,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let body = if head {
        Body::empty()
    } else {
        Body::from_stream(ReaderStream::new(opened))
    };
    let name = pathname
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let extension = pathname
        .extension()
        .and_then(|extension| extension.to_str());
    let cache = if name.ends_with("index.html") {
        "no-cache"
    } else if matches!(extension, Some("js" | "css" | "woff2")) && has_asset_hash(name) {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    };
    let content_type = match extension {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("txt") => "text/plain; charset=utf-8",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    };

    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(details.len()));
    response
}

fn has_asset_hash(name: &str) -> bool {
    let Some((stem, _)) = name.rsplit_once('.') else {
        return false;
    };
    stem.as_bytes()
        .iter()
        .rev()
        .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        .skip(1)
        .any(|&byte| byte == b'-')
}

fn request_path(raw: &str) -> Result<PathBuf, StatusCode> {
    let raw = if raw.is_empty() {
        "/".into()
    } else {
        raw.replace('\\', "/")
    };
    for (index, byte) in raw.bytes().enumerate() {
        if byte == b'%'
            && !raw
                .as_bytes()
                .get(index + 1..index + 3)
                .is_some_and(|digits| digits.iter().all(u8::is_ascii_hexdigit))
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    // Normalize encoded dot segments before decoding encoded separators.
    let mut parts = Vec::new();
    let mut segments = raw.split('/').peekable();
    while let Some(part) = segments.next() {
        let dots = part.to_ascii_lowercase().replace("%2e", ".");
        match dots.as_str() {
            "." => {}
            ".." => {
                if parts.len() > 1 {
                    parts.pop();
                }
            }
            _ => parts.push(part),
        }
        if matches!(dots.as_str(), "." | "..") && segments.peek().is_none() {
            parts.push("");
        }
    }
    let normalized = parts.join("/");
    let decoded = percent_decode_str(&normalized)
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    if decoded == "/" {
        return Ok(PathBuf::from("index.html"));
    }

    let mut path = PathBuf::new();
    for part in decoded.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if !path.pop() {
                    return Err(StatusCode::NOT_FOUND);
                }
            }
            _ => path.push(part),
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_path_preserves_dot_segment_handling() {
        for (input, expected) in [
            ("/", "index.html"),
            ("/assets/../index.html", "index.html"),
            ("/assets/%2e%2e/index.html", "index.html"),
            ("/a/..", "index.html"),
            ("/space%20name.txt", "space name.txt"),
        ] {
            assert_eq!(request_path(input).unwrap(), Path::new(expected));
        }
        assert_eq!(
            request_path("/%2e%2e%2fpackage.json"),
            Err(StatusCode::NOT_FOUND)
        );
        assert_eq!(request_path("/%ff"), Err(StatusCode::BAD_REQUEST));
        assert_eq!(request_path("/bad%escape"), Err(StatusCode::BAD_REQUEST));
    }

    #[test]
    fn versioned_asset_suffix() {
        assert!(has_asset_hash("game-abc-123.js"));
        assert!(has_asset_hash("some.asset-_-.css"));
        assert!(!has_asset_hash("game-.js"));
        assert!(!has_asset_hash("gemetric.woff2"));
        assert!(!has_asset_hash("game-abc+.css"));
    }
}
