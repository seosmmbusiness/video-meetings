const DEFAULT_API_BASE_URL = 'http://localhost:3001';

/** Response body returned by the register and login endpoints. */
export interface AuthResponse {
  accessToken: string;
}

/** Payload for `POST /auth/register`, matching the backend `RegisterDto`. */
export interface RegisterInput {
  email: string;
  password: string;
  consentToTerms: boolean;
}

/** Payload for `POST /auth/login`, matching the backend `LoginDto`. */
export interface LoginInput {
  email: string;
  password: string;
}

/** Thrown when the apps/api backend responds with a non-2xx status. */
export class ApiError extends Error {
  /**
   * @param message - A human-readable error message from the API response.
   * @param status - The HTTP status code of the failed response.
   */
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Resolves the base URL of the apps/api backend.
 * @returns `NEXT_PUBLIC_API_URL` if set, otherwise the local dev default (`http://localhost:3001`).
 */
function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_BASE_URL;
}

/**
 * Extracts a display message from an apps/api error response body, which
 * shapes `message` as either a single string or (for `class-validator`
 * failures) an array of per-field messages.
 * @param body - The parsed JSON error body, or `null` if parsing failed.
 * @param fallback - Message to use when the body has no usable `message`.
 * @returns A single human-readable error message.
 */
function extractErrorMessage(body: unknown, fallback: string): string {
  const message = (body as { message?: string | string[] } | null)?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message ?? fallback;
}

/**
 * Posts a JSON payload to an apps/api endpoint and parses the JSON response.
 * @param path - API path relative to the base URL, e.g. `/auth/login`.
 * @param body - JSON-serializable request payload.
 * @returns The parsed JSON response body.
 * @throws {ApiError} When the response status is not in the 2xx range.
 */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(data, response.statusText),
      response.status,
    );
  }

  return data as T;
}

/**
 * Registers a new account via `POST /auth/register`.
 * @param input - Registration payload (email, password, terms consent).
 * @returns The signed JWT access token for the newly created account.
 * @throws {ApiError} When registration fails (validation error or duplicate email).
 */
export function registerAccount(input: RegisterInput): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/register', input);
}

/**
 * Logs in with an existing account via `POST /auth/login`.
 * @param input - Login payload (email, password).
 * @returns The signed JWT access token for the account.
 * @throws {ApiError} When the credentials are invalid or the request is throttled.
 */
export function loginAccount(input: LoginInput): Promise<AuthResponse> {
  return postJson<AuthResponse>('/auth/login', input);
}
