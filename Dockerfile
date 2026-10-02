FROM node:26-bookworm-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:client

FROM golang:1.27-bookworm AS go-build
WORKDIR /app
COPY --from=client-build /app/go.mod ./go.mod
COPY --from=client-build /app/cmd ./cmd
COPY --from=client-build /app/internal ./internal
RUN CGO_ENABLED=0 GOEXPERIMENT=simd go build -trimpath -ldflags='-s -w' -o /app/go-server ./cmd/go-server

FROM scratch
ENV APP_ENV=production PORT=8080 WORLD_SEED=25 GOGC=800
WORKDIR /app
COPY --from=go-build /app/go-server ./go-server
COPY --from=client-build /app/dist ./dist
USER 65532:65532
EXPOSE 8080
CMD ["/app/go-server"]
