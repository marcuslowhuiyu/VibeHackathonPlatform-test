(function () {
  if (window.__errorCaptureInstalled) return;
  window.__errorCaptureInstalled = true;

  var lastError = '';
  var lastErrorTime = 0;
  var DEBOUNCE_MS = 2000;

  function sendError(message) {
    // Debounce: skip if same error within 2 seconds
    var now = Date.now();
    if (message === lastError && now - lastErrorTime < DEBOUNCE_MS) return;
    lastError = message;
    lastErrorTime = now;

    try {
      window.parent.postMessage({ type: 'preview_error', error: message }, '*');
    } catch (e) {
      // Can't communicate with parent
    }
  }

  // Capture uncaught errors
  window.addEventListener('error', function (event) {
    var msg = event.message || 'Unknown error';
    if (event.filename) {
      msg += ' at ' + event.filename;
      if (event.lineno) msg += ':' + event.lineno;
      if (event.colno) msg += ':' + event.colno;
    }
    sendError(msg);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    var msg = 'Unhandled promise rejection: ';
    if (reason instanceof Error) {
      msg += reason.message;
      if (reason.stack) msg += '\n' + reason.stack;
    } else {
      msg += String(reason);
    }
    sendError(msg);
  });

  // Intercept console.error to capture React and other framework errors
  var originalConsoleError = console.error;
  console.error = function () {
    originalConsoleError.apply(console, arguments);

    // Build message from arguments
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      if (arg instanceof Error) {
        parts.push(arg.message + (arg.stack ? '\n' + arg.stack : ''));
      } else if (typeof arg === 'object') {
        try {
          parts.push(JSON.stringify(arg));
        } catch (e) {
          parts.push(String(arg));
        }
      } else {
        parts.push(String(arg));
      }
    }
    var msg = parts.join(' ');

    // Only report substantive errors, not React dev warnings
    if (msg.length > 10 && !msg.startsWith('Warning:') && !msg.startsWith('Download the React DevTools')) {
      sendError(msg);
    }
  };

  // Detect Vite HMR error overlay
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      for (var j = 0; j < mutations[i].addedNodes.length; j++) {
        var node = mutations[i].addedNodes[j];
        if (node.tagName === 'VITE-ERROR-OVERLAY') {
          // Extract error message from the overlay shadow DOM
          setTimeout(function () {
            try {
              var shadow = node.shadowRoot;
              if (shadow) {
                var msgEl = shadow.querySelector('.message-body');
                if (msgEl) {
                  sendError('Vite build error: ' + msgEl.textContent.trim());
                }
              }
            } catch (e) {
              sendError('Vite build error detected');
            }
          }, 100);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
