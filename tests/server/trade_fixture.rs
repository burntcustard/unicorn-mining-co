use std::{error::Error, io};

use unicorn_mining_server::game_session::authoritative::trade_fixture;

fn main() -> Result<(), Box<dyn Error>> {
    trade_fixture::run(io::stdin().lock(), io::stdout().lock())
}
