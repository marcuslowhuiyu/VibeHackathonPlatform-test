(function() {
  let overlay = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);z-index:99999;transition:all 0.1s;display:none;';
    document.body.appendChild(overlay);
  }

  document.addEventListener('mouseover', function(e) {
    if (!overlay) createOverlay();
    var rect = e.target.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  });

  document.addEventListener('mouseout', function() {
    if (overlay) overlay.style.display = 'none';
  });

  document.addEventListener('click', function(e) {
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      var el = e.target;
      window.parent.postMessage({
        type: 'element_click',
        tagName: el.tagName.toLowerCase(),
        textContent: (el.textContent || '').slice(0, 50).trim(),
        selector: buildSelector(el)
      }, '*');
    }
  });

  function buildSelector(el) {
    var parts = [];
    while (el && el !== document.body) {
      var part = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        part += '.' + el.className.trim().split(/\s+/).join('.');
      }
      parts.unshift(part);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
})();
