export const LoadingSpinner = () => (
  <div
    role="status"
    aria-live="polite"
    aria-label="Loading"
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      height: "100vh",
      color: "#fff",
      fontSize: "1.2rem",
    }}
  >
    <span>Loading authentication...</span>
  </div>
);
