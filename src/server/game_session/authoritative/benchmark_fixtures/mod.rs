mod collector_cleanup;
mod movement;
pub(super) mod npc;
mod pirate;

use std::path::PathBuf;

use super::AuthoritativeSession;

#[derive(Default)]
pub(super) struct Fixtures {
    movement: bool,
    retired_sectors: Vec<usize>,
    collector_cleanup: Option<collector_cleanup::Fixture>,
    npc: Option<npc::Fixture>,
    pirate: Option<pirate::Fixture>,
}

impl AuthoritativeSession {
    pub fn configure_benchmarks(
        &mut self,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        self.fixtures.collector_cleanup = std::env::var_os("COLLECTOR_CLEANUP_TELEMETRY")
            .map(PathBuf::from)
            .map(collector_cleanup::Fixture::open)
            .transpose()?;
        self.fixtures.movement = std::env::var_os("MOVEMENT_BENCHMARK").is_some();
        self.fixtures.npc = std::env::var_os("NPC_BENCHMARK_FIXTURE")
            .map(PathBuf::from)
            .map(npc::Fixture::load)
            .transpose()?;
        self.fixtures.pirate = std::env::var_os("PIRATE_BENCHMARK_FIXTURE")
            .map(PathBuf::from)
            .map(pirate::Fixture::load)
            .transpose()?;
        Ok(self.fixtures.movement || self.fixtures.npc.is_some() || self.fixtures.pirate.is_some())
    }

    pub(super) fn prune_benchmark_sectors(&mut self) {
        for index in self.fixtures.retired_sectors.drain(..) {
            self.sectors.drop_benchmark_sector(index);
        }
    }

    pub(super) fn start_benchmark_tick(&mut self, index: usize) {
        self.record_collector_cleanup(index, false);
    }

    pub(super) fn record_benchmarks(&mut self, index: usize) {
        self.record_collector_cleanup(index, true);
        self.record_npc_benchmark(index);
        self.record_pirate_benchmark(index);
    }

    pub(super) fn finish_benchmark(&mut self, id: i64) {
        self.finish_npc_benchmark(id);
        self.finish_pirate_benchmark(id);
    }

    pub(super) fn prepare_benchmark(&mut self, id: i64) {
        if self.fixtures.movement {
            self.prepare_movement_benchmark(id);
        }
        if self.fixtures.npc.is_some() {
            self.prepare_npc_benchmark(id);
        }
        if self.fixtures.pirate.is_some() {
            self.prepare_pirate_benchmark(id);
        }
    }
}
