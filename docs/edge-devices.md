# Edge Devices

Edge devices run crawler jobs locally when Vercel cannot host browser automation.
The server owns device registration, job queueing, ingestion, deduplication, and
review. The local worker only leases scoped jobs and submits extracted listing
text.

## Register A Device

1. Open `/edge-devices` in the app.
2. Register a device name.
3. Copy the one-time `EDGE_DEVICE_ID` and `EDGE_DEVICE_SECRET`.
4. Store them in the local environment. The secret is not shown again.

## Run The Worker

```bash
EDGE_SERVER_URL=https://dwelling-fee.vercel.app \
EDGE_DEVICE_ID=... \
EDGE_DEVICE_SECRET=df_edge_... \
npm run edge:worker
```

The worker uses a persistent Chromium profile under `.edge-profile/` by default.
Set `EDGE_HEADLESS=true` for unattended runs. Keep it `false` when a source needs
manual login or human checkpoints.

## Security Model

- Each device has a separate revocable secret.
- Worker requests are HMAC-signed with timestamp and nonce replay protection.
- Devices can only lease jobs for scoped sources.
- Submitted URLs must stay inside the source allowlist.
- The worker never submits cookies, localStorage, auth headers, screenshots, or
  full HTML in v1.
- CAPTCHA, login walls, paywalls, and access challenges are reported as
  `needs_user_action`; the worker does not try to bypass them.
