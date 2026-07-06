# ChronoNote Docker

## Build and Run

```bash
docker compose up --build
```

Open `http://localhost:3030`.

The app binds only to `127.0.0.1:3030` and stores runtime data in `./server-data` through the `/data` container volume. The container runs as a non-root user with a read-only root filesystem and a private temporary filesystem.

For Podman, use the same compose file:

```bash
podman compose up --build -d
```

The compose volume uses `:Z` so rootless Podman on SELinux systems can write to `./server-data`. If the host user is not UID 1000, use the included `deploy/container-chrononote.service` pattern with Podman's `--userns=keep-id:uid=1000,gid=1000` mapping.

## Stop

```bash
docker compose down
# or
podman compose down
```

## Rebuild

```bash
docker compose build --no-cache
docker compose up
# or
podman compose build --no-cache
podman compose up
```

## Google OAuth

If Google login is enabled, set the three Google environment variables in `docker-compose.yml` and make the authorized redirect URI match the public address you use:

```text
GOOGLE_REDIRECT_URI=http://localhost:3030/api/auth/google/callback
```
