# apps/web/src (auth pages)

Architecture and function reference for the registration and login UI: `/register` and `/login`, plus the small client-side helpers they share with the home page.

This is apps/web's first real feature module. It talks to `apps/api`'s `src/auth` module (see `module-api-auth.md`) over plain `fetch`, using the `POST /auth/register` / `POST /auth/login` contract documented there — there's no shared types package between the two apps, so the DTO shapes are duplicated by hand in `lib/auth-api.ts` and must be kept in sync manually if the backend DTOs change.

## Architecture

- `app/register/page.tsx`, `app/login/page.tsx` — client components (`'use client'`) rendering a HeroUI `Card` + `Form`. Both call their respective `lib/auth-api.ts` function on submit, store the returned JWT via `lib/auth-storage.ts`, and redirect to `/` (`useRouter().push('/')`) on success.
- `lib/auth-api.ts` — the HTTP client: `registerAccount`/`loginAccount` post to `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`, apps/api's dev port), parse the JSON response, and throw `ApiError` (with the backend's status code and message) on a non-2xx response.
- `lib/auth-storage.ts` — wraps `localStorage` for the JWT (`saveAccessToken`/`getAccessToken`/`clearAccessToken`), plus `getEmailFromToken` (decodes the `email` claim client-side, display-only, signature not verified) and `subscribeToAccessTokenChanges` (for `useSyncExternalStore` consumers — see Gotchas).
- `app/page.tsx` (home) — reads sign-in state via `useSyncExternalStore(subscribeToAccessTokenChanges, ...)` and renders either "Get started"/"Sign in" buttons or a "Signed in as `<email>`" + "Sign out" state.

## Gotchas (non-obvious, worth preserving)

- **No CORS proxy — apps/api enables CORS directly.** apps/web (port 3000) calls apps/api (port 3001) cross-origin from the browser. Rather than a Next.js rewrite/proxy, `apps/api`'s `main.ts` calls `app.enableCors({ origin: CORS_ORIGIN })` (default `http://localhost:3000`) — see `module-api-auth.md`'s parent doc / `apps/api/CLAUDE.md`. If you add more web origins (e.g. a deployed URL), update `CORS_ORIGIN` in `.env`, not this module.
- **Why `useSyncExternalStore` instead of `useEffect` + `useState` for reading the token**: the obvious `useEffect(() => setState(getAccessToken()), [])` pattern trips this repo's `react-hooks/set-state-in-effect` lint rule (calling `setState` synchronously in an effect body) and also can't react to a same-tab sign-out without extra plumbing. `useSyncExternalStore` reads the current `localStorage` value synchronously during render (correct on fresh mount after a client-side navigation) and re-renders on either the cross-tab `storage` event or the same-tab `video-meetings:access-token-change` custom event that `saveAccessToken`/`clearAccessToken` dispatch.
- **Password confirmation is client-only.** `RegisterDto` (backend) has no `confirmPassword` field; the register page compares `password`/`confirmPassword` itself before calling the API and never sends `confirmPassword`.
- **Client-side password validation mirrors, but doesn't replace, the backend's.** The register page re-implements `RegisterDto`'s complexity regex (`PASSWORD_COMPLEXITY_REGEX`) and length bounds for instant `FieldError` feedback; the backend remains the source of truth; if `RegisterDto`'s rules change, update the copy in `app/register/page.tsx` too.
- **Password field placeholders must not be literal bullet characters.** An empty `Input` with `placeholder="••••••••"` is visually indistinguishable from a filled, masked password — use descriptive placeholder text (e.g. "Create a password") instead.
- **Error messages surface backend validation as-is.** `class-validator`'s `ValidationPipe` returns `message` as a string array for 400s and a plain string for 401/409/429s; `lib/auth-api.ts`'s `extractErrorMessage` joins the array case with spaces so either shape renders as one line in the `Alert`.

## Function reference

- `RegisterPage(): JSX.Element` (`app/register/page.tsx`) — the registration form; internal `handleSubmit` does client-side password-match validation, calls `registerAccount`, stores the token, redirects.
- `LoginPage(): JSX.Element` (`app/login/page.tsx`) — the login form; internal `handleSubmit` calls `loginAccount`, stores the token, redirects.
- `Home(): JSX.Element` (`app/page.tsx`) — landing page; reads `signedInEmail` via `useSyncExternalStore` and renders the signed-in/signed-out state.
- `registerAccount(input: RegisterInput): Promise<AuthResponse>` (`lib/auth-api.ts`) — `POST /auth/register`.
- `loginAccount(input: LoginInput): Promise<AuthResponse>` (`lib/auth-api.ts`) — `POST /auth/login`.
- `ApiError` (`lib/auth-api.ts`) — `Error` subclass carrying the HTTP `status` alongside the message.
- `saveAccessToken(token: string): void` / `getAccessToken(): string | null` / `clearAccessToken(): void` (`lib/auth-storage.ts`) — `localStorage` read/write/clear; each write dispatches the same-tab change event.
- `getEmailFromToken(token: string): string | null` (`lib/auth-storage.ts`) — decodes the JWT payload's `email` claim without verifying the signature (display-only).
- `subscribeToAccessTokenChanges(callback: () => void): () => void` (`lib/auth-storage.ts`) — the `useSyncExternalStore` subscribe function described above.
