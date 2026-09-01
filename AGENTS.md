# God's Eye View — agent notes

## Scope

This checkout follows the upstream `bilawalsidhu/gods-eye-view` project and
adds the VPS packaging for `godseyeview.jimtrebes.fr`.

## Production invariants

- Keep Traefik as the only public ingress; never add a host `ports:` mapping.
- Only the `app` service joins `ingress_gods_eye_view`.
- Keep the root filesystem read-only, run as the image's non-root `node` user,
  drop all capabilities, and retain explicit CPU, memory and PID limits.
- Every application page and `/api/*` route stays behind the two-account
  server-side session gate. Only `/login` and the exact manifest/icon routes
  may remain public; never restore a browser-native HTTP auth challenge.
- Never commit `.env`, provider keys, passwords or plaintext onboarding
  credentials. Password rotation goes through `npm run provision:auth`.
- `GOOGLE_MAPS_API_KEY` and `CESIUM_ION_TOKEN` are browser-visible by upstream
  design and must be restricted by provider URL/API policy. Other keys stay
  server-side.
- Keep app-level Google/OpenAI throttles enabled even though Traefik also
  applies an ingress rate limit.
- The keyless OSM startup path must remain functional.
- Build and activate only through `scripts/safe-compose-start.sh`; never run a
  bare Compose build, up, start, restart or unpause command on this VPS.

## Verification

After application changes, run:

```bash
npm test
npm run build
npm audit --audit-level=high
docker compose config --quiet
```

After deployment, verify the custom login, CSRF/origin checks, cookie flags,
unauthenticated API denial, authenticated HTML and API access, logout, public
icon routes, HTTPS headers, the container healthcheck and the absence of
host-published application ports.
