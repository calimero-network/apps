// Polyfill for global object (needed for virtualized-chat library)
if (typeof global === 'undefined') {
  window.global = window;
}

// Prevent mobile zoom on input focus
document.addEventListener('DOMContentLoaded', function() {
  // Prevent zoom on input focus
  const inputs = document.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    input.addEventListener('focus', function() {
      // Prevent zoom by temporarily changing viewport
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
      }
    });
    
    input.addEventListener('blur', function() {
      // Restore normal viewport
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
      }
    });
  });
});
