use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::Router;
use axum::body::to_bytes;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use hyper::server::conn::http1;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::service::TowerToHyperService;
use tokio::net::TcpListener;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore, mpsc, oneshot};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::{Instant, MissedTickBehavior, interval_at, sleep, timeout_at};
use tokio_util::sync::CancellationToken;

use crate::movement_transport::MovementTransport;
use crate::protocol::{Control, decode_client_control, parse_uuid};
use crate::specs::{Catalog, Protocol};
use crate::websocket::{self, MessageKind, WebSocket, WebSocketReader};

use crate::utilities::server_tick_timer::TickTimer;

const MAX_CLIENTS: usize = 40;
const INBOX_CAPACITY: usize = 256;
const IDENTITY_CAPACITY: usize = 16;
const MAX_MESSAGES_PER_WINDOW: u32 = 120;
const HEADER_TIMEOUT: Duration = Duration::from_secs(5);
const GREETING_TIMEOUT: Duration = Duration::from_secs(10);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const MESSAGE_WINDOW: Duration = Duration::from_secs(1);
const MIN_TICK_DELAY: Duration = Duration::from_millis(1);
const MOVEMENT_SIGNAL_PREFIX: &str = "movement\n";
const MAX_MOVEMENT_OFFER_BYTES: usize = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ClientId(pub u64);

#[derive(Clone)]
pub struct Client {
    pub id: ClientId,
    pub socket: WebSocket,
}

/// The only owner of gameplay state. Calls run in socket inbox order.
pub trait Session: 'static {
    fn receive(&mut self, client: &Client, control: Control);
    fn disconnect(&mut self, client: &Client);
    fn tick(&mut self, ticks: u64);
    fn identity_preview(&mut self, private_id: &str) -> io::Result<Option<serde_json::Value>>;
    fn shutdown(&mut self, deadline: Instant) -> impl Future<Output = io::Result<()>> + Send;
}

pub struct ServerOptions<F> {
    pub production: bool,
    pub storage_available: F,
    pub movement: Option<MovementTransport>,
}

struct Lifecycle {
    stop: CancellationToken,
    deadline: OnceLock<Instant>,
}

impl Lifecycle {
    fn stop(&self, deadline: Instant) {
        let _ = self.deadline.set(deadline);
        self.stop.cancel();
    }

    fn deadline(&self) -> Instant {
        self.deadline.get().copied().unwrap_or_else(Instant::now)
    }
}

pub struct GameServer {
    address: SocketAddr,
    lifecycle: Arc<Lifecycle>,
    session_task: JoinHandle<io::Result<()>>,
    http_task: JoinHandle<io::Result<()>>,
}

impl GameServer {
    pub fn start<S, F>(
        listener: TcpListener,
        assets: Router,
        session: S,
        catalog: Arc<Catalog>,
        options: ServerOptions<F>,
    ) -> io::Result<Self>
    where
        S: Session + Send,
        F: Fn() -> bool + Send + Sync + 'static,
    {
        let (owner, server) = prepare_server(listener, assets, catalog, options)?;
        let task = tokio::spawn(owner.run(session));
        Ok(server.attach(task))
    }

    /// Keep a session with single-threaded caches on the supplied owner thread.
    pub fn start_local<S, F>(
        local: &tokio::task::LocalSet,
        listener: TcpListener,
        assets: Router,
        session: S,
        catalog: Arc<Catalog>,
        options: ServerOptions<F>,
    ) -> io::Result<Self>
    where
        S: Session,
        F: Fn() -> bool + Send + Sync + 'static,
    {
        let (owner, server) = prepare_server(listener, assets, catalog, options)?;
        let task = local.spawn_local(owner.run(session));
        Ok(server.attach(task))
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.address
    }

    pub async fn stop(mut self, deadline: Instant) -> io::Result<()> {
        self.lifecycle.stop(deadline);
        let (session, http) = tokio::join!(&mut self.session_task, &mut self.http_task);
        session
            .map_err(io::Error::other)?
            .and(http.map_err(io::Error::other)?)
    }
}

struct OwnerLoop {
    config: TickConfig,
    inbox: mpsc::Receiver<SocketEvent>,
    identities: mpsc::Receiver<IdentityRequest>,
    wake: Arc<Notify>,
    lifecycle: Arc<Lifecycle>,
}

impl OwnerLoop {
    async fn run(self, session: impl Session) -> io::Result<()> {
        run_session(
            session,
            self.config,
            self.inbox,
            self.identities,
            self.wake,
            self.lifecycle,
        )
        .await
    }
}

struct ListeningServer {
    address: SocketAddr,
    lifecycle: Arc<Lifecycle>,
    task: JoinHandle<io::Result<()>>,
}

impl ListeningServer {
    fn attach(self, session_task: JoinHandle<io::Result<()>>) -> GameServer {
        GameServer {
            address: self.address,
            lifecycle: self.lifecycle,
            session_task,
            http_task: self.task,
        }
    }
}

fn prepare_server<F>(
    listener: TcpListener,
    assets: Router,
    catalog: Arc<Catalog>,
    options: ServerOptions<F>,
) -> io::Result<(OwnerLoop, ListeningServer)>
where
    F: Fn() -> bool + Send + Sync + 'static,
{
    let config = TickConfig::from_catalog(&catalog)?;
    let address = listener.local_addr()?;
    let (events, inbox) = mpsc::channel(INBOX_CAPACITY);
    let (identities, identity_inbox) = mpsc::channel(IDENTITY_CAPACITY);
    let lifecycle = Arc::new(Lifecycle {
        stop: CancellationToken::new(),
        deadline: OnceLock::new(),
    });
    let wake = Arc::new(Notify::new());
    let state = Arc::new(RequestState {
        events,
        identities,
        wake: Arc::clone(&wake),
        stop: lifecycle.stop.clone(),
        client_slots: Arc::new(Semaphore::new(MAX_CLIENTS)),
        next_client: AtomicU64::new(1),
        catalog,
        production: options.production,
        storage_available: options.storage_available,
        movement: options.movement,
    });
    let router = assets.layer(middleware::from_fn_with_state(state, dispatch));
    let task = tokio::spawn(serve_http(listener, router, Arc::clone(&lifecycle)));
    let owner = OwnerLoop {
        config,
        inbox,
        identities: identity_inbox,
        wake,
        lifecycle: Arc::clone(&lifecycle),
    };
    Ok((
        owner,
        ListeningServer {
            address,
            lifecycle,
            task,
        },
    ))
}

impl Drop for GameServer {
    fn drop(&mut self) {
        self.lifecycle.stop(Instant::now());
    }
}

enum SocketEvent {
    Connected(Client),
    Control { id: ClientId, control: Control },
    Disconnected(ClientId),
}

impl SocketEvent {
    fn wakes_session(&self) -> bool {
        !matches!(
            self,
            Self::Control {
                control: Control::Input { .. } | Control::SnapshotAck { .. },
                ..
            }
        )
    }
}

struct IdentityRequest {
    private_id: String,
    result: oneshot::Sender<io::Result<Option<serde_json::Value>>>,
}

struct RequestState<F> {
    events: mpsc::Sender<SocketEvent>,
    identities: mpsc::Sender<IdentityRequest>,
    wake: Arc<Notify>,
    stop: CancellationToken,
    client_slots: Arc<Semaphore>,
    next_client: AtomicU64,
    catalog: Arc<Catalog>,
    production: bool,
    storage_available: F,
    movement: Option<MovementTransport>,
}

impl<F> RequestState<F> {
    async fn enqueue(&self, event: SocketEvent) -> bool {
        let wake = event.wakes_session();
        let sent = tokio::select! {
            biased;
            () = self.stop.cancelled() => false,
            sent = self.events.send(event) => sent.is_ok(),
        };
        if sent && wake {
            self.wake.notify_one();
        }
        sent
    }
}

async fn dispatch<F>(
    State(state): State<Arc<RequestState<F>>>,
    request: Request,
    next: Next,
) -> Response
where
    F: Fn() -> bool + Send + Sync + 'static,
{
    if request.uri().path() == "/api/identity" {
        return handle_identity(&state, request).await;
    }
    if request.uri().path() == "/healthz" && !(state.storage_available)() {
        return http_error(StatusCode::SERVICE_UNAVAILABLE, "Storage unavailable\n");
    }
    let upgrade = request
        .headers()
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok());
    if !upgrade.is_some_and(|upgrade| upgrade.eq_ignore_ascii_case("websocket")) {
        return next.run(request).await;
    }

    let Ok(permit) = Arc::clone(&state.client_slots).try_acquire_owned() else {
        return http_error(StatusCode::SERVICE_UNAVAILABLE, "Server full\n");
    };
    websocket::upgrade(request, state.production, move |socket, reader| {
        read_connection(state, permit, socket, reader)
    })
}

fn http_error(status: StatusCode, message: &'static str) -> Response {
    (
        status,
        [(header::X_CONTENT_TYPE_OPTIONS, "nosniff")],
        message,
    )
        .into_response()
}

async fn handle_identity<F>(state: &RequestState<F>, request: Request) -> Response {
    let mut response = identity_response(state, request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn identity_response<F>(state: &RequestState<F>, request: Request) -> Response {
    if request.method() != Method::POST {
        let mut response = http_error(StatusCode::METHOD_NOT_ALLOWED, "POST required\n");
        response
            .headers_mut()
            .insert(header::ALLOW, HeaderValue::from_static("POST"));
        return response;
    }

    let Ok(body) = to_bytes(request.into_body(), 64).await else {
        return http_error(StatusCode::BAD_REQUEST, "Invalid ID\n");
    };
    let Some(private_id) = std::str::from_utf8(&body)
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| parse_uuid(value).is_some())
    else {
        return http_error(StatusCode::BAD_REQUEST, "Invalid ID\n");
    };

    let (send, result) = oneshot::channel();
    let request = IdentityRequest {
        private_id,
        result: send,
    };
    let sent = tokio::select! {
        biased;
        () = state.stop.cancelled() => false,
        sent = state.identities.send(request) => sent.is_ok(),
    };
    if !sent {
        return http_error(StatusCode::SERVICE_UNAVAILABLE, "Server unavailable\n");
    }

    let result = tokio::select! {
        biased;
        () = state.stop.cancelled() => None,
        result = result => result.ok(),
    };
    match result {
        Some(Ok(Some(preview))) => {
            let json = format!("{preview}\n");
            ([(header::CONTENT_TYPE, "application/json")], json).into_response()
        }
        Some(Ok(None)) => http_error(StatusCode::NOT_FOUND, "Unknown ID\n"),
        Some(Err(_)) | None => http_error(StatusCode::SERVICE_UNAVAILABLE, "Server unavailable\n"),
    }
}

struct ReadWindow {
    greeted: bool,
    start: Instant,
    messages: u32,
}

impl ReadWindow {
    fn count_message(&mut self, now: Instant) -> Result<(), (u16, &'static str)> {
        if now - self.start >= MESSAGE_WINDOW {
            self.start = now;
            self.messages = 0;
        }
        self.messages += 1;
        if self.messages > MAX_MESSAGES_PER_WINDOW {
            return Err((1008, "Message limit"));
        }
        Ok(())
    }

    fn control(
        &mut self,
        kind: MessageKind,
        data: &[u8],
        now: Instant,
        protocol: &Protocol,
        step: f64,
    ) -> Result<Control, (u16, &'static str)> {
        self.count_message(now)?;
        if kind != MessageKind::Binary {
            return Err((1008, "Message limit"));
        }

        let control =
            decode_client_control(data, protocol, step).map_err(|_| (1007, "Invalid message"))?;
        if matches!(control, Control::Hello { .. } | Control::Prepare { .. }) {
            if self.greeted {
                return Err((1008, "Already joined"));
            }
            self.greeted = true;
        }
        Ok(control)
    }
}

async fn read_connection<F>(
    state: Arc<RequestState<F>>,
    _slot: OwnedSemaphorePermit,
    mut socket: WebSocket,
    mut reader: WebSocketReader,
) where
    F: Send + Sync + 'static,
{
    let id = ClientId(state.next_client.fetch_add(1, Ordering::Relaxed));
    let movement_enabled = socket.configure_movement(state.movement.is_some());
    if !state
        .enqueue(SocketEvent::Connected(Client {
            id,
            socket: socket.clone(),
        }))
        .await
    {
        socket.terminate();
        return;
    }

    let greeting = tokio::spawn({
        let socket = socket.clone();
        async move {
            sleep(GREETING_TIMEOUT).await;
            socket.close_with(1008, "Hello timeout");
        }
    });
    let mut window = ReadWindow {
        greeted: false,
        start: Instant::now(),
        messages: 0,
    };
    let mut bytes = Vec::new();
    let step = state.catalog.simulation.simulation_step;
    let mut movement = state.movement.as_ref();
    while let Ok((kind, payload)) = reader.read_message_into(&mut bytes).await {
        let now = Instant::now();
        if kind == MessageKind::Text
            && movement_enabled
            && let Some(offer) = payload.strip_prefix(MOVEMENT_SIGNAL_PREFIX.as_bytes())
        {
            if let Err((code, reason)) = window.count_message(now) {
                socket.close_with(code, reason);
                break;
            }
            if payload.len() <= MAX_MOVEMENT_OFFER_BYTES
                && let Ok(offer) = std::str::from_utf8(offer)
                && let Some(cancellation) = socket.movement_negotiation()
                && let Some(transport) = movement.take()
            {
                let transport = transport.clone();
                let offer = offer.to_owned();
                let cancellation = cancellation.clone();
                let socket = socket.clone();
                tokio::spawn(async move {
                    if let Ok(Ok((answer, sender))) = timeout_at(
                        now + Duration::from_secs(2),
                        transport.offer(offer, cancellation),
                    )
                    .await
                        && socket.is_open()
                    {
                        socket.attach_movement(sender);
                        let _ = socket.send_text(&format!("{MOVEMENT_SIGNAL_PREFIX}{answer}"));
                    }
                });
            }
            continue;
        }
        let greeted = window.greeted;
        let control = match window.control(kind, payload, now, &state.catalog.protocol, step) {
            Ok(control) => control,
            Err((code, reason)) => {
                socket.close_with(code, reason);
                break;
            }
        };
        if !greeted && window.greeted {
            greeting.abort();
        }
        if !state.enqueue(SocketEvent::Control { id, control }).await {
            break;
        }
    }
    greeting.abort();
    socket.finish().await;
    state.enqueue(SocketEvent::Disconnected(id)).await;
}

#[derive(Clone, Copy)]
struct TickConfig {
    period: Duration,
    max_catch_up: u32,
}

impl TickConfig {
    fn from_catalog(catalog: &Catalog) -> io::Result<Self> {
        let step = catalog.simulation.simulation_step;
        let nanos = (step * 1_000_000_000.0) as i64;
        let max_catch_up = catalog.simulation.max_catch_up_ticks;
        if !step.is_finite() || nanos <= 0 || max_catch_up <= 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid simulation tick configuration",
            ));
        }
        Ok(Self {
            period: Duration::from_nanos(nanos as u64),
            max_catch_up: max_catch_up as u32,
        })
    }

    fn ticks_due(self, next: Instant, now: Instant) -> u32 {
        let missed = now.saturating_duration_since(next).as_nanos() / self.period.as_nanos();
        (missed + 1).min(u128::from(self.max_catch_up)) as u32
    }
}

struct Connected {
    client: Client,
    last_ping: Option<Instant>,
}

fn drain(
    session: &mut impl Session,
    clients: &mut HashMap<ClientId, Connected>,
    events: &mut mpsc::Receiver<SocketEvent>,
) {
    // Bound each drain so a busy inbox cannot starve the simulation clock.
    for _ in 0..INBOX_CAPACITY {
        match events.try_recv() {
            Ok(SocketEvent::Connected(client)) => {
                clients.insert(
                    client.id,
                    Connected {
                        client,
                        last_ping: None,
                    },
                );
            }
            Ok(SocketEvent::Control { id, control }) => {
                if let Some(connection) = clients.get(&id) {
                    session.receive(&connection.client, control);
                }
            }
            Ok(SocketEvent::Disconnected(id)) => {
                if let Some(connection) = clients.remove(&id) {
                    session.disconnect(&connection.client);
                }
            }
            Err(_) => break,
        }
    }
}

async fn run_session(
    mut session: impl Session,
    config: TickConfig,
    mut events: mpsc::Receiver<SocketEvent>,
    mut identities: mpsc::Receiver<IdentityRequest>,
    wake: Arc<Notify>,
    lifecycle: Arc<Lifecycle>,
) -> io::Result<()> {
    let mut clients = HashMap::<ClientId, Connected>::new();
    let start = Instant::now();
    let mut next = start + config.period;
    let mut timer = TickTimer::new(next);
    let mut heartbeat = interval_at(start + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            () = lifecycle.stop.cancelled() => {
                for connection in clients.values() {
                    session.disconnect(&connection.client);
                    connection.client.socket.terminate();
                }
                return timeout_at(lifecycle.deadline(), session.shutdown(lifecycle.deadline()))
                    .await
                    .map_err(io::Error::other)?;
            }
            Some(request) = identities.recv() => {
                let result = session.identity_preview(&request.private_id);
                if let Err(error) = &result {
                    eprintln!("read player identity: {error}");
                }
                let _ = request.result.send(result);
            }
            () = wake.notified() => {
                drain(&mut session, &mut clients, &mut events);
            }
            now = heartbeat.tick() => {
                for connection in clients.values_mut() {
                    let socket = &connection.client.socket;
                    if connection.last_ping.is_some_and(|ping| socket.last_pong() < ping.into_std()) {
                        socket.terminate();
                    } else {
                        connection.last_ping = Some(now);
                        if socket.ping().is_err() {
                            socket.terminate();
                        }
                    }
                }
            }
            ready = timer.wait() => {
                ready?;
                drain(&mut session, &mut clients, &mut events);
                let ticks = config.ticks_due(next, Instant::now());
                session.tick(u64::from(ticks));
                next += config.period * ticks;
                let now = Instant::now();
                timer.reset(next.max(now + MIN_TICK_DELAY))?;
            }
        }
    }
}

async fn serve_http(
    listener: TcpListener,
    router: Router,
    lifecycle: Arc<Lifecycle>,
) -> io::Result<()> {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            () = lifecycle.stop.cancelled() => break,
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
            result = listener.accept() => {
                let (socket, _) = result?;
                if socket.set_nodelay(true).is_err() {
                    continue;
                }
                let service = TowerToHyperService::new(router.clone());
                let stop = lifecycle.stop.clone();
                connections.spawn(async move {
                    let mut connection = std::pin::pin!(http1::Builder::new()
                        .timer(TokioTimer::new())
                        .header_read_timeout(HEADER_TIMEOUT)
                        .serve_connection(TokioIo::new(socket), service)
                        .with_upgrades());
                    tokio::select! {
                        _ = &mut connection => {}
                        () = stop.cancelled() => {
                            connection.as_mut().graceful_shutdown();
                            let _ = connection.await;
                        }
                    }
                });
            }
        }
    }

    // Drop the listener before waiting on existing requests.
    drop(listener);
    timeout_at(lifecycle.deadline(), async {
        while connections.join_next().await.is_some() {}
    })
    .await
    .map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;
    use tokio::time::timeout;

    use super::*;

    #[test]
    fn change_messages_wake_owner_but_inputs_and_receipts_wait_for_ticks() {
        let id = ClientId(1);
        for (control, wakes) in [
            (Control::Play, true),
            (Control::Prepare { player_token: None }, true),
            (Control::SnapshotAck { sequence: 2 }, false),
            (
                Control::Input {
                    tick: 4,
                    sequence: 3,
                    input: Default::default(),
                    offset: None,
                },
                false,
            ),
        ] {
            assert_eq!(SocketEvent::Control { id, control }.wakes_session(), wakes);
        }
        assert!(SocketEvent::Disconnected(id).wakes_session());
    }

    #[test]
    fn fixed_tick_catch_up_uses_current_deadline_and_preserves_cap() {
        let now = Instant::now();
        let config = TickConfig {
            period: Duration::from_millis(20),
            max_catch_up: 3,
        };
        let next = now + config.period;
        assert_eq!(config.ticks_due(next, now), 1);
        assert_eq!(config.ticks_due(next, next), 1);
        assert_eq!(config.ticks_due(next, next + Duration::from_millis(19)), 1);
        assert_eq!(config.ticks_due(next, next + Duration::from_millis(20)), 2);
        assert_eq!(config.ticks_due(next, next + Duration::from_millis(40)), 3);
        assert_eq!(config.ticks_due(next, next + Duration::from_secs(30)), 3);
    }

    #[test]
    fn session_message_policy_preserves_read_limits_and_greeting() {
        let catalog = Catalog::load().unwrap();
        let step = catalog.simulation.simulation_step;
        let protocol = &catalog.protocol;
        let now = Instant::now();
        let mut window = ReadWindow {
            greeted: false,
            start: now,
            messages: 0,
        };

        let play = [0x55, 0x43, 1, protocol.control_message_ids["play"] as u8];
        for _ in 0..MAX_MESSAGES_PER_WINDOW {
            assert_eq!(
                window.control(MessageKind::Binary, &play, now, protocol, step),
                Ok(Control::Play),
            );
        }
        assert_eq!(
            window.control(
                MessageKind::Binary,
                &play,
                now + Duration::from_millis(999),
                protocol,
                step
            ),
            Err((1008, "Message limit")),
        );
        assert_eq!(
            window.control(
                MessageKind::Binary,
                &play,
                now + MESSAGE_WINDOW,
                protocol,
                step
            ),
            Ok(Control::Play),
        );
        assert_eq!(
            window.control(
                MessageKind::Text,
                &play,
                now + MESSAGE_WINDOW,
                protocol,
                step
            ),
            Err((1008, "Message limit")),
        );
        assert_eq!(
            window.control(
                MessageKind::Binary,
                &play[..3],
                now + MESSAGE_WINDOW,
                protocol,
                step
            ),
            Err((1007, "Invalid message")),
        );

        let prepare = [
            0x55,
            0x43,
            1,
            protocol.control_message_ids["prepare"] as u8,
            0,
        ];
        let hello = [
            0x55,
            0x43,
            1,
            protocol.control_message_ids["hello"] as u8,
            0,
        ];
        assert_eq!(
            window.control(
                MessageKind::Binary,
                &prepare,
                now + MESSAGE_WINDOW,
                protocol,
                step
            ),
            Ok(Control::Prepare { player_token: None }),
        );
        assert_eq!(
            window.control(
                MessageKind::Binary,
                &hello,
                now + MESSAGE_WINDOW,
                protocol,
                step
            ),
            Err((1008, "Already joined")),
        );
    }

    fn identity_request(method: Method, text: String) -> Request {
        HttpRequest::builder()
            .method(method)
            .uri("/api/identity")
            .body(Body::from(text))
            .unwrap()
    }

    #[tokio::test]
    async fn public_identity_endpoint_validates_and_uses_owner_inbox() {
        let catalog = Arc::new(Catalog::load().unwrap());
        let (events, _inbox) = mpsc::channel(INBOX_CAPACITY);
        let (identities, mut requests) = mpsc::channel(IDENTITY_CAPACITY);
        let state = RequestState {
            events,
            identities,
            wake: Arc::new(Notify::new()),
            stop: CancellationToken::new(),
            client_slots: Arc::new(Semaphore::new(MAX_CLIENTS)),
            next_client: AtomicU64::new(1),
            catalog,
            production: true,
            storage_available: || true,
            movement: None,
        };

        let not_post = handle_identity(&state, identity_request(Method::GET, String::new())).await;
        assert_eq!(not_post.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(not_post.headers()[header::ALLOW], "POST");
        assert_eq!(not_post.headers()[header::CACHE_CONTROL], "no-store");

        for invalid in ["invalid".to_owned(), "a".repeat(65)] {
            let rejected = handle_identity(&state, identity_request(Method::POST, invalid)).await;
            assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
            assert!(requests.try_recv().is_err());
        }

        let respond = tokio::spawn(async move {
            let request = requests.recv().await.unwrap();
            assert_eq!(request.private_id, "12345678-abcd-1234-1234-123456789abc");
            request
                .result
                .send(Ok(Some(serde_json::json!([
                    "Pilot",
                    500,
                    ["mustang", -1, [], []]
                ]))))
                .unwrap();
            requests
                .recv()
                .await
                .unwrap()
                .result
                .send(Ok(None))
                .unwrap();
            requests
                .recv()
                .await
                .unwrap()
                .result
                .send(Err(io::Error::other("identity read failed")))
                .unwrap();
        });
        let known_id = "  12345678-ABCD-1234-1234-123456789ABC\n";
        let response =
            handle_identity(&state, identity_request(Method::POST, known_id.into())).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            HeaderValue::from_static("application/json")
        );
        assert_eq!(
            to_bytes(response.into_body(), 128).await.unwrap(),
            b"[\"Pilot\",500,[\"mustang\",-1,[],[]]]\n".as_slice(),
        );

        let unknown =
            handle_identity(&state, identity_request(Method::POST, known_id.into())).await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
        assert_eq!(unknown.headers()[header::CACHE_CONTROL], "no-store");

        let unavailable =
            handle_identity(&state, identity_request(Method::POST, known_id.into())).await;
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(unavailable.headers()[header::CACHE_CONTROL], "no-store");
        respond.await.unwrap();

        state.stop.cancel();
        let stopped =
            handle_identity(&state, identity_request(Method::POST, known_id.into())).await;
        assert_eq!(stopped.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[derive(Debug, PartialEq)]
    enum Call {
        Receive(ClientId, Control),
        Disconnect(ClientId),
        Tick(u64),
        Shutdown,
    }

    struct Recorder(
        mpsc::UnboundedSender<Call>,
        Option<mpsc::UnboundedSender<WebSocket>>,
    );

    impl Session for Recorder {
        fn receive(&mut self, client: &Client, control: Control) {
            if matches!(control, Control::Hello { .. })
                && let Some(sockets) = &self.1
            {
                sockets.send(client.socket.clone()).unwrap();
            }
            self.0.send(Call::Receive(client.id, control)).unwrap();
        }

        fn disconnect(&mut self, client: &Client) {
            self.0.send(Call::Disconnect(client.id)).unwrap();
        }

        fn tick(&mut self, ticks: u64) {
            self.0.send(Call::Tick(ticks)).unwrap();
        }

        fn identity_preview(&mut self, _private_id: &str) -> io::Result<Option<serde_json::Value>> {
            Ok(None)
        }

        async fn shutdown(&mut self, _deadline: Instant) -> io::Result<()> {
            self.0.send(Call::Shutdown).unwrap();
            Ok(())
        }
    }

    async fn masked_client_packet(socket: &mut TcpStream, opcode: u8, packet: &[u8]) {
        let mask = [1, 2, 3, 4];
        let mut frame = vec![0x80 | opcode];
        if packet.len() < 126 {
            frame.push(0x80 | packet.len() as u8);
        } else {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(packet.len() as u16).to_be_bytes());
        }
        frame.extend_from_slice(&mask);
        frame.extend(
            packet
                .iter()
                .enumerate()
                .map(|(index, byte)| byte ^ mask[index & 3]),
        );
        socket.write_all(&frame).await.unwrap();
    }

    async fn open_test_socket(server: &GameServer, path: &str) -> BufReader<TcpStream> {
        let connection = TcpStream::connect(server.local_addr()).await.unwrap();
        let mut client = BufReader::new(connection);
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: https://example.com\r\n\r\n"
        );
        client
            .get_mut()
            .write_all(request.as_bytes())
            .await
            .unwrap();

        let mut line = String::new();
        client.read_line(&mut line).await.unwrap();
        assert!(line.contains("101 Switching Protocols"), "{line}");
        loop {
            line.clear();
            assert_ne!(client.read_line(&mut line).await.unwrap(), 0);
            if line == "\r\n" {
                break;
            }
        }
        client
    }

    #[tokio::test]
    #[ignore = "requires opening a loopback TCP listener"]
    async fn real_socket_inbox_drains_in_order_and_publishes_disconnect() {
        let mut catalog = Catalog::load().unwrap();
        catalog.simulation.simulation_step = 30.0;
        let catalog = Arc::new(catalog);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (observe, mut observed) = mpsc::unbounded_channel();
        let server = GameServer::start(
            listener,
            Router::new(),
            Recorder(observe, None),
            Arc::clone(&catalog),
            ServerOptions {
                production: true,
                storage_available: || true,
                movement: None,
            },
        )
        .unwrap();

        let deadline = Duration::from_secs(2);
        let mut client = timeout(deadline, open_test_socket(&server, "/game-socket"))
            .await
            .unwrap();

        let id = ClientId(1);
        let control_id = |name| catalog.protocol.control_message_ids[name] as u8;
        let hello = [0x55, 0x43, 1, control_id("hello"), 0];
        let input = [0x55, 0x43, 1, control_id("input"), 7, 8, 0, 0, 0];
        let ack = [0x55, 0x43, 1, control_id("snapshotAck"), 9];
        let activity = [0x55, 0x43, 1, control_id("activity")];
        masked_client_packet(client.get_mut(), 2, &hello).await;
        assert_eq!(
            timeout(deadline, observed.recv()).await.unwrap(),
            Some(Call::Receive(id, Control::Hello { player_token: None })),
        );

        masked_client_packet(client.get_mut(), 2, &input).await;
        masked_client_packet(client.get_mut(), 2, &ack).await;
        masked_client_packet(client.get_mut(), 2, &activity).await;
        for packet in [input.as_slice(), ack.as_slice(), activity.as_slice()] {
            let expected = decode_client_control(packet, &catalog.protocol, 30.0).unwrap();
            assert_eq!(
                timeout(deadline, observed.recv()).await.unwrap(),
                Some(Call::Receive(id, expected))
            );
        }

        masked_client_packet(client.get_mut(), 2, &hello).await;
        let mut close = [0; 18];
        timeout(deadline, client.read_exact(&mut close))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&close, b"\x88\x10\x03\xf0Already joined");
        assert_eq!(
            timeout(deadline, observed.recv()).await.unwrap(),
            Some(Call::Disconnect(id))
        );
        server.stop(Instant::now() + deadline).await.unwrap();
        assert_eq!(observed.recv().await, Some(Call::Shutdown));
    }

    #[tokio::test]
    #[ignore = "requires opening loopback TCP and UDP sockets"]
    async fn movement_waits_for_session_authorization() {
        let local = tokio::task::LocalSet::new();
        let loopback = "127.0.0.1:0".parse().unwrap();

        let deadline = Duration::from_secs(3);
        timeout(
            deadline,
            local.run_until(async {
                let movement = MovementTransport::start(&local, loopback, loopback)
                    .await
                    .unwrap();
                let listener = TcpListener::bind(loopback).await.unwrap();
                let mut catalog = Catalog::load().unwrap();
                catalog.simulation.simulation_step = 30.0;
                let catalog = Arc::new(catalog);
                let (observe, mut observed) = mpsc::unbounded_channel();
                let (greeted, mut sockets) = mpsc::unbounded_channel();
                let server = GameServer::start(
                    listener,
                    Router::new(),
                    Recorder(observe, Some(greeted)),
                    Arc::clone(&catalog),
                    ServerOptions {
                        production: true,
                        storage_available: || true,
                        movement: Some(movement),
                    },
                )
                .unwrap();

                let control_id = |name| catalog.protocol.control_message_ids[name] as u8;
                let hello = [0x55, 0x43, 1, control_id("hello"), 0];
                let activity = [0x55, 0x43, 1, control_id("activity")];
                let mut browser = str0m::Rtc::new(std::time::Instant::now());
                let mut changes = browser.sdp_api();
                changes.add_channel("movement".into());
                let (offer, _) = changes.apply().unwrap();
                let offer = format!("{MOVEMENT_SIGNAL_PREFIX}{}", offer.to_sdp_string());

                for authorized in [false, true] {
                    let mut client =
                        open_test_socket(&server, "/game-socket?snapshotDeltas=1&movement=1").await;
                    masked_client_packet(client.get_mut(), 2, &hello).await;
                    masked_client_packet(client.get_mut(), 1, offer.as_bytes()).await;
                    masked_client_packet(client.get_mut(), 2, &activity).await;
                    let socket = sockets.recv().await.unwrap();
                    assert!(matches!(
                        observed.recv().await,
                        Some(Call::Receive(_, Control::Hello { .. }))
                    ));
                    assert!(matches!(
                        observed.recv().await,
                        Some(Call::Receive(_, Control::Activity))
                    ));

                    if authorized {
                        socket.advertise_movement();
                        let mut advertisement = [0; 10];
                        client.read_exact(&mut advertisement).await.unwrap();
                        assert_eq!(&advertisement, b"\x81\x08movement");
                        masked_client_packet(client.get_mut(), 1, offer.as_bytes()).await;
                        assert_eq!(client.read_u8().await.unwrap(), 0x81);
                        assert_eq!(client.read_u8().await.unwrap(), 126);
                        let length = usize::from(client.read_u16().await.unwrap());
                        let mut answer = vec![0; length];
                        client.read_exact(&mut answer).await.unwrap();
                        assert!(answer.starts_with(b"movement\nv=0\r\n"));
                    } else {
                        socket.close_with(4003, "Banned");
                        let mut close = [0; 10];
                        client.read_exact(&mut close).await.unwrap();
                        assert_eq!(&close, b"\x88\x08\x0f\xa3Banned");
                    }

                    drop(client);
                    assert!(matches!(observed.recv().await, Some(Call::Disconnect(_))));
                }
                server.stop(Instant::now() + deadline).await.unwrap();
            }),
        )
        .await
        .unwrap();
    }
}
