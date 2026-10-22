# Immutable benchmark PGO inputs

Each filename is the SHA-256 of its profile bytes. These captured compiler
inputs are independent of `src/server/default.pgo`, which can change with
future production training. Experiment manifests and source inventories
record their original roles and expected hashes.

Completed experiment ZIPs include the inputs their scripts use, so extraction
does not depend on this directory. Loose experiments share the copies here.

| SHA-256 file                                                           | Original experiment inputs                                                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1d77b5ac1d74c4aed4886f78c5affe12307a292d13007715fab4988d9ef33475.pgo` | `benchmarking/experiments/2026-10-01/go-cpu/profiles/pre-solver-default.pgo`                                                                                                                                                    |
| `27d6db2c3bfbc164ac75e97600aee0562c899024091eb9e6ae228705198e26c6.pgo` | `benchmarking/experiments/2026-10-22/go-cpu/profiles/retained.pgo`, `benchmarking/experiments/2026-10-22/go-cpu-lowering/profiles/before.pgo`                                                                                   |
| `35a3d270804a4bf4a1a609d3bf11b4b1056a8fcdb419392df0d3b720d078eaa5.pgo` | `benchmarking/experiments/2026-10-01/go-cpu/profiles/solver-final.pgo`                                                                                                                                                          |
| `6f4664db84bd91b648d714611f508222a13b6e7385b71be7c5302dc74111e675.pgo` | `benchmarking/experiments/2026-10-20/pirate-cpu/profiles/unicorn-cpu-default.pgo`, `benchmarking/experiments/2026-10-22/go-cpu/profiles/original.pgo`                                                                           |
| `d44f49605523c87c6b129ca78b6ab37b332c6ae194c5e5a3bb1c64ee9fba9cdb.pgo` | `benchmarking/experiments/2026-10-22/go-cpu-lowering/profiles/after.pgo`, `benchmarking/experiments/2026-10-22/go-cpu-transport/profiles/after.pgo`, `benchmarking/experiments/2026-10-22/go-cpu-transport/profiles/before.pgo` |
| `da75321f62214378ddefa6577733c5a61c330d15032146507ca9caa992418bc3.pgo` | `benchmarking/experiments/2026-10-01/go-cpu/profiles/pre-followup-default.pgo`                                                                                                                                                  |
