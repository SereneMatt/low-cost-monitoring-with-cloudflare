(function () {
  'use strict';

  var ENDPOINT = 'https://monitor.form.de/form-error';
  var PAGE_VERSION = '2026-10-24';
  var TIMEOUT_MS = 10000;
  var reported = {};

  function report(type) {
    if (reported[type]) return;
    reported[type] = true;

    var details = detectBrowser();
    var payload = JSON.stringify({
      type: type,
      browserFamily: details.browserFamily,
      browserMajor: details.browserMajor,
      osFamily: details.osFamily,
      pageVersion: PAGE_VERSION,
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'text/plain;charset=UTF-8' }));
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('POST', ENDPOINT, true);
    xhr.setRequestHeader('Content-Type', 'text/plain;charset=UTF-8');
    xhr.send(payload);
  }

  function detectBrowser() {
    var ua = navigator.userAgent || '';
    var browserFamily = 'Other';
    var browserMajor = 'unknown';
    var osFamily = 'Other';
    var match;

    if ((match = ua.match(/Edg\/(\d+)/))) {
      browserFamily = 'Edge';
      browserMajor = match[1];
    } else if ((match = ua.match(/Firefox\/(\d+)/))) {
      browserFamily = 'Firefox';
      browserMajor = match[1];
    } else if ((match = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) {
      browserFamily = 'Chrome';
      browserMajor = match[1];
    } else if (/Safari\//.test(ua) && (match = ua.match(/Version\/(\d+)/))) {
      browserFamily = 'Safari';
      browserMajor = match[1];
    }

    if (/Android/.test(ua)) osFamily = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) osFamily = 'iOS';
    else if (/Mac OS X/.test(ua)) osFamily = 'macOS';
    else if (/Windows/.test(ua)) osFamily = 'Windows';
    else if (/Linux/.test(ua)) osFamily = 'Linux';

    return {
      browserFamily: browserFamily,
      browserMajor: browserMajor,
      osFamily: osFamily,
    };
  }

  var walletState = { applePay: false, googlePay: false, ios: false };

  function classifyWalletMessage(message, state) {
    var next = {
      applePay: state.applePay === true,
      googlePay: state.googlePay === true,
      ios: state.ios === true,
    };
    if (!message || typeof message !== 'object') return { type: null, state: next };

    if (message.type === 'canMakePayment') {
      var result = message.result;
      next.applePay = !!(result && result.applePay === true);
      next.googlePay = !!(result && result.googlePay === true);
      return { type: next.applePay ? 'apple_pay_available' : null, state: next };
    }

    if (message.type === 'libraryMissingError') {
      return { type: 'apple_pay_library_missing', state: next };
    }

    if (message.type === 'paymentCancel' || message.type === 'walletPayParentReady') {
      return { type: null, state: next };
    }

    var success = message.type === 'paymentSuccess';
    var failure = message.type === 'paymentError' || message.type === 'generalError';
    if (!success && !failure) return { type: null, state: next };

    if (next.applePay && !next.googlePay) {
      return { type: success ? 'apple_pay_success' : 'apple_pay_error', state: next };
    }

    if (next.applePay && next.googlePay) {
      if (next.ios) return { type: success ? 'apple_pay_success' : 'apple_pay_error', state: next };
      return { type: success ? 'wallet_payment_success' : 'wallet_payment_error', state: next };
    }

    if (next.googlePay) {
      if (message.type === 'generalError') return { type: 'wallet_payment_error', state: next };
      return { type: null, state: next };
    }

    if (next.ios) {
      return { type: success ? 'apple_pay_success' : 'apple_pay_error', state: next };
    }

    if (message.type === 'generalError') {
      return { type: 'wallet_payment_error', state: next };
    }

    return { type: null, state: next };
  }

  function observeWalletMessage(message) {
    if (!walletState.ios && detectBrowser().osFamily === 'iOS') walletState.ios = true;
    var outcome = classifyWalletMessage(message, walletState);
    walletState = outcome.state;
    if (outcome.type) report(outcome.type);
  }

  function installWalletObserver() {
    var iframe = document.getElementById('fbIframe');
    if (!iframe || !iframe.contentWindow) return false;
    if (!iframe.__givingWalletLoadHook && typeof iframe.addEventListener === 'function') {
      try {
        iframe.addEventListener('load', function () {
          installWalletObserver();
        });
        iframe.__givingWalletLoadHook = true;
      } catch (ignore) {
        /* attaching the load hook must not stop the payment frame */
      }
    }

    var frameWindow = iframe.contentWindow;
    if (iframe.__givingWalletWindow === frameWindow) return true;
    var original = frameWindow.postMessage;
    if (typeof original !== 'function') return false;

    try {
      frameWindow.postMessage = function (message, targetOrigin, transfer) {
        try {
          observeWalletMessage(message);
        } catch (ignore) {
          /* keep the payment bridge working */
        }
        if (arguments.length >= 3) return original.call(frameWindow, message, targetOrigin, transfer);
        return original.call(frameWindow, message, targetOrigin);
      };
      iframe.__givingWalletWindow = frameWindow;
      return true;
    } catch (ignore) {
      return false;
    }
  }

  function watchWalletBridge() {
    if (typeof MutationObserver !== 'function' || !document.documentElement) return;
    var observer = new MutationObserver(function () {
      if (installWalletObserver()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (installWalletObserver()) observer.disconnect();
  }

  window.addEventListener(
    'error',
    function (event) {
      var message = String(event.message || '');
      if (/URLSearchParams|Object\.assign|GivingAppConfig|paymentJS/i.test(message)) {
        report('javascript_compatibility_error');
      }
    },
    true
  );

  window.setTimeout(function () {
    var iframe = document.getElementById('fbIframe');
    if (!iframe) {
      report('iframe_not_created');
    }
  }, TIMEOUT_MS);

  watchWalletBridge();

  window.GivingFormMonitor = {
    reportLoaderFailure: function () {
      report('loader_script_failed');
    },
    classifyWalletMessage: classifyWalletMessage,
  };
})();
