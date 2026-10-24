import test from "node:test";
import assert from "node:assert/strict";
import {
  alertsOnEvent,
  corsHeaders,
  hourBucket,
  integerSetting,
  minuteBucket,
  sanitizeEvent,
} from "../src/core.js";

test("sanitizes an allowed event without accepting arbitrary fields", () => {
  assert.deepEqual(
    sanitizeEvent({
      type: "iframe_not_created",
      browserFamily: "Safari",
      browserMajor: "9",
      osFamily: "iOS",
      pageVersion: "release-1",
      email: "must-not-be-stored@example.com",
    }),
    {
      type: "iframe_not_created",
      browserFamily: "Safari",
      browserMajor: "9",
      osFamily: "iOS",
      pageVersion: "release-1",
    },
  );
});

test("rejects unknown event types", () => {
  assert.equal(sanitizeEvent({ type: "anything_goes" }), null);
  assert.equal(sanitizeEvent({ type: "paymentError" }), null);
  assert.equal(sanitizeEvent({ type: "paymentCancel" }), null);
});

test("accepts giving-app failures and apple pay outcomes without payment fields", () => {
  const types = [
    "iframe_not_created",
    "iframe_loaded_without_fields",
    "loader_script_failed",
    "javascript_compatibility_error",
    "apple_pay_available",
    "apple_pay_success",
    "apple_pay_error",
    "apple_pay_library_missing",
    "wallet_payment_success",
    "wallet_payment_error",
  ];

  for (const type of types) {
    assert.deepEqual(
      sanitizeEvent({
        type,
        browserFamily: "Safari",
        browserMajor: "18",
        osFamily: "iOS",
        pageVersion: "2026-10-24",
        error: "card_declined",
        client_secret: "pi_secret",
        amount: 2500,
      }),
      {
        type,
        browserFamily: "Safari",
        browserMajor: "18",
        osFamily: "iOS",
        pageVersion: "2026-10-24",
      },
    );
  }
});

test("alerts on form and apple pay failures and counts successful wallet use", () => {
  assert.equal(alertsOnEvent("iframe_not_created"), true);
  assert.equal(alertsOnEvent("iframe_loaded_without_fields"), true);
  assert.equal(alertsOnEvent("loader_script_failed"), true);
  assert.equal(alertsOnEvent("javascript_compatibility_error"), true);
  assert.equal(alertsOnEvent("apple_pay_error"), true);
  assert.equal(alertsOnEvent("apple_pay_library_missing"), true);
  assert.equal(alertsOnEvent("wallet_payment_error"), true);
  assert.equal(alertsOnEvent("apple_pay_available"), false);
  assert.equal(alertsOnEvent("apple_pay_success"), false);
  assert.equal(alertsOnEvent("wallet_payment_success"), false);
  assert.equal(alertsOnEvent("paymentCancel"), false);
});

test("strips control characters and bounds metadata", () => {
  const result = sanitizeEvent({
    type: "loader_script_failed",
    browserFamily: "\u0000" + "x".repeat(100),
  });
  assert.equal(result.browserFamily.length, 40);
  assert.equal(result.browserFamily.includes("\u0000"), false);
});

test("creates stable UTC buckets", () => {
  const date = new Date("2026-07-30T12:34:56.789Z");
  assert.equal(minuteBucket(date), "2026-07-30T12:34:00.000Z");
  assert.equal(hourBucket(date), "2026-07-30T12:00:00.000Z");
});

test("bounds integer settings", () => {
  assert.equal(integerSetting("3", 10, 1, 20), 3);
  assert.equal(integerSetting("999", 10, 1, 20), 20);
  assert.equal(integerSetting("invalid", 10, 1, 20), 10);
});

test("only reflects the configured origin", () => {
  assert.equal(
    corsHeaders("https://my_cool_app.com", "https://my_cool_app.com")[
      "Access-Control-Allow-Origin"
    ],
    "https://my_cool_app.com",
  );
  assert.equal(
    corsHeaders("https://evil.example", "https://my_cool_app.com")[
      "Access-Control-Allow-Origin"
    ],
    undefined,
  );
});
