import { signIn, signUp } from "./actions";

export default async function LoginPage(
  { searchParams }: { searchParams: Promise<{ error?: string }> }
) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-xl font-semibold">LexAI — Sign in</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <form className="space-y-3">
        <input name="email" type="email" required placeholder="Email"
          className="w-full rounded border p-2" />
        <input name="password" type="password" required placeholder="Password"
          className="w-full rounded border p-2" />
        <div className="flex gap-2">
          <button formAction={signIn}
            className="rounded bg-black px-4 py-2 text-white">Sign in</button>
          <button formAction={signUp}
            className="rounded border px-4 py-2">Sign up</button>
        </div>
      </form>
    </main>
  );
}
