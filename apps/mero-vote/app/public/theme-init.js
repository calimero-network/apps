(function () {
  try {
    if (localStorage.getItem('mero-vote:theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', '#0b0e18');
    }
  } catch (e) {}
})();
