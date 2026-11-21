use std::{error::Error, io};

use unicorn_mining_server::game_session::authoritative::session_fixture;

fn main() -> Result<(), Box<dyn Error>> {
    session_fixture::run(io::stdin().lock(), io::stdout().lock())
}
