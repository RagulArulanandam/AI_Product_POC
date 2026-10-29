"use client";

/** Last resort when the root layout itself fails, so it brings its own <html> and plain styles. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center", padding: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#555", marginBottom: "1.25rem" }}>Please try again in a moment.</p>
          <button onClick={reset} style={{ padding: "0.6rem 1.2rem", borderRadius: "0.6rem", border: "none", background: "#6d3fe0", color: "white", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
