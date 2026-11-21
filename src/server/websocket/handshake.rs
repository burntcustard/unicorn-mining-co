use super::*;

pub(super) fn split_upgraded(upgraded: Upgraded) -> (ReadTransport, WriteTransport) {
    // Axum's connection builder can read the first frame ahead of the upgrade.
    let (stream, prefetched) = match upgraded.downcast::<TokioIo<TcpStream>>() {
        Ok(parts) => (parts.io, parts.read_buf),
        Err(upgraded) => match auto::upgrade::downcast::<TokioIo<TcpStream>>(upgraded) {
            Ok(parts) => (parts.io, parts.read_buf),
            Err(upgraded) => {
                let (reader, writer) = tokio::io::split(TokioIo::new(upgraded));
                return (Box::pin(reader), WriteTransport::Other(Box::pin(writer)));
            }
        },
    };
    let (reader, writer) = stream.into_inner().into_split();
    (
        Box::pin(Cursor::new(prefetched).chain(reader)),
        WriteTransport::Tcp(Arc::new(writer)),
    )
}

fn header_value(headers: &HeaderMap, name: header::HeaderName) -> &str {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

fn has_token(value: &str, token: &str) -> bool {
    value
        .split(',')
        .any(|part| part.trim().eq_ignore_ascii_case(token))
}

fn accept_key(key: &str) -> Option<HeaderValue> {
    if key.len() != 24 || WEBSOCKET_KEY.decode_slice(key, &mut [0; 18]).ok()? != 16 {
        return None;
    }

    let mut hash = Sha1::new();
    hash.update(key.as_bytes());
    hash.update(WEBSOCKET_GUID);
    let mut encoded = [0; 28];
    WEBSOCKET_KEY
        .encode_slice(hash.finalize(), &mut encoded)
        .ok()?;
    HeaderValue::from_bytes(&encoded).ok()
}

fn allowed_origin(origin: &str, host: &str, production: bool) -> bool {
    if origin.is_empty() || origin.strip_prefix("https://") == Some(host) {
        return true;
    }
    if production {
        return false;
    }

    let Some((scheme, authority)) = origin.split_once("://") else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("http") {
        return false;
    }

    let authority = authority.strip_suffix('#').unwrap_or(authority);
    let authority = authority.strip_suffix('?').unwrap_or(authority);
    ["localhost", "127.0.0.1", "[::1]"].into_iter().any(|name| {
        authority.strip_prefix(name).is_some_and(|port| {
            port.is_empty()
                || port
                    .strip_prefix(':')
                    .is_some_and(|port| port.bytes().all(|byte| byte.is_ascii_digit()))
        })
    })
}

pub(super) fn upgrade_key(request: &Request, production: bool) -> Option<HeaderValue> {
    let headers = request.headers();
    let origin = headers
        .get(header::ORIGIN)
        .map(HeaderValue::to_str)
        .transpose()
        .ok()?
        .unwrap_or_default();
    let host = headers
        .get(header::HOST)
        .and_then(|header| header.to_str().ok())
        .or_else(|| {
            request
                .uri()
                .authority()
                .map(|authority| authority.as_str())
        })
        .unwrap_or_default();
    if request.method() != Method::GET
        || request.uri().path() != "/game-socket"
        || request
            .uri()
            .query()
            .is_some_and(|query| query != SNAPSHOT_DELTA_QUERY)
        || !has_token(header_value(headers, header::CONNECTION), "upgrade")
        || !has_token(header_value(headers, header::UPGRADE), "websocket")
        || header_value(headers, header::SEC_WEBSOCKET_VERSION) != "13"
        || !allowed_origin(origin, host, production)
    {
        return None;
    }

    accept_key(header_value(headers, header::SEC_WEBSOCKET_KEY))
}

/// Validate and upgrade an HTTP game-socket request, then run the connection handler.
pub fn upgrade<F, Fut>(mut request: Request, production: bool, connected: F) -> Response
where
    F: FnOnce(WebSocket, WebSocketReader) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let Some(accept) = upgrade_key(&request, production) else {
        return (
            StatusCode::BAD_REQUEST,
            [(header::X_CONTENT_TYPE_OPTIONS, "nosniff")],
            "Bad WebSocket request\n",
        )
            .into_response();
    };
    if request.extensions().get::<OnUpgrade>().is_none() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::X_CONTENT_TYPE_OPTIONS, "nosniff")],
            "WebSocket unavailable\n",
        )
            .into_response();
    }

    let snapshot_deltas = request.uri().query() == Some(SNAPSHOT_DELTA_QUERY);
    let upgraded = hyper::upgrade::on(&mut request);
    tokio::spawn(async move {
        if let Ok(upgraded) = upgraded.await {
            let (read, write) = split_upgraded(upgraded);
            let direct = match &write {
                WriteTransport::Tcp(writer) if cfg!(target_os = "linux") => {
                    Some(Arc::downgrade(writer))
                }
                _ => None,
            };
            let (mut socket, outbound) = WebSocket::new(direct, PACKET_QUEUE_CAPACITY);
            socket.snapshot_deltas = snapshot_deltas;
            let pump = tokio::spawn(write_pump(socket.clone(), outbound, write));

            connected(socket.clone(), WebSocketReader::new(socket.clone(), read)).await;
            socket.finish().await;
            let _ = pump.await;
        }
    });

    (
        StatusCode::SWITCHING_PROTOCOLS,
        [
            (header::UPGRADE, HeaderValue::from_static("websocket")),
            (header::CONNECTION, HeaderValue::from_static("Upgrade")),
            (header::SEC_WEBSOCKET_ACCEPT, accept),
        ],
    )
        .into_response()
}
