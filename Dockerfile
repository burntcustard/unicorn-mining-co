# Package the artifacts built and tested before deployment.
FROM scratch
ENV APP_ENV=production PORT=8080 WORLD_SEED=25
WORKDIR /app
COPY bin/server ./server
COPY dist ./dist
# The server initializes /data ownership and drops to uid/gid 65532 at startup.
EXPOSE 8080
CMD ["/app/server"]
