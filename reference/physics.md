# Physics reference

The external Go Box2D port used for studying collision algorithms is `github.com/ByteArena/box2d@v1.0.2` (Zlib license). Its source is available from the Go module cache; a working copy is retained locally at `/tmp/unicorn-box2d` during this migration.

The port is a reference only. The server's physics implementation is in `internal/physics` and `internal/collision/game/game-collisions.go`, following the project's TypeScript collision and solver rules in `src/shared/physics` and `src/shared/collision`. The Box2D package is not a Go dependency and is not copied into the build or production image.
