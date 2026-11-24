# First-time Fly setup

## Fly app and network

1. Install the Fly CLI, sign in with `fly auth login`, and inspect existing
   apps with `fly apps list`. [Fly CLI setup](https://fly.io/agent-ready.md)
2. Create the app with `fly apps create unicorn-mining-co` if needed. Choose a
   different name if unavailable and update `fly.toml`.
3. Check `fly ips list`. Allocate a dedicated public IPv4 with
   `fly ips allocate-v4` and public IPv6 with `fly ips allocate-v6` if needed.
   Set `MOVEMENT_PUBLIC_ADDRESS` to the dedicated IPv4 and UDP port 8081.
   [Fly UDP requirements](https://docs.fly.io/networking/udp-and-tcp)
4. Create the `game_data` volume if needed, following the
   [persistence guide](../../../../docs/persistence.md#local-development-and-fly-deployment).
5. Build and test using the manual release steps in [the deployment skill](../SKILL.md).
   For the first deploy with addresses already allocated, add `--no-public-ips`
   to the deploy command. Verify one Machine, the mounted volume, and a
   successful `/healthz` at the app's `fly.dev` hostname.
   [Fly deploy flags](https://docs.fly.io/flyctl/cmd/fly_deploy)

## GitHub Actions token

Create a named app-scoped deploy token with
`fly tokens create deploy -a <app> --name github-actions --expiry 2160h`.
Store the token in the repository's Actions secrets as `FLY_API_TOKEN`, and
rotate it before expiry. Keep the token out of source and command logs.
[Fly deploy token reference](https://docs.fly.io/flyctl/cmd/fly_tokens_create_deploy)

## Public hostnames

1. Attach `unicorn-mining.co` and `www.unicorn-mining.co` with
   `fly certs add <hostname>`. Run `fly certs setup <hostname>` for the DNS
   settings and any ownership or ACME records. [Fly custom domains](https://docs.fly.io/networking/custom-domain)
2. In Namecheap → Advanced DNS, replace the root parking record with Fly's
   A and AAAA records and the `www` parking record with Fly's CNAME target.
   Preserve mail forwarding MX and SPF records.
3. Use `fly certs check <hostname>` for both names. Verify root HTTPS,
   the `www` redirect, and a WSS game connection from a second network. Check
   Fly logs and CPU and memory during the first session.
