try {
  if (localStorage.getItem('mero-pass:theme') === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    document
      .querySelector('meta[name="theme-color"]')
      .setAttribute('content', '#0b0e18');
  }
} catch (e) {}
