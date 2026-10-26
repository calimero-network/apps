// Apply a saved dark choice before React mounts to avoid a
// light-mode flash. Light is the default.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('mero-theme'));
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
