use std::{error::Error, io};

use unicorn_mining_server::protocol::snapshot_fixture;
use unicorn_mining_server::specs::Catalog;

fn main() -> Result<(), Box<dyn Error>> {
    let packets = snapshot_fixture::packets(&Catalog::load()?)?;
    serde_json::to_writer(io::stdout().lock(), &packets)?;
    Ok(())
}
