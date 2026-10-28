# GitHub and CNB repository Docker preview

This extends [the creation preview design from October 16](2026-10-16-creation-project-one-click-launch-design.md).

## Behavior

- Admins can start any account-owned `service` creation whose URL is a plain HTTPS GitHub or CNB repository URL.
- Octop shallow-clones each repository into its data directory under `projects/github/` or `projects/cnb/`, using an item-specific folder and container identity. It keeps that checkout between starts and does not pull later commits automatically.
- Admins can manually clone or update the checkout from the creation card with `git pull --ff-only`. A dirty checkout or origin mismatch fails without changing the running service. A successful update removes the old preview container and image; start the preview again to build and run the updated source.
- Built-in app cards can bind a GitHub/CNB repository in their edit dialog and pull it manually from the card. This keeps a per-card source checkout; it does not replace the app's bundled static files.
- GitHub clone/update supports public repositories. CNB clone/update uses the user's encrypted CNB Access Token from Connectors, passed to Git through a temporary credential file that is removed after each operation; the token is not written into the repository URL or Git config.
- The repository must have a root `Dockerfile` with a numeric TCP `EXPOSE` port. Octop builds that Dockerfile, publishes the container port on loopback only, and returns a random HTTPS preview subdomain after an HTTP connection succeeds.
- Octop does not execute `docker-compose.yml`, pass host environment variables, mount host paths, or expose the container to the LAN. It drops Linux capabilities, disables privilege escalation, and limits the running container to 1 GiB RAM, 2 CPUs, and 256 processes.
- Stop leaves the checkout, image, and container data available for the next start. Graceful Octop shutdown stops running preview containers. Deleting or changing the source URL stops the item runtime but retains its files and Docker data.

## Host requirements and limits

The Octop host needs Git and a working Docker daemon. For remote browser access, configure `OCTOP_WORKBENCH_PREVIEW_DOMAIN` to a preview base domain (for example `preview.example.com`), point `*.preview.example.com` to the Octop host, and configure Nginx with a wildcard HTTPS certificate (typically issued with DNS-01) for that domain to proxy requests to Octop while preserving the `Host` header and websocket upgrades. Use a dedicated domain for previews where possible. Without this setting, returned URLs are loopback-only and intended for same-host development.

Keep Octop's HTTP listener reachable only from the Nginx host (for example bind it to `127.0.0.1:8088` and block inbound access to port 8088). The preview subdomain is an unguessable bearer URL; anyone who receives it can access that running app until it is stopped.

Example Nginx server block (replace the domain and certificate paths):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name *.preview.example.com;
    ssl_certificate /etc/letsencrypt/live/preview.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/preview.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }
}
```

A repository without a numeric TCP `EXPOSE` port is rejected. Repositories that need multiple published ports or Compose orchestration are not supported by this preview path.

Starting a repository executes its Dockerfile during image build and runs its image. Only admins can start projects, and they must trust the repository: Docker daemon access is highly privileged, container limits do not make arbitrary code harmless, and outbound network access remains enabled. The runtime only publishes the selected service port on `127.0.0.1`; Nginx sends wildcard preview subdomains to Octop, which proxies to the matching running container.

## Verification

```powershell
uv run pytest tests/unit/workbench/test_project_service.py tests/integration/test_creations_api.py -q
cd dashboard
npm test -- --run src/pages/Creations/index.test.tsx -t "registered GitHub project preview"
npx tsc -b
```
