# Form monitor

A low-cost Cloudflare Worker for monitoring failures of an embedded form.

It provides:

- a first-party-style `/form-error` ingestion endpoint
- strict event allowlisting and no user/payment data collection
- per-client rate limiting using a salted, truncated IP hash
- one-minute aggregate buckets in D1
- threshold and cool down based alerts through a Slack incoming webhook
- scheduled recovery alerts and automatic data cleanup
- a browser-compatible monitoring snippet for a page

## 1. Create the Cloudflare resources

Install dependencies and authenticate:

```sh
npm install
npx wrangler login
```

D1 was created using:

```sh
npx wrangler d1 create form-monitor
```

Copy the returned `database_id` into `wrangler.toml`, then create the tables:

```sh
npm run db:remote
```

## 2. Configure Slack

In Slack, create or select a Slack app, enable **Incoming Webhooks**, and add a
webhook for the channel that should receive monitoring alerts.

Store the webhook and rate-limit salt as Cloudflare secrets so neither value is
committed to Git:

```sh
npx wrangler secret put SLACK_WEBHOOK_URL
npx wrangler secret put RATE_LIMIT_SALT
```

Paste the full Slack webhook URL when Wrangler prompts for
`SLACK_WEBHOOK_URL`.

Use a random value of at least 32 characters for `RATE_LIMIT_SALT`.

## 3. Deploy

```sh
npm test
npm run deploy
```

Add a Cloudflare Worker custom domain:

```text
https://low-cost.workers.dev
```

The Worker exposes:

```text
GET  /health
POST /form-error
```

## 4. Install the browser monitor

Copy `site/form-monitor.js` to the site and load it in `<head>` before
`config.js` and `donor-form-loader.js`:

```html
<script src="/form-monitor.js"></script>
```

Loading it first allows it to observe compatibility errors thrown by the form
loader.

Add an error callback to the injected FundraisingBox script:

```js
script.onerror = function () {
  if (window.GivingFormMonitor) {
    window.GivingFormMonitor.reportLoaderFailure();
  }
};
```

If the page has a Content Security Policy, add the endpoint to `connect-src`:

```text
connect-src 'self' https://form-monitor.low-cost.workers.dev/
```

## 5. Verify end to end

Health check:

```sh
curl https://form-monitor.low-cost.workers.dev/health
```

Send a safe test event:

```sh
curl -X POST https://form-monitor.low-cost.workers.dev/ \
  -H 'Origin: https://giving.hillsongberlin.de' \
  -H 'Content-Type: text/plain' \
  --data '{"type":"iframe_not_created","browserFamily":"Test","browserMajor":"1","osFamily":"Test","pageVersion":"manual-test"}'
```

With the default threshold, send the event three times within ten minutes.
Confirm that one Slack alert is delivered and that further reports do not send
another alert during the 60-minute cooldown.

## Operational defaults

| Setting                 |         Default |
| ----------------------- | --------------: |
| Alert threshold         |       3 reports |
| Rolling window          |      10 minutes |
| Alert cooldown          |      60 minutes |
| Recovery silence window |      15 minutes |
| Per-client limit        | 30 reports/hour |
| Aggregate retention     |         30 days |
| Rate-limit retention    |        48 hours |

Adjust these values in `wrangler.toml`.

## Privacy notes

The Worker accepts only the documented categorical fields. It does not accept
names, email addresses, donation amounts, URLs, local storage, or payment
information. The visitor IP is salted and hashed for rate limiting, truncated,
and retained only in hourly buckets for up to 48 hours.
