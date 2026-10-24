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

This project pins Node with [mise](https://mise.jdx.dev/). Install the pinned
version, then install dependencies and authenticate:

```sh
mise install
npm install
cf auth login
```

D1 was created using:

```sh
cf d1 create --name form-monitor
```

Copy the returned database id into `cloudflare.config.ts` (`DB.id`) and into
the `db:local` and `db:remote` scripts in `package.json`, replacing
`REPLACE_WITH_D1_DATABASE_ID`. Then create the tables:

```sh
npm run db:remote
```

## 2. Configure Slack

In Slack, create or select a Slack app, enable **Incoming Webhooks**, and add a
webhook for the channel that should receive monitoring alerts.

Store the webhook and rate-limit salt as Cloudflare secrets so neither value is
committed to Git:

```sh
cat > .dev.vars << 'EOF'
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
RATE_LIMIT_SALT=replace-with-at-least-32-random-characters
EOF
```

`.dev.vars` is gitignored. `cf dev` reads it locally. Upload the same values
with a deploy:

```sh
cf deploy --secrets-file .dev.vars
```

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

Adjust these values in `cloudflare.config.ts`.

`cf` does not stream live logs yet. To tail the Worker, run
`npx wrangler tail form-monitor`. `wrangler.toml` stays in the repo for that
command and for the Wrangler bundler that `cf dev` and `cf deploy` use.

## Apple Pay

The browser snippet watches FundraisingBox wallet messages on the donation iframe.
It reports only a category:

| Event                        | Stored | Slack alert |
| ---------------------------- | -----: | ----------: |
| `apple_pay_available`        |    yes |          no |
| `apple_pay_success`          |    yes |          no |
| `apple_pay_error`            |    yes |         yes |
| `apple_pay_library_missing`  |    yes |         yes |
| `wallet_payment_success`     |    yes |          no |
| `wallet_payment_error`       |    yes |         yes |

`apple_pay_available` is sent when Apple Pay can be offered. A success or error is labelled Apple Pay when Apple Pay is the only available wallet, or when the browser is iOS. A Mac with both Apple Pay and Google Pay is stored as `wallet_payment_success` or `wallet_payment_error`. Closing the payment sheet is not reported. Stripe error text, amounts, and payer details are not sent.

The existing form-failure events still alert exactly as before.

## Privacy notes

The Worker accepts only the documented categorical fields. It does not accept
names, email addresses, donation amounts, URLs, local storage, or payment
information. The visitor IP is salted and hashed for rate limiting, truncated,
and retained only in hourly buckets for up to 48 hours.
