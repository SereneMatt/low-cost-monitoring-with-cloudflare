(function () {
  'use strict';

  var ENDPOINT = 'https://monitor.form.de/form-error';
  var PAGE_VERSION = '2026-07-31';
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

  window.GivingFormMonitor = {
    reportLoaderFailure: function () {
      report('loader_script_failed');
    },
  };
})();
