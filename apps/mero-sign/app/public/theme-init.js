(function () {
  var dark = false;
  try {
    dark = localStorage.getItem('mero-sign:theme') === 'dark';
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (dark) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', '#0b0e18');
  }
})();
