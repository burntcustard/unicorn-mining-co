fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cases = unicorn_mining_server::projectile_fixture::cases()?;
    serde_json::to_writer(std::io::stdout().lock(), &cases)?;
    Ok(())
}
