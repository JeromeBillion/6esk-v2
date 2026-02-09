import BrandMark from "@/app/components/BrandMark";

export default function HomePage() {
  return (
    <main>
      <div className="container">
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <BrandMark size={56} priority />
        </div>
        <p>Foundation and email APIs are ready.</p>
        <p>
          Health check: <code>/api/health</code>
        </p>
        <p>
          Continue to <code>/login</code>, <code>/mail</code>, <code>/tickets</code>, or{" "}
          <code>/analytics</code>.
        </p>
      </div>
    </main>
  );
}
