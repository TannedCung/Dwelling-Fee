# Edge Collection Devices

Edge devices run crawler jobs locally when Vercel cannot host browser automation.
The server owns device registration, job queueing, ingestion, deduplication, and
review. The local worker only leases scoped jobs and submits extracted listing
text.

## Register A Device

1. Open `/collect` in the app.
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

The browser layer is `playwright-extra` with `puppeteer-extra-plugin-stealth`.
For Cloudflare-managed sources such as Batdongsan, run the worker headful with a
persistent profile. If the source presents a CAPTCHA or access challenge, the
worker keeps the page open and waits for it to be solved in that browser window;
the clearance cookie stays in the profile for later runs. Set
`EDGE_SOLVE_TIMEOUT_MS` globally, or `solveTimeoutMs` on a source config, to tune
the wait window. The worker still respects robots.txt and refuses to submit
unresolved challenge/auth pages as listing posts.

The worker enables Chromium's sandbox by default. That avoids Chrome's
`--no-sandbox` warning banner and keeps the browser closer to a normal user
session. If a locked-down host cannot launch Chrome with sandboxing enabled, set
`EDGE_CHROMIUM_SANDBOX=false` as a host-specific fallback.

## Run A Tailscale noVNC Browser Appliance

Use this when someone on another machine needs to solve the verification step in
the worker browser profile. The browser cookies remain on the edge host.

Install the local display/VNC packages on the worker host:

```bash
sudo apt-get update
sudo apt-get install -y xvfb x11vnc novnc websockify
```

Make sure Tailscale is connected:

```bash
tailscale status
tailscale ip -4
```

Then start the appliance:

```bash
EDGE_SERVER_URL=https://dwelling-fee.vercel.app \
EDGE_DEVICE_ID=... \
EDGE_DEVICE_SECRET=df_edge_... \
EDGE_PROFILE_DIR=.edge-profile/batdongsan \
npm run edge:browser
```

`npm run edge:browser` starts:

- `Xvfb` as the worker display
- `x11vnc` bound to localhost
- `websockify`/noVNC bound to the Tailscale IP
- the edge worker with `EDGE_REMOTE_BROWSER_URL` set to the noVNC page

When a crawl hits a CAPTCHA or access challenge, `/collect` shows
**Open remote browser**. Any authorized person on the same Tailnet can open that
URL, solve the challenge in the worker browser, and the worker resumes
automatically once listing content is visible.

Useful overrides:

```bash
EDGE_TAILSCALE_IP=100.x.y.z
EDGE_NOVNC_PORT=6080
EDGE_VNC_PORT=5900
EDGE_DISPLAY=:99
EDGE_SOLVE_TIMEOUT_MS=900000
EDGE_CHROMIUM_SANDBOX=true
EDGE_REMOTE_BROWSER_URL=http://100.x.y.z:6080/vnc.html?autoconnect=1
```

## Security Model

- Each device has a separate revocable secret.
- Worker requests are HMAC-signed with timestamp and nonce replay protection.
- Devices can only lease jobs for scoped sources.
- Submitted URLs must stay inside the source allowlist.
- The worker never submits cookies, localStorage, auth headers, screenshots, or
  full HTML in v1.
- The noVNC URL should bind to a Tailscale IP or another private tunnel, not a
  public interface. Do not expose raw VNC publicly.
- CAPTCHA, login walls, paywalls, and access challenges are attempted through the
  worker browser. Unresolved challenges are reported as `needs_user_action`; the
  worker does not submit those pages as listings.
- Jobs require at least one extracted item by default (`minItems`, overrideable
  per source). A zero-post crawl is reported as failed instead of a successful
  collection run.
