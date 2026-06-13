import Link from "next/link";
import { getUser } from "@/lib/auth/session";
import { signOut } from "@/app/login/actions";

export default async function Nav() {
  const user = await getUser();

  return (
    <nav className="border-b text-sm">
      <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-6">
        <Link href="/dashboard" className="font-semibold">
          LexAI
        </Link>
        {user && (
          <>
            <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
              Dashboard
            </Link>
            <Link href="/documents" className="text-gray-600 hover:text-gray-900">
              Documents
            </Link>
            <Link href="/search" className="text-gray-600 hover:text-gray-900">
              Search
            </Link>
            <Link href="/cases" className="text-gray-600 hover:text-gray-900">
              Cases
            </Link>
            <form action={signOut} className="ml-auto">
              <button type="submit" className="text-gray-600 hover:text-gray-900">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </nav>
  );
}
