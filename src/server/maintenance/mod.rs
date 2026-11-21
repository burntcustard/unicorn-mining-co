mod cpu_profile;

use std::fs::{self, DirBuilder, Permissions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::{Engine, engine::general_purpose::STANDARD};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{Semaphore, mpsc, oneshot};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;

#[derive(Clone, Copy)]
pub enum Action {
    Reset,
    Resume,
    CpuProfile(u8),
}

pub struct Call {
    pub action: Action,
    reply: oneshot::Sender<Response>,
}

impl Call {
    pub fn respond(self, reply: impl IntoResponse) {
        let _ = self.reply.send(reply.into_response());
    }

    pub async fn profile(mut self, seconds: u8) {
        tokio::select! {
            () = self.reply.closed() => {}
            result = cpu_profile::capture(seconds) => {
                match result {
                    Ok(profile) => self.respond((
                        [(header::CONTENT_TYPE, "application/octet-stream")],
                        profile,
                    )),
                    Err(error) if matches!(
                        error.downcast_ref::<rpprof::Error>(),
                        Some(rpprof::Error::Running),
                    ) => self.respond((StatusCode::CONFLICT, "CPU profiler is already active\n")),
                    Err(error) => self.respond((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("CPU profiling failed: {error}\n"),
                    )),
                }
            }
        }
    }
}

pub struct Maintenance {
    socket: PathBuf,
    device: u64,
    inode: u64,
    task: JoinHandle<()>,
    inbox: mpsc::Receiver<Call>,
}

impl Maintenance {
    pub async fn start(database: &Path) -> io::Result<Self> {
        let socket = socket_path(database);
        if let Some(parent) = socket
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            DirBuilder::new()
                .mode(0o700)
                .recursive(true)
                .create(parent)?;
        }
        remove_stale_socket(&socket).await?;
        let listener = UnixListener::bind(&socket)?;
        let metadata = fs::symlink_metadata(&socket)?;
        let (sender, inbox) = mpsc::channel(1);
        let task = tokio::spawn(listen(listener, sender));
        let service = Self {
            socket,
            device: metadata.dev(),
            inode: metadata.ino(),
            task,
            inbox,
        };
        fs::set_permissions(&service.socket, Permissions::from_mode(0o600))?;
        Ok(service)
    }

    pub async fn next(&mut self) -> Option<Call> {
        self.inbox.recv().await
    }
}

impl Drop for Maintenance {
    fn drop(&mut self) {
        self.task.abort();
        if fs::symlink_metadata(&self.socket).is_ok_and(|file| {
            file.file_type().is_socket() && file.dev() == self.device && file.ino() == self.inode
        }) {
            let _ = fs::remove_file(&self.socket);
        }
    }
}

fn socket_path(database: &Path) -> PathBuf {
    let mut socket = database.as_os_str().to_owned();
    socket.push(".control.sock");
    socket.into()
}

async fn remove_stale_socket(path: &Path) -> io::Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !metadata.file_type().is_socket() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "maintenance path is occupied by a non-socket file",
        ));
    }
    match timeout(Duration::from_secs(1), UnixStream::connect(path)).await? {
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "a live maintenance service already owns this socket",
        )),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::ConnectionRefused | io::ErrorKind::NotFound
            ) =>
        {
            if fs::symlink_metadata(path).is_ok_and(|current| {
                current.dev() == metadata.dev() && current.ino() == metadata.ino()
            }) {
                fs::remove_file(path)?;
            }
            Ok(())
        }
        Err(error) => Err(error),
    }
}

async fn listen(listener: UnixListener, sender: mpsc::Sender<Call>) {
    let available = Arc::new(Semaphore::new(1));
    let mut connections = JoinSet::new();
    loop {
        let stream = tokio::select! {
            accepted = listener.accept(), if connections.len() < 16 => {
                match accepted {
                    Ok((stream, _)) => stream,
                    Err(error) => {
                        eprintln!("Maintenance listener failed: {error}");
                        break;
                    }
                }
            }
            _ = connections.join_next(), if !connections.is_empty() => continue,
        };
        let available = Arc::clone(&available);
        let sender = sender.clone();
        connections.spawn(async move {
            let service = service_fn(|request| {
                let available = Arc::clone(&available);
                let sender = sender.clone();
                async move {
                    Ok::<_, std::convert::Infallible>(dispatch(request, available, sender).await)
                }
            });
            let _ = http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(Duration::from_secs(5))
                .keep_alive(false)
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

async fn dispatch(
    request: Request<Incoming>,
    available: Arc<Semaphore>,
    sender: mpsc::Sender<Call>,
) -> Response {
    let path = request.uri().path();
    if !matches!(path, "/reset-world" | "/resume-world" | "/cpu-profile") {
        return StatusCode::NOT_FOUND.into_response();
    }
    if request.method() != Method::POST {
        return (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, "POST")],
            "Use POST for maintenance\n",
        )
            .into_response();
    }
    let Ok(_permit) = available.try_acquire_owned() else {
        return (
            StatusCode::CONFLICT,
            "Another maintenance command is in progress\n",
        )
            .into_response();
    };
    let action = match path {
        "/reset-world" => Action::Reset,
        "/resume-world" => Action::Resume,
        _ => {
            let seconds = request.uri().query().and_then(|query| {
                let value = query
                    .split('&')
                    .find_map(|pair| pair.strip_prefix("seconds="))?;
                percent_encoding::percent_decode_str(value)
                    .decode_utf8()
                    .ok()?
                    .parse()
                    .ok()
            });
            let Some(seconds @ 1..=60) = seconds else {
                return (StatusCode::BAD_REQUEST, "Choose 1-60 seconds\n").into_response();
            };
            Action::CpuProfile(seconds)
        }
    };
    let (reply, result) = oneshot::channel();
    if sender.send(Call { action, reply }).await.is_ok()
        && let Ok(reply) = result.await
    {
        return reply;
    }
    (StatusCode::SERVICE_UNAVAILABLE, "Server is shutting down\n").into_response()
}

pub async fn request(database: &Path, action: Action) -> crate::Result<()> {
    let profiling = matches!(action, Action::CpuProfile(_));
    let path = match action {
        Action::Reset => "/reset-world".into(),
        Action::Resume => "/resume-world".into(),
        Action::CpuProfile(seconds) => format!("/cpu-profile?seconds={seconds}"),
    };
    let deadline = Duration::from_secs(if profiling { 90 } else { 20 });
    let body_limit = if profiling { 8 << 20 } else { 65_536 };
    let response = timeout(deadline, async {
        let stream = UnixStream::connect(socket_path(database)).await?;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
        let _driver = tokio::spawn(connection);
        let request = Request::post(path)
            .header(header::HOST, "maintenance")
            .body(Body::empty())?;
        let response = sender.send_request(request).await?;
        let (head, body) = response.into_parts();
        let body = to_bytes(Body::new(body), body_limit).await?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>((head.status, body))
    })
    .await
    .map_err(|_| {
        if profiling {
            "CPU profile request timed out"
        } else {
            "maintenance request timed out; check game status before sending another reset"
        }
    })??;
    if !response.0.is_success() {
        return Err(format!(
            "maintenance returned {}: {}",
            response.0,
            String::from_utf8_lossy(&response.1).trim_end()
        )
        .into());
    }
    let mut output = io::stdout().lock();
    if profiling {
        output.write_all(STANDARD.encode(response.1).as_bytes())?;
    } else {
        output.write_all(&response.1)?;
    }
    Ok(())
}
