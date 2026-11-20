use std::future::Future;
use std::io::{self, Cursor, IoSlice};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use axum::extract::Request;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::{GeneralPurpose, GeneralPurposeConfig};
use hyper::upgrade::{OnUpgrade, Upgraded};
use hyper_util::rt::TokioIo;
use hyper_util::server::conn::auto;
use sha1::{Digest, Sha1};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpStream, tcp::OwnedWriteHalf};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

pub const MAX_PAYLOAD: usize = 32 * 1024;
pub const MAX_SOCKET_BUFFER: usize = 1024 * 1024;
pub const MAX_SNAPSHOT_BUFFER: usize = 128 * 1024;

const PACKET_QUEUE_CAPACITY: usize = 64;
const FRAME_HEADER_SIZE: usize = 10;
const MAX_CONTROL_PAYLOAD: usize = 125;
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const WEBSOCKET_GUID: &[u8] = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WEBSOCKET_KEY: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::STANDARD,
    GeneralPurposeConfig::new().with_decode_allow_trailing_bits(true),
);

#[derive(Debug)]
pub enum SocketError {
    BadFrame,
    SlowClient,
    QueueFull,
    Closed,
    Io(io::Error),
}

impl std::fmt::Display for SocketError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadFrame => formatter.write_str("invalid websocket frame"),
            Self::SlowClient => formatter.write_str("slow websocket client"),
            Self::QueueFull => formatter.write_str("websocket send queue full"),
            Self::Closed => formatter.write_str("websocket closed"),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for SocketError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for SocketError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageKind {
    Binary,
    Text,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Opcode {
    Continuation = 0,
    Text = 1,
    Binary = 2,
    Close = 8,
    Ping = 9,
    Pong = 10,
}

impl TryFrom<u8> for Opcode {
    type Error = SocketError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Continuation),
            1 => Ok(Self::Text),
            2 => Ok(Self::Binary),
            8 => Ok(Self::Close),
            9 => Ok(Self::Ping),
            10 => Ok(Self::Pong),
            _ => Err(SocketError::BadFrame),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

struct SocketState {
    send: Mutex<()>,
    spare: Mutex<Option<Vec<u8>>>,
    pending: AtomicUsize,
    buffered: AtomicUsize,
    closing: AtomicBool,
    done: CancellationToken,
    last_pong: Mutex<Instant>,
    direct: Option<Weak<OwnedWriteHalf>>,
}

struct Outbound {
    state: Arc<SocketState>,
    bytes: Vec<u8>,
    offset: usize,
    length: usize,
    queued: bool,
    closing: bool,
}

impl Outbound {
    fn new(
        state: &Arc<SocketState>,
        opcode: Opcode,
        payload: &[u8],
        header: &[u8; FRAME_HEADER_SIZE],
        offset: usize,
    ) -> Self {
        let mut bytes = lock(&state.spare).take().unwrap_or_default();
        bytes.clear();
        bytes.reserve(FRAME_HEADER_SIZE + payload.len());
        bytes.extend_from_slice(header);
        bytes.extend_from_slice(payload);
        Self {
            state: Arc::clone(state),
            bytes,
            offset,
            length: payload.len(),
            queued: false,
            closing: opcode == Opcode::Close,
        }
    }

    fn wire(&self) -> &[u8] {
        &self.bytes[self.offset..]
    }
}

impl Drop for Outbound {
    fn drop(&mut self) {
        let mut spare = lock(&self.state.spare);
        if spare.is_none() {
            *spare = Some(std::mem::take(&mut self.bytes));
        }

        self.state.buffered.fetch_sub(self.length, Ordering::AcqRel);
        if self.queued {
            self.state.pending.fetch_sub(1, Ordering::AcqRel);
        }
    }
}

fn write_header(opcode: Opcode, size: usize, bytes: &mut [u8; FRAME_HEADER_SIZE]) -> usize {
    let offset = match size {
        0..=125 => {
            bytes[9] = size as u8;
            8
        }
        126..=65535 => {
            bytes[7] = 126;
            bytes[8..10].copy_from_slice(&(size as u16).to_be_bytes());
            6
        }
        _ => {
            bytes[1] = 127;
            bytes[2..10].copy_from_slice(&(size as u64).to_be_bytes());
            0
        }
    };
    bytes[offset] = 0x80 | opcode as u8;
    offset
}

const SNAPSHOT_DELTA_QUERY: &str = "snapshotDeltas=1";

/// Shareable writer handle for the game session.
#[derive(Clone)]
pub struct WebSocket {
    state: Arc<SocketState>,
    queue: mpsc::Sender<Outbound>,
    snapshot_deltas: bool,
}

impl WebSocket {
    fn new(
        direct: Option<Weak<OwnedWriteHalf>>,
        capacity: usize,
    ) -> (Self, mpsc::Receiver<Outbound>) {
        let (queue, receiver) = mpsc::channel(capacity);
        let state = Arc::new(SocketState {
            send: Mutex::new(()),
            spare: Mutex::new(None),
            pending: AtomicUsize::new(0),
            buffered: AtomicUsize::new(0),
            closing: AtomicBool::new(false),
            done: CancellationToken::new(),
            last_pong: Mutex::new(Instant::now()),
            direct,
        });
        (
            Self {
                state,
                queue,
                snapshot_deltas: false,
            },
            receiver,
        )
    }

    pub(crate) fn snapshot_deltas(&self) -> bool {
        self.snapshot_deltas
    }

    pub fn send_binary(&self, payload: &[u8]) -> Result<(), SocketError> {
        self.enqueue(Opcode::Binary, payload)
    }

    pub fn ping(&self) -> Result<(), SocketError> {
        self.enqueue(Opcode::Ping, &[])
    }

    pub fn close_with(&self, code: u16, reason: &str) {
        if self.state.closing.swap(true, Ordering::AcqRel) {
            return;
        }

        let mut payload = [0; MAX_CONTROL_PAYLOAD];
        let size = reason.len().min(MAX_CONTROL_PAYLOAD - 2);
        payload[..2].copy_from_slice(&code.to_be_bytes());
        payload[2..size + 2].copy_from_slice(&reason.as_bytes()[..size]);
        if self.enqueue(Opcode::Close, &payload[..size + 2]).is_err() {
            self.terminate();
        }
    }

    pub fn terminate(&self) {
        self.state.done.cancel();
    }

    pub async fn done(&self) {
        self.state.done.cancelled().await;
    }

    pub(crate) async fn finish(&self) {
        if self.state.closing.load(Ordering::Acquire) {
            self.done().await;
        } else {
            self.terminate();
        }
    }

    pub fn is_open(&self) -> bool {
        !self.state.closing.load(Ordering::Acquire) && !self.state.done.is_cancelled()
    }

    pub fn buffered_bytes(&self) -> usize {
        self.state.buffered.load(Ordering::Acquire)
    }

    pub fn last_pong(&self) -> Instant {
        *lock(&self.state.last_pong)
    }

    fn enqueue(&self, opcode: Opcode, payload: &[u8]) -> Result<(), SocketError> {
        let _send = lock(&self.state.send);
        if self.state.done.is_cancelled() {
            return Err(SocketError::Closed);
        }

        let length = payload.len();
        if length > MAX_SOCKET_BUFFER {
            self.terminate();
            return Err(SocketError::SlowClient);
        }

        let previously_buffered = self.state.buffered.fetch_add(length, Ordering::AcqRel);
        if previously_buffered + length > MAX_SOCKET_BUFFER {
            self.state.buffered.fetch_sub(length, Ordering::AcqRel);
            self.terminate();
            return Err(SocketError::SlowClient);
        }

        let mut header = [0; FRAME_HEADER_SIZE];
        let mut offset = write_header(opcode, length, &mut header);
        if self.state.pending.load(Ordering::Acquire) == 0
            && let Some(writer) = self.state.direct.as_ref().and_then(Weak::upgrade)
        {
            let wire_header = &header[offset..];
            let slices = [IoSlice::new(wire_header), IoSlice::new(payload)];
            match writer.try_write_vectored(&slices) {
                Ok(count) if count == wire_header.len() + length => {
                    if opcode == Opcode::Close {
                        self.terminate();
                    }
                    self.state.buffered.fetch_sub(length, Ordering::AcqRel);
                    return Ok(());
                }
                Ok(count) => offset += count,
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                    ) => {}
                Err(error) => {
                    self.terminate();
                    self.state.buffered.fetch_sub(length, Ordering::AcqRel);
                    return Err(error.into());
                }
            }
        }

        let mut frame = Outbound::new(&self.state, opcode, payload, &header, offset);
        let place = self.queue.try_reserve().map_err(|error| match error {
            mpsc::error::TrySendError::Full(_) => SocketError::QueueFull,
            mpsc::error::TrySendError::Closed(_) => SocketError::Closed,
        })?;
        self.state.pending.fetch_add(1, Ordering::AcqRel);
        frame.queued = true;
        place.send(frame);
        Ok(())
    }
}

#[cfg(feature = "test-fixtures")]
pub(crate) struct FixtureSocket {
    socket: WebSocket,
    outbound: mpsc::Receiver<Outbound>,
    close_code: u16,
}

#[cfg(feature = "test-fixtures")]
impl FixtureSocket {
    pub(crate) fn new() -> Self {
        let (socket, outbound) = WebSocket::new(None, 16);
        Self {
            socket,
            outbound,
            close_code: 0,
        }
    }

    pub(crate) fn socket(&self) -> WebSocket {
        self.socket.clone()
    }

    pub(crate) fn set_buffered_bytes(&mut self, bytes: usize) {
        assert!(self.outbound.is_empty());
        self.socket.state.buffered.store(bytes, Ordering::Release);
    }

    pub(crate) fn drain(&mut self, mut packet: impl FnMut(&[u8])) {
        while let Ok(frame) = self.outbound.try_recv() {
            let payload = &frame.bytes[FRAME_HEADER_SIZE..];
            if frame.closing {
                self.close_code = u16::from_be_bytes([payload[0], payload[1]]);
            } else {
                packet(payload);
            }
        }
    }

    pub(crate) fn close_code(&self) -> u16 {
        self.close_code
    }
}

type ReadTransport = Pin<Box<dyn AsyncRead + Send>>;

enum WriteTransport {
    Tcp(Arc<OwnedWriteHalf>),
    Other(Pin<Box<dyn AsyncWrite + Send>>),
}

impl WriteTransport {
    async fn write_frame(&mut self, mut wire: &[u8]) -> io::Result<()> {
        match self {
            Self::Tcp(writer) => {
                while !wire.is_empty() {
                    writer.writable().await?;
                    match writer.try_write(wire) {
                        Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
                        Ok(count) => wire = &wire[count..],
                        Err(error)
                            if matches!(
                                error.kind(),
                                io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                            ) => {}
                        Err(error) => return Err(error),
                    }
                }
                Ok(())
            }
            Self::Other(writer) => {
                writer.write_all(wire).await?;
                writer.flush().await
            }
        }
    }
}

async fn write_pump(
    socket: WebSocket,
    mut outbound: mpsc::Receiver<Outbound>,
    mut writer: WriteTransport,
) {
    loop {
        let frame = tokio::select! {
            biased;
            () = socket.done() => break,
            frame = outbound.recv() => frame,
        };
        let Some(frame) = frame else {
            break;
        };

        let result = tokio::select! {
            biased;
            () = socket.done() => break,
            result = timeout(WRITE_TIMEOUT, writer.write_frame(frame.wire())) => result,
        };
        let closing = frame.closing;
        drop(frame);
        if !matches!(result, Ok(Ok(()))) || closing {
            break;
        }
    }

    socket.terminate();
}

struct FrameHeader {
    fin: bool,
    opcode: Opcode,
    length: usize,
    mask: [u8; 4],
}

/// The connection's single reader. Reuse one payload buffer across successive reads.
pub struct WebSocketReader {
    socket: WebSocket,
    input: BufReader<ReadTransport>,
}

impl WebSocketReader {
    fn new(socket: WebSocket, input: ReadTransport) -> Self {
        Self {
            socket,
            input: BufReader::with_capacity(4096, input),
        }
    }

    /// Cancel a pending read only when closing the connection.
    pub async fn read_message_into<'a>(
        &mut self,
        payload: &'a mut Vec<u8>,
    ) -> Result<(MessageKind, &'a [u8]), SocketError> {
        let done = self.socket.state.done.clone();
        let kind = tokio::select! {
            biased;
            () = done.cancelled() => return Err(SocketError::Closed),
            result = self.read_message(payload) => result?,
        };
        Ok((kind, payload))
    }

    async fn read_message(&mut self, payload: &mut Vec<u8>) -> Result<MessageKind, SocketError> {
        payload.clear();
        let mut kind = None;
        let mut control = [0; MAX_CONTROL_PAYLOAD];

        loop {
            let frame = self.read_header().await?;
            match frame.opcode {
                Opcode::Ping | Opcode::Pong | Opcode::Close => {
                    let control = &mut control[..frame.length];
                    self.read_payload(&frame, control).await?;
                    if frame.opcode == Opcode::Ping {
                        self.socket.enqueue(Opcode::Pong, control)?;
                    } else if frame.opcode == Opcode::Pong {
                        *lock(&self.socket.state.last_pong) = Instant::now();
                    } else {
                        self.socket.terminate();
                        return Err(SocketError::Closed);
                    }
                    continue;
                }
                Opcode::Binary | Opcode::Text if kind.is_none() => {
                    kind = Some(if frame.opcode == Opcode::Binary {
                        MessageKind::Binary
                    } else {
                        MessageKind::Text
                    });
                }
                Opcode::Continuation if kind.is_some() => {}
                _ => return Err(SocketError::BadFrame),
            }

            let offset = payload.len();
            if offset + frame.length > MAX_PAYLOAD {
                return Err(SocketError::BadFrame);
            }

            payload.reserve(frame.length);
            let mut body = (&mut self.input).take(frame.length as u64);
            while body.limit() != 0 {
                if body.read_buf(payload).await? == 0 {
                    return Err(io::Error::from(io::ErrorKind::UnexpectedEof).into());
                }
            }
            apply_mask(frame.mask, &mut payload[offset..]);
            if frame.fin {
                return kind.ok_or(SocketError::BadFrame);
            }
        }
    }

    async fn read_header(&mut self) -> Result<FrameHeader, SocketError> {
        let mut prefix = [0; 2];
        self.input.read_exact(&mut prefix).await?;
        let fin = prefix[0] & 0x80 != 0;
        if prefix[0] & 0x70 != 0 || prefix[1] & 0x80 == 0 {
            return Err(SocketError::BadFrame);
        }

        let opcode = Opcode::try_from(prefix[0] & 0x0f)?;
        let length = match prefix[1] & 0x7f {
            126 => {
                let length = self.input.read_u16().await?;
                if length < 126 {
                    return Err(SocketError::BadFrame);
                }
                usize::from(length)
            }
            127 => {
                // The 64-bit form starts above the game's entire payload limit.
                return Err(SocketError::BadFrame);
            }
            length => usize::from(length),
        };
        if length > MAX_PAYLOAD || (opcode as u8 >= 8 && (!fin || length > MAX_CONTROL_PAYLOAD)) {
            return Err(SocketError::BadFrame);
        }

        let mut mask = [0; 4];
        self.input.read_exact(&mut mask).await?;
        Ok(FrameHeader {
            fin,
            opcode,
            length,
            mask,
        })
    }

    async fn read_payload(
        &mut self,
        frame: &FrameHeader,
        payload: &mut [u8],
    ) -> Result<(), SocketError> {
        self.input.read_exact(payload).await?;
        apply_mask(frame.mask, payload);
        Ok(())
    }
}

fn apply_mask(mask: [u8; 4], payload: &mut [u8]) {
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index & 3];
    }
}

fn split_upgraded(upgraded: Upgraded) -> (ReadTransport, WriteTransport) {
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

fn upgrade_key(request: &Request, production: bool) -> Option<HeaderValue> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tokio::io::{AsyncBufReadExt, DuplexStream};

    const VALID_KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";
    const VALID_ACCEPT: &str = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
    const EXCHANGE_TIMEOUT: Duration = Duration::from_secs(3);

    fn masked_frame(opcode: Opcode, final_fragment: bool, payload: &[u8]) -> Vec<u8> {
        let mask = [0x31, 0x72, 0xb3, 0xf4];
        let mut frame = Vec::with_capacity(FRAME_HEADER_SIZE + payload.len());
        frame.push((u8::from(final_fragment) << 7) | opcode as u8);
        if payload.len() < 126 {
            frame.push(0x80 | payload.len() as u8);
        } else {
            frame.push(0xfe);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        frame.extend_from_slice(&mask);
        frame.extend_from_slice(payload);
        apply_mask(
            mask,
            &mut frame[(if payload.len() < 126 { 6 } else { 8 })..],
        );
        frame
    }

    async fn read_server_frame(reader: &mut (impl AsyncRead + Unpin)) -> io::Result<(u8, Vec<u8>)> {
        let mut header = [0; 2];
        reader.read_exact(&mut header).await?;
        assert_eq!(header[0] & 0xf0, 0x80);
        let length = match header[1] {
            126 => usize::from(reader.read_u16().await?),
            127 => reader.read_u64().await? as usize,
            length => usize::from(length),
        };
        let mut payload = vec![0; length];
        reader.read_exact(&mut payload).await?;
        Ok((header[0] & 0xf, payload))
    }

    fn request(path: &str, origin: &str) -> Request {
        Request::builder()
            .uri(path)
            .header(header::HOST, "example.com")
            .header(header::CONNECTION, "keep-alive, UpGrAdE")
            .header(header::UPGRADE, "WebSocket")
            .header(header::SEC_WEBSOCKET_VERSION, "13")
            .header(header::SEC_WEBSOCKET_KEY, VALID_KEY)
            .header(header::ORIGIN, origin)
            .body(Body::empty())
            .unwrap()
    }

    #[test]
    fn origins_match_production_and_development_rules() {
        for origin in [
            "",
            "https://example.com",
            "http://localhost:3000",
            "http://localhost:3002",
            "http://localhost:3105",
            "http://127.0.0.1:3003",
            "http://[::1]:3004",
            "HTTP://localhost:3000?#",
        ] {
            let request = request("/game-socket", origin);
            assert_eq!(
                upgrade_key(&request, false).unwrap(),
                VALID_ACCEPT,
                "{origin}"
            );
            assert_eq!(
                upgrade_key(&request, true).is_some(),
                origin.is_empty() || origin == "https://example.com",
                "{origin}",
            );
        }

        for origin in [
            "https://example.com/",
            "https://evil.example",
            "http://evil.example:3002",
            "http://localhost.evil.example:3002",
            "http://localhost:3002/path",
            "http://user@localhost:3002",
            "http://localhost:3002?foo",
            "http://localhost:3002#foo",
            "http://localhost:wrong",
            "null",
        ] {
            let request = request("/game-socket", origin);
            for production in [false, true] {
                assert!(upgrade_key(&request, production).is_none(), "{origin}");
            }
        }

        let mut invalid = request("/game-socket", "");
        invalid.headers_mut().insert(
            header::SEC_WEBSOCKET_KEY,
            HeaderValue::from_static("not-base64"),
        );
        assert!(upgrade_key(&invalid, false).is_none());
        assert!(upgrade_key(&request("/game-socket?token=1", ""), false).is_none());
        assert!(upgrade_key(&request("/game-socket?", ""), false).is_none());
        assert!(upgrade_key(&request("/other", ""), false).is_none());
    }

    #[tokio::test]
    async fn reads_payload_boundaries_with_reusable_storage() {
        let (socket, _queue) = WebSocket::new(None, 1);
        for size in [0, 1, 32, 125, 126, 4096, MAX_PAYLOAD] {
            let bytes = vec![0x91; size];
            let mut wire = masked_frame(Opcode::Binary, true, &bytes);
            wire.extend_from_slice(&masked_frame(Opcode::Text, true, b"next"));

            let mut reader = WebSocketReader::new(socket.clone(), Box::pin(Cursor::new(wire)));
            let mut output = Vec::with_capacity(MAX_PAYLOAD);
            let allocation = output.as_ptr();
            let (kind, payload) = reader.read_message_into(&mut output).await.unwrap();
            assert_eq!(kind, MessageKind::Binary);
            assert_eq!(payload, bytes);
            assert_eq!(output.as_ptr(), allocation);
            let (kind, payload) = reader.read_message_into(&mut output).await.unwrap();
            assert_eq!((kind, payload), (MessageKind::Text, b"next".as_slice()));
            assert_eq!(output.as_ptr(), allocation);
        }
    }

    #[tokio::test]
    async fn fragments_reassemble_across_ping_and_pong_frames() {
        let mut wire = masked_frame(Opcode::Binary, false, b"first");
        wire.extend_from_slice(&masked_frame(Opcode::Ping, true, b"ping"));
        wire.extend_from_slice(&masked_frame(Opcode::Pong, true, b"server ping"));
        wire.extend_from_slice(&masked_frame(Opcode::Continuation, false, &[]));
        wire.extend_from_slice(&masked_frame(Opcode::Continuation, true, b"last"));
        wire.extend_from_slice(&masked_frame(Opcode::Close, true, &1000_u16.to_be_bytes()));

        let (socket, mut queue) = WebSocket::new(None, 1);
        let last_pong = socket.last_pong();
        let mut reader = WebSocketReader::new(socket.clone(), Box::pin(Cursor::new(wire)));
        let mut output = Vec::new();
        let (kind, payload) = reader.read_message_into(&mut output).await.unwrap();
        assert_eq!(
            (kind, payload),
            (MessageKind::Binary, b"firstlast".as_slice())
        );
        let pong = queue.try_recv().unwrap();
        assert_eq!(pong.wire(), b"\x8a\x04ping");
        assert!(socket.last_pong() >= last_pong);

        assert!(matches!(
            reader.read_message_into(&mut output).await,
            Err(SocketError::Closed)
        ));
        assert!(!socket.is_open());
        assert!(queue.try_recv().is_err());
    }

    #[tokio::test]
    async fn rejects_malformed_and_oversized_frames() {
        let mut interrupted = masked_frame(Opcode::Binary, false, &[]);
        interrupted.extend_from_slice(&masked_frame(Opcode::Binary, true, &[]));
        let mut cumulative = masked_frame(Opcode::Binary, false, &vec![0; MAX_PAYLOAD]);
        cumulative.extend_from_slice(&masked_frame(Opcode::Continuation, true, &[1]));
        let (socket, _queue) = WebSocket::new(None, 1);

        for wire in [
            vec![0x82, 1, 0],
            vec![0xc2, 0x80],
            vec![0x82, 0xfe, 0, 125],
            vec![0x82, 0xff, 0, 0, 0, 0, 0, 0, 0xff, 0xff],
            vec![0x82, 0xfe, 0x80, 1],
            vec![0x83, 0x80],
            masked_frame(Opcode::Ping, false, &[]),
            masked_frame(Opcode::Ping, true, &[0; 126]),
            masked_frame(Opcode::Continuation, true, &[]),
            interrupted,
            cumulative,
        ] {
            let mut reader = WebSocketReader::new(socket.clone(), Box::pin(Cursor::new(wire)));
            assert!(matches!(
                reader.read_message_into(&mut Vec::new()).await,
                Err(SocketError::BadFrame)
            ));
        }
    }

    #[test]
    fn queue_keeps_bytes_until_write_and_enforces_both_limits() {
        let (socket, mut queue) = WebSocket::new(None, 1);
        socket.send_binary(b"first").unwrap();
        assert!(matches!(
            socket.send_binary(b"second"),
            Err(SocketError::QueueFull)
        ));
        assert_eq!(socket.buffered_bytes(), 5);

        assert!(matches!(
            socket.send_binary(&vec![0; MAX_SOCKET_BUFFER]),
            Err(SocketError::SlowClient)
        ));
        assert!(!socket.is_open());
        assert!(matches!(socket.send_binary(&[]), Err(SocketError::Closed)));
        let written = queue.try_recv().unwrap();
        assert_eq!(socket.buffered_bytes(), 5);
        assert_eq!(written.wire(), b"\x82\x05first");
        drop(written);
        assert_eq!(socket.buffered_bytes(), 0);
    }

    #[tokio::test]
    async fn queued_buffers_hold_original_bytes_until_sent() {
        let (socket, queue) = WebSocket::new(None, 64);
        let (write, mut read) = tokio::io::duplex(128);
        let writer = tokio::spawn(write_pump(
            socket.clone(),
            queue,
            WriteTransport::Other(Box::pin(write)),
        ));
        let sizes = [0, 125, 126, 4096, 4097, 65535, 65536];

        for size in sizes {
            let mut payload = vec![0xa5; size];
            socket.send_binary(&payload).unwrap();
            payload.fill(0);
        }
        socket.close_with(1008, "Message limit");
        assert!(!socket.is_open());

        timeout(EXCHANGE_TIMEOUT, async {
            for size in sizes {
                let (opcode, bytes) = read_server_frame(&mut read).await.unwrap();
                assert_eq!(opcode, Opcode::Binary as u8);
                assert_eq!(bytes, vec![0xa5; size]);
            }
            let (opcode, bytes) = read_server_frame(&mut read).await.unwrap();
            assert_eq!(opcode, Opcode::Close as u8);
            assert_eq!(bytes, b"\x03\xf0Message limit");
            writer.await.unwrap();
        })
        .await
        .unwrap();

        assert_eq!(socket.buffered_bytes(), 0);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    #[ignore = "requires opening a loopback TCP listener"]
    async fn partial_direct_write_resumes_before_later_frames() {
        timeout(EXCHANGE_TIMEOUT, async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let sender = tokio::net::TcpSocket::new_v4().unwrap();
            sender.set_send_buffer_size(4096).unwrap();
            let (_, writer) = sender
                .connect(listener.local_addr().unwrap())
                .await
                .unwrap()
                .into_split();
            let writer = Arc::new(writer);
            let (mut reader, _) = listener.accept().await.unwrap();
            let (socket, queue) = WebSocket::new(Some(Arc::downgrade(&writer)), 4);

            writer.writable().await.unwrap();
            socket.ping().unwrap();
            socket.send_binary(b"direct").unwrap();
            assert!(queue.is_empty());
            assert_eq!(socket.buffered_bytes(), 0);
            assert!(lock(&socket.state.spare).is_none());
            assert_eq!(
                read_server_frame(&mut reader).await.unwrap(),
                (Opcode::Ping as u8, Vec::new()),
            );
            assert_eq!(
                read_server_frame(&mut reader).await.unwrap(),
                (Opcode::Binary as u8, b"direct".to_vec()),
            );

            let payload = vec![0xa5; MAX_SOCKET_BUFFER / 2];
            socket.send_binary(&payload).unwrap();
            assert_eq!(queue.len(), 1);
            let mut prefix = [0];
            assert_eq!(reader.peek(&mut prefix).await.unwrap(), 1);
            assert_eq!(prefix, [0x82]);
            socket.send_binary(b"next").unwrap();
            socket.close_with(1000, "");
            assert_eq!(queue.len(), 3);
            assert_eq!(socket.buffered_bytes(), payload.len() + 4 + 2);

            let pump = tokio::spawn(write_pump(
                socket.clone(),
                queue,
                WriteTransport::Tcp(writer),
            ));
            assert_eq!(
                read_server_frame(&mut reader).await.unwrap(),
                (Opcode::Binary as u8, payload),
            );
            assert_eq!(
                read_server_frame(&mut reader).await.unwrap(),
                (Opcode::Binary as u8, b"next".to_vec()),
            );
            assert_eq!(
                read_server_frame(&mut reader).await.unwrap(),
                (Opcode::Close as u8, 1000_u16.to_be_bytes().to_vec()),
            );
            pump.await.unwrap();
            assert_eq!(socket.buffered_bytes(), 0);
            assert_eq!(socket.state.pending.load(Ordering::Acquire), 0);
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn concurrent_senders_hold_distinct_frames_and_release_reservations() {
        let (socket, mut queue) = WebSocket::new(None, 64);
        let senders = (0..8)
            .map(|sender| {
                let socket = socket.clone();
                std::thread::spawn(move || {
                    let mut payload = [sender; 123];
                    for sequence in 0..8 {
                        payload[1] = sequence;
                        socket.send_binary(&payload).unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for sender in senders {
            sender.join().unwrap();
        }

        assert_eq!(socket.buffered_bytes(), 64 * 123);
        let mut received = [[false; 8]; 8];
        for _ in 0..64 {
            let frame = queue.try_recv().unwrap();
            let wire = frame.wire();
            let sender = usize::from(wire[2]);
            let sequence = usize::from(wire[3]);
            assert_eq!(&wire[..2], &[0x82, 123]);
            assert!(wire[4..].iter().all(|&byte| usize::from(byte) == sender));
            assert!(!received[sender][sequence]);
            received[sender][sequence] = true;
        }
        assert_eq!(socket.buffered_bytes(), 0);
    }

    const REQUEST_BYTES: &[u8] = b"GET /game-socket HTTP/1.1\r\nHost: example.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: https://example.com\r\n\r\n";

    async fn exchange(mut client: impl AsyncRead + AsyncWrite + Unpin) {
        let first = masked_frame(Opcode::Binary, false, b"he");
        let mut request = REQUEST_BYTES.to_vec();
        request.extend_from_slice(&first);
        client.write_all(&request).await.unwrap();

        let mut client = BufReader::new(client);
        let mut line = String::new();
        client.read_line(&mut line).await.unwrap();
        assert!(line.contains("101 Switching Protocols"), "{line}");
        let mut saw_accept = false;
        loop {
            line.clear();
            assert_ne!(client.read_line(&mut line).await.unwrap(), 0);
            if line == "\r\n" {
                break;
            }
            if line.eq_ignore_ascii_case(&format!("sec-websocket-accept: {VALID_ACCEPT}\r\n")) {
                saw_accept = true;
            }
        }
        assert!(saw_accept);

        let last = masked_frame(Opcode::Continuation, true, b"llo");
        for byte in last {
            client.get_mut().write_all(&[byte]).await.unwrap();
        }
        let (opcode, bytes) = read_server_frame(&mut client).await.unwrap();
        assert_eq!(
            (opcode, bytes.as_slice()),
            (Opcode::Binary as u8, b"hello".as_slice())
        );
        client
            .get_mut()
            .write_all(&masked_frame(Opcode::Close, true, &[]))
            .await
            .unwrap();
    }

    async fn echo(socket: WebSocket, mut reader: WebSocketReader) {
        let mut bytes = Vec::new();
        let (kind, payload) = reader.read_message_into(&mut bytes).await.unwrap();
        assert_eq!(kind, MessageKind::Binary);
        socket.send_binary(payload).unwrap();
        let _ = reader.read_message_into(&mut bytes).await;
    }

    #[tokio::test]
    async fn http_upgrade_keeps_prefetched_frames() {
        let (server, client): (DuplexStream, DuplexStream) = tokio::io::duplex(4096);
        let service = hyper::service::service_fn(
            |request: hyper::Request<hyper::body::Incoming>| async move {
                Ok::<_, std::convert::Infallible>(upgrade(request.map(Body::new), true, echo))
            },
        );
        let server = tokio::spawn(async move {
            hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(server), service)
                .with_upgrades()
                .await
                .unwrap();
        });

        timeout(EXCHANGE_TIMEOUT, exchange(client)).await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires opening a loopback TCP listener"]
    async fn axum_upgrade_retains_linux_direct_writer() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = axum::Router::new().fallback(|request: Request| async move {
            upgrade(request, true, |socket, reader| async move {
                assert_eq!(
                    socket
                        .state
                        .direct
                        .as_ref()
                        .and_then(Weak::upgrade)
                        .is_some(),
                    cfg!(target_os = "linux")
                );
                echo(socket, reader).await;
            })
        });
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

        let client = TcpStream::connect(address).await.unwrap();
        timeout(EXCHANGE_TIMEOUT, exchange(client)).await.unwrap();
        server.abort();
    }
}
