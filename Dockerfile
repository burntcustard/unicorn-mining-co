FROM node:26-bookworm-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:client && npm run catalog:go

FROM golang:1.27-bookworm AS go-build
WORKDIR /app
COPY --from=client-build /app/go.mod ./go.mod
COPY --from=client-build /app/src/server ./src/server
RUN CGO_ENABLED=0 GOEXPERIMENT=simd go build -trimpath -ldflags='-s -w' -o /app/server ./src/server

FROM scratch
ENV APP_ENV=production PORT=8080 WORLD_SEED=25 GOGC=800
WORKDIR /app
COPY --from=go-build /app/server ./server
COPY --from=client-build /app/dist ./dist
USER 65532:65532
EXPOSE 8080
CMD ["/app/server"]
