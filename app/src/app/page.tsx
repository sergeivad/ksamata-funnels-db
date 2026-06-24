export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <h1
        style={{
          fontSize: "2rem",
          fontWeight: 700,
          letterSpacing: "-0.02em",
        }}
      >
        Ksamata Funnels Admin
      </h1>
      <p
        style={{
          color: "var(--color-text-secondary)",
          fontSize: "1rem",
        }}
      >
        Панель управления воронками — скоро здесь будет интерфейс.
      </p>
      <div
        style={{
          marginTop: "1.5rem",
          padding: "0.5rem 1.25rem",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-soft)",
          borderRadius: "var(--radius-sm)",
          fontSize: "0.85rem",
          color: "var(--faint)",
        }}
      >
        Task 1 — scaffold complete ✓
      </div>
    </main>
  );
}
