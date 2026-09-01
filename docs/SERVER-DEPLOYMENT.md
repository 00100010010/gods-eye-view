# Server deployment

This checkout deploys privately at `godseyeview.jimtrebes.fr` behind the shared
Traefik ingress.

## Authentication

Exactly two application accounts are provisioned with independent random
32-character passwords and bcrypt cost 12 hashes:

```bash
npm run provision:auth -- jim guest
```

The branded `/login` page verifies passwords only on the server. Successful
logins receive a signed 12-hour `HttpOnly`, `Secure`, `SameSite=Strict` session
cookie. Login requests also require a signed CSRF token and exact same-origin
POST, and repeated failures are rate-limited in both the app and Traefik.

Hashes and the session-signing secret are stored in the root-owned `.env`. The
one-time plaintext handoff is written to
`/root/.secrets/godseyeview-initial-credentials.txt`, mode 0600. Move both
passwords to a password manager and then remove that handoff file.

Rotate both accounts atomically with:

```bash
npm run provision:auth -- <first-user> <second-user> --force
./scripts/safe-compose-start.sh recreate app
```

Generate only a missing session-signing secret without rotating either account:

```bash
npm run provision:auth -- --ensure-session
```

## Optional provider keys

The service starts on keyless Esri World Imagery, with OSM available and used
automatically if Esri is unreachable. Add provider keys only to `.env`, then
recreate `app`. Google Maps enables the photorealistic 3D globe; OpenAI enables
voice and HUD summaries. Google/Cesium browser keys must be URL- and
API-restricted at the provider. Keep provider-side quotas and billing alerts in
place; the local request limits are only a secondary guard.

## DNS

Create the following OVH record before requesting the public route:

```text
type: A
name: godseyeview
target: 72.62.16.157
```

Traefik obtains the certificate automatically through its existing ACME TLS
challenge after the record resolves.

## Operations

```bash
./scripts/safe-compose-start.sh check
./scripts/safe-compose-start.sh build app
./scripts/safe-compose-start.sh recreate app
docker compose ps
docker compose logs --tail=100 app
```

Build and activation are deliberately separate. The wrapper acquires the
shared VPS heavy-operation lock, checks host capacity and every active public
route, activates with `--no-build --no-deps`, then monitors the fleet and stops
only the newly activated app if the host remains severely degraded. Do not use
bare `docker compose up`, `start`, `restart`, `unpause`, or `build` commands on
this VPS.

No application port is published on the host. The only public path is Traefik
over 80/443 and the dedicated `ingress_gods_eye_view` network.

## Responsive verification

The touch layout has dedicated phone and tablet breakpoints. Re-run the live
browser sweep after changing panel, dock, HUD, or onboarding styles:

```bash
npm run verify:responsive
```

It signs in through the in-page login without printing credentials and checks phone portrait and
landscape (`390x844`, `844x390`) plus iPad portrait and landscape (`768x1024`,
`1024x768`). Screenshots are written outside the repository to
`/tmp/gods-eye-view-responsive`.

Validate the public certificate, in-page login and authenticated route with strict TLS after
DNS propagation:

```bash
GEV_VERIFY_ADDRESS=godseyeview.jimtrebes.fr GEV_VERIFY_TLS=1 \
  node scripts/verify-deployment.mjs
```
