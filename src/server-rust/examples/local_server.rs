use std::error::Error;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::signal::unix::{SignalKind, signal};
use unicorn_mining_server::game_server::{GameServer, ServerOptions};
use unicorn_mining_server::game_session::authoritative::AuthoritativeSession;
use unicorn_mining_server::http::asset_router;
use unicorn_mining_server::specs::Catalog;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let port = args.next().map_or(Ok(0), |port| port.parse::<u16>())?;
    let database = args.next().map(PathBuf::from);
    if args.next().is_some() {
        return Err("usage: cargo run --example local_server -- [port] [database]".into());
    }
    let catalog = Arc::new(Catalog::load()?);
    let listener =
        TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)).await?;
    let mut session = AuthoritativeSession::new(25.0, Arc::clone(&catalog))?;
    if let Some(database) = database {
        let backups = database.with_extension("backups");
        session.open_player_accounts(database, backups)?;
    }
    session.enable_stats()?;
    let storage_available = session.storage_health();
    let assets = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../dist");
    let local = tokio::task::LocalSet::new();
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    let server = GameServer::start_local(
        &local,
        listener,
        asset_router(assets)?,
        session,
        catalog,
        ServerOptions {
            production: false,
            storage_available,
        },
    )?;
    println!("Rust server listening on http://{}", server.local_addr());
    local
        .run_until(async move {
            tokio::select! {
                _ = interrupt.recv() => {},
                _ = terminate.recv() => {},
            }
            server
                .stop(tokio::time::Instant::now() + Duration::from_secs(5))
                .await
        })
        .await?;
    Ok(())
}
