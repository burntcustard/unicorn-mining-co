use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::http::StatusCode;
use tokio::net::{TcpListener, lookup_host};
use tokio::signal::unix::{SignalKind, signal};
use tokio::task::{JoinSet, LocalSet};
use tokio::time::Instant;
use unicorn_mining_server::game_server::{GameServer, ServerOptions};
use unicorn_mining_server::game_session::authoritative::AuthoritativeSession;
use unicorn_mining_server::http::asset_router;
use unicorn_mining_server::movement_transport::MovementTransport;
use unicorn_mining_server::persistence::{BackupAction, manage_backups, reset};
use unicorn_mining_server::runtime::{Command, Config};
use unicorn_mining_server::specs::Catalog;

mod maintenance;

use maintenance::{Action, Call, Maintenance};

const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(8);
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn main() -> Result<()> {
    let command = Command::parse(std::env::args_os().skip(1))?;
    if command == Command::Help {
        println!(
            "unicorn-mining-server [--reset-world | --reset-world-live | --resume-world-live | --cpu-profile-live SECONDS | --backups | --delete-backup PATH | --delete-all-backups]"
        );
        return Ok(());
    }
    let config = Config::from_environment()?;
    config.prepare_volume()?;
    match command {
        Command::ResetWorld => {
            let archive = reset(&config.database)?;
            println!(
                "World reset; previous database archived in {}",
                archive.display()
            );
        }
        Command::Backups | Command::DeleteBackup(_) | Command::DeleteAllBackups => {
            let action = match &command {
                Command::DeleteBackup(path) => BackupAction::Delete(path),
                Command::DeleteAllBackups => BackupAction::DeleteAll,
                _ => BackupAction::List,
            };
            manage_backups(
                &config.database,
                &config.backups,
                action,
                &mut io::stdout().lock(),
            )?;
        }
        Command::Serve => {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()?;
            let local = LocalSet::new();
            local.block_on(&runtime, serve(&config, &local))?;
        }
        Command::ResetWorldLive | Command::ResumeWorldLive | Command::CpuProfileLive(_) => {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            let action = match command {
                Command::ResetWorldLive => Action::Reset,
                Command::ResumeWorldLive => Action::Resume,
                Command::CpuProfileLive(seconds) => Action::CpuProfile(seconds),
                _ => unreachable!(),
            };
            runtime.block_on(maintenance::request(&config.database, action))?;
        }
        Command::Help => unreachable!(),
    }
    Ok(())
}

async fn serve(config: &Config, local: &LocalSet) -> Result<()> {
    let mut catalog = Catalog::load()?;
    if !config.production {
        catalog.starting_credits = 99_999.0;
    }
    let assets = asset_router(&config.assets)?;
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    let mut maintenance = Maintenance::start(&config.database).await?;
    let mut game = ActiveGame {
        config,
        local,
        catalog: Arc::new(catalog),
        assets,
        server: None,
        movement: None,
        port: config.port,
        can_reset: true,
        archived: false,
    };
    if let Err(error) = game.start().await {
        eprintln!("Game unavailable: {error}; live maintenance remains available");
    }
    eprintln!("World maintenance ready");
    let mut profiles = JoinSet::new();
    loop {
        tokio::select! {
            _ = interrupt.recv() => break,
            _ = terminate.recv() => break,
            _ = profiles.join_next(), if !profiles.is_empty() => {}
            call = maintenance.next() => {
                let call = call.ok_or("maintenance listener stopped")?;
                game.maintain(call, &mut profiles).await;
            }
        }
    }
    drop(maintenance);
    profiles.shutdown().await;
    game.stop().await
}

struct ActiveGame<'a> {
    config: &'a Config,
    local: &'a LocalSet,
    catalog: Arc<Catalog>,
    assets: Router,
    server: Option<GameServer>,
    movement: Option<MovementTransport>,
    port: u16,
    can_reset: bool,
    archived: bool,
}

async fn start_movement(
    local: &LocalSet,
    production: bool,
    port: u16,
) -> io::Result<Option<MovementTransport>> {
    if std::env::var_os("MOVEMENT_DISABLED").is_some_and(|value| value == "1") {
        return Ok(None);
    }

    let loopback = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let (bind, public) = match (
        std::env::var("MOVEMENT_BIND_ADDRESS"),
        std::env::var("MOVEMENT_PUBLIC_ADDRESS"),
    ) {
        (Ok(bind), Ok(public)) => {
            let public: SocketAddr = public.parse().map_err(io::Error::other)?;
            let bind = lookup_host(bind)
                .await?
                .find(|bind| bind.is_ipv4() == public.is_ipv4())
                .ok_or_else(|| io::Error::other("No matching UDP bind address"))?;
            (bind, public)
        }
        (Err(std::env::VarError::NotPresent), Err(std::env::VarError::NotPresent)) => {
            if production {
                return Ok(None);
            }
            (loopback, loopback)
        }
        _ => return Err(io::Error::other("Movement needs both UDP addresses")),
    };
    MovementTransport::start(local, bind, public)
        .await
        .map(Some)
}

impl ActiveGame<'_> {
    async fn start(&mut self) -> Result<()> {
        let listener =
            TcpListener::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, self.port)).await?;
        let mut session =
            AuthoritativeSession::new(self.config.world_seed, Arc::clone(&self.catalog))?;
        session.enable_stats()?;
        #[cfg(feature = "benchmark-fixtures")]
        let benchmark = !self.config.production && session.configure_benchmarks()?;
        #[cfg(not(feature = "benchmark-fixtures"))]
        let benchmark = false;
        if !benchmark {
            session.open_player_accounts(&self.config.database, self.config.backups.clone())?;
        }
        let storage_available = session.storage_health();
        if self.movement.is_none() {
            self.movement = start_movement(
                self.local,
                self.config.production,
                listener.local_addr()?.port(),
            )
            .await
            .unwrap_or_else(|error| {
                eprintln!("Movement channel unavailable: {error}");
                None
            });
        }
        let server = GameServer::start_local(
            self.local,
            listener,
            self.assets.clone(),
            session,
            Arc::clone(&self.catalog),
            ServerOptions {
                production: self.config.production,
                storage_available,
                movement: self.movement.clone(),
            },
        )?;
        self.port = server.local_addr().port();
        eprintln!("Rust server listening on {}", server.local_addr());
        self.server = Some(server);
        self.archived = false;
        Ok(())
    }

    async fn stop(&mut self) -> Result<()> {
        if let Some(server) = self.server.take() {
            server.stop(Instant::now() + SHUTDOWN_TIMEOUT).await?;
        }
        Ok(())
    }

    async fn maintain(&mut self, call: Call, profiles: &mut JoinSet<()>) {
        let result = match call.action {
            Action::Reset if self.server.is_none() && !self.can_reset => {
                return call.respond((
                    StatusCode::CONFLICT,
                    "The game is stopped after failed maintenance; use --resume-world-live first\n",
                ));
            }
            Action::Reset => self.reset().await,
            Action::Resume => self.resume().await,
            Action::CpuProfile(_) if self.server.is_none() => {
                return call.respond((StatusCode::CONFLICT, "Game is not running\n"));
            }
            Action::CpuProfile(seconds) => {
                profiles.spawn(call.profile(seconds));
                return;
            }
        };
        call.respond(match result {
            Ok(message) => (StatusCode::OK, message),
            Err(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "Maintenance failed: {error}. Use --resume-world-live after fixing the failure.\n"
                ),
            ),
        });
    }

    async fn reset(&mut self) -> Result<String> {
        self.can_reset = false;
        self.archived = false;
        self.stop().await.map_err(|error| {
            format!("game shutdown did not flush successfully; database was not archived: {error}")
        })?;
        let archive = reset(&self.config.database)?;
        self.archived = true;
        self.start().await?;
        Ok(format!(
            "World reset complete; previous database archived in {}\n",
            archive.display()
        ))
    }

    async fn resume(&mut self) -> Result<String> {
        if self.server.is_none() {
            if !self.archived {
                self.config.database.metadata().map_err(|error| {
                    format!("original database must exist before resuming: {error}")
                })?;
            }
            self.start().await?;
        }
        Ok("Game running; no world reset was run.\n".into())
    }
}
