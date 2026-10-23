# Benchmarking

Start each extensive local server benchmarking session with a fresh world. Stop
the local Go watcher, run `npm run reset-world:local`, and restart the normal
watcher. Reset once before the full matrix.

Preserve live world data during benchmarking. Reset the live world only when
the user explicitly requests it.
