import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadMonitor() {
  const sandbox = {
    navigator: { userAgent: 'Mozilla/5.0', sendBeacon() {} },
    document: {
      getElementById() {
        return null;
      },
      documentElement: {},
    },
    setTimeout() {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Blob: class {},
    XMLHttpRequest: class {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = function () {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(new URL('../site/form-monitor.js', import.meta.url), 'utf8'), sandbox, {
    filename: 'site/form-monitor.js',
  });
  return sandbox.GivingFormMonitor;
}

const idle = { applePay: false, googlePay: false, ios: false };

test('counts Apple Pay when the wallet bridge says it is available', () => {
  const monitor = loadMonitor();
  assert.deepEqual(
    plain(
      monitor.classifyWalletMessage(
        { type: 'canMakePayment', result: { applePay: true, googlePay: false } },
        idle
      )
    ),
    { type: 'apple_pay_available', state: { applePay: true, googlePay: false, ios: false } }
  );
});

test('ignores a device with no Apple Pay wallet', () => {
  const monitor = loadMonitor();
  assert.deepEqual(plain(monitor.classifyWalletMessage({ type: 'canMakePayment', result: null }, idle)), {
    type: null,
    state: { applePay: false, googlePay: false, ios: false },
  });
  assert.deepEqual(
    plain(
      monitor.classifyWalletMessage({ type: 'canMakePayment', result: { applePay: false, googlePay: true } }, idle)
    ),
    { type: null, state: { applePay: false, googlePay: true, ios: false } }
  );
});

test('counts an Apple Pay success and alerts on an Apple Pay error', () => {
  const monitor = loadMonitor();
  const appleOnly = { applePay: true, googlePay: false, ios: true };
  assert.deepEqual(plain(monitor.classifyWalletMessage({ type: 'paymentSuccess' }, appleOnly)), {
    type: 'apple_pay_success',
    state: { applePay: true, googlePay: false, ios: true },
  });
  assert.deepEqual(
    plain(
      monitor.classifyWalletMessage(
        { type: 'paymentError', error: { message: 'card_declined', code: 'card_declined' } },
        appleOnly
      )
    ),
    { type: 'apple_pay_error', state: { applePay: true, googlePay: false, ios: true } }
  );
});

test('treats an iPhone outcome as Apple Pay before availability is known', () => {
  const monitor = loadMonitor();
  const iphone = { applePay: false, googlePay: false, ios: true };
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentSuccess' }, iphone).type, 'apple_pay_success');
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentError' }, iphone).type, 'apple_pay_error');
});

test('keeps a Mac with both wallets as a generic wallet result', () => {
  const monitor = loadMonitor();
  const both = { applePay: true, googlePay: true, ios: false };
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentSuccess' }, both).type, 'wallet_payment_success');
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentError' }, both).type, 'wallet_payment_error');
});

test('does not report the donor closing the sheet or a Google Pay outcome', () => {
  const monitor = loadMonitor();
  const google = { applePay: false, googlePay: true, ios: false };
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentCancel' }, google).type, null);
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentSuccess' }, google).type, null);
  assert.equal(monitor.classifyWalletMessage({ type: 'paymentError' }, google).type, null);
});

test('reports a missing Stripe library as an Apple Pay failure', () => {
  const monitor = loadMonitor();
  assert.equal(monitor.classifyWalletMessage({ type: 'libraryMissingError' }, idle).type, 'apple_pay_library_missing');
  assert.equal(monitor.classifyWalletMessage({ type: 'generalError', error: {} }, idle).type, 'wallet_payment_error');
});
