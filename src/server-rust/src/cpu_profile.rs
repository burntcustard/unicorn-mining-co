//! Process CPU sampling for the private maintenance socket.

use std::io::Write;
use std::time::Duration;

use flate2::{Compression, write::GzEncoder};
use rpprof::{ProfilerGuard, ProfilerGuardBuilder, protos::Message};

const SAMPLES_PER_CPU_SECOND: i32 = 100;

pub async fn capture(seconds: u8) -> crate::Result<Vec<u8>> {
    let guard = tokio::task::spawn_blocking(|| {
        ProfilerGuardBuilder::new()
            .frequency(SAMPLES_PER_CPU_SECOND)
            .max_spill_entries(0)
            .build()
    })
    .await??;
    tokio::time::sleep(Duration::from_secs(u64::from(seconds))).await;
    tokio::task::spawn_blocking(move || encode(guard)).await?
}

fn encode(guard: ProfilerGuard<'_>) -> crate::Result<Vec<u8>> {
    let report = guard.report().build()?;
    drop(guard);
    let mut gzip = GzEncoder::new(Vec::new(), Compression::fast());
    gzip.write_all(&report.pprof()?.encode_to_vec())?;
    Ok(gzip.finish()?)
}
