(function () {
  try {
    var t = localStorage.getItem('mero-sheets:theme');
    if (t === null) t = localStorage.getItem('app:theme');
    var dark = t === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (dark) {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#0b0e18');
    }
  } catch (e) {}
})();
