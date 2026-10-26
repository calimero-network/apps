try {
  if (localStorage.getItem("mero-design:theme") === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }
} catch (e) {}
