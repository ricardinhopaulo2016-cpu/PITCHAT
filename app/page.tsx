// proxy.ts always redirects "/" to /setup, /login or /dashboard before this
// renders. This file exists only because the App Router requires a page at
// the root segment.
export default function RootPage() {
  return null;
}
