use std::env;
use std::error::Error;
use std::net::Ipv4Addr;

use tokio::net::TcpListener;
use unicorn_mining_server::http::asset_router;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let port = env::var("PORT")
        .unwrap_or_else(|_| "3001".into())
        .parse::<u16>()?;
    let assets = env::var_os("ASSET_DIR").unwrap_or_else(|| "dist".into());
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await?;
    axum::serve(listener, asset_router(assets)?).await?;
    Ok(())
}
