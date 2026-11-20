FROM scratch
ENV APP_ENV=production PORT=8080 WORLD_SEED=25 DATABASE_PATH=/data/world-rust.sqlite BACKUP_DIRECTORY=/data/backups TMPDIR=/data
WORKDIR /app
COPY bin/server-rust ./server
COPY dist ./dist
EXPOSE 8080
CMD ["/app/server"]
