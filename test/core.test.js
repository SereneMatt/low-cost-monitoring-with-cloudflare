import test from "node:test";
import assert from "node:assert/strict";
import {
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
    corsHeaders("https://giving.hillsongberlin.de", "https://giving.hillsongberlin.de")[
      "Access-Control-Allow-Origin"
    ],
    "https://giving.hillsongberlin.de",
  );
  assert.equal(
    corsHeaders("https://evil.example", "https://giving.hillsongberlin.de")[
      "Access-Control-Allow-Origin"
    ],
    undefined,
  );
});
