import { signIn, signUp } from "./actions";

export default async function LoginPage(
  { searchParams }: { searchParams: Promise<{ error?: string }> }
) {
  const { error } = await searchParams;
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0d0d0d",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "380px",
          backgroundColor: "#171717",
          border: "1px solid #2a2a2a",
          borderRadius: "12px",
          padding: "32px",
        }}
      >
        <div style={{ marginBottom: "28px", textAlign: "center" }}>
          <span style={{ fontWeight: 700, fontSize: "24px", color: "#ffffff" }}>Lex</span>
          <span style={{ fontWeight: 700, fontSize: "24px", color: "#f59e0b" }}>AI</span>
          <p style={{ color: "#9ca3af", fontSize: "13px", marginTop: "6px" }}>Legal evidence management</p>
        </div>

        {error && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 12px",
              borderRadius: "6px",
              backgroundColor: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#ef4444",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        )}

        <form style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <input
            name="email"
            type="text"
            required
            placeholder="Username"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #2a2a2a",
              backgroundColor: "#0d0d0d",
              color: "#ffffff",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #2a2a2a",
              backgroundColor: "#0d0d0d",
              color: "#ffffff",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
            <button
              formAction={signIn}
              style={{
                flex: 1,
                padding: "10px",
                fontSize: "14px",
                fontWeight: 600,
                borderRadius: "6px",
                backgroundColor: "#f59e0b",
                color: "#000",
                border: "none",
                cursor: "pointer",
              }}
            >
              Sign in
            </button>
            <button
              formAction={signUp}
              style={{
                flex: 1,
                padding: "10px",
                fontSize: "14px",
                borderRadius: "6px",
                backgroundColor: "transparent",
                border: "1px solid #2a2a2a",
                color: "#9ca3af",
                cursor: "pointer",
              }}
            >
              Sign up
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
