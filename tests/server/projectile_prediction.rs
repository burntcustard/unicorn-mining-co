fn main() -> Result<(), Box<dyn std::error::Error>> {
    let group = std::env::args().nth(1).unwrap_or_else(|| "all".into());
    let cases = unicorn_mining_server::projectile_fixture::cases(&group)?;
    serde_json::to_writer(std::io::stdout().lock(), &cases)?;
    Ok(())
}
