import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AvatarUploader } from './avatar-uploader';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

// apps/api's own wording, hand-copied from `profile.constants.ts` rather than
// imported: the browser-side checks are a convenience duplicate of the API's
// limits (task 4.3), and a spec that imported the shared constant could not
// catch the copy drifting away from what the API actually answers.
const AVATAR_SIZE_LIMIT_MESSAGE = 'Avatar exceeds the 5 MB limit.';
const UNSUPPORTED_AVATAR_TYPE_MESSAGE =
  'Unsupported image type. Accepted types: png, jpg, webp.';
const MAX_AVATAR_BYTES = 5_242_880;

/**
 * Builds a `File` of a declared type and size without allocating its bytes —
 * the browser-side checks read `file.size` and `file.type` alone, so a
 * 5 MB-plus fixture would cost memory and prove nothing extra.
 * @param options - What the file should claim about itself.
 * @param options.name - The file name.
 * @param options.type - The declared MIME type.
 * @param options.size - The size to report, defaulting to the real byte length.
 * @returns The file, ready to hand to the file input.
 */
function fileOf({
  name,
  type,
  size,
}: {
  name: string;
  type: string;
  size?: number;
}): File {
  const file = new File(['avatar-bytes'], name, { type });
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

/**
 * Replaces `fetch` with a stub resolving to a fixed proxy response.
 * @param response - What the stubbed `/api/profile/avatar` proxy answers with.
 * @returns The stub, for asserting how it was called.
 */
function mockProxy(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Builds a proxy response carrying apps/api's refusal body, the shape
 * `extractErrorMessage` already reads elsewhere in this app.
 * @param status - The refusal status.
 * @param message - The refusal message apps/api answered with.
 * @returns The response to stub the proxy with.
 */
function refusal(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Hands a file to the uploader's file input.
 * @param file - The file to select.
 * @param options - Upload options passed through to `user-event`.
 * @param options.applyAccept - Whether the input's `accept` filter applies;
 * `false` models a file arriving past the picker's own hint (drag and drop,
 * or a picker set to "All files").
 */
async function selectAvatar(
  file: File,
  { applyAccept = true }: { applyAccept?: boolean } = {},
): Promise<void> {
  await userEvent.upload(
    screen.getByLabelText('Select an avatar image'),
    file,
    {
      applyAccept,
    },
  );
}

/**
 * Reads the `avatar` part out of the FormData the proxy was last called with.
 * @param fetchMock - The `fetch` stub returned by {@link mockProxy}.
 * @returns The submitted file.
 */
function submittedAvatar(fetchMock: ReturnType<typeof mockProxy>): File {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return (init.body as FormData).get('avatar') as File;
}

describe('AvatarUploader', () => {
  beforeEach(() => {
    mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('sends the chosen image to the same-origin proxy as the `avatar` part (D-12)', async () => {
    const fetchMock = mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name: 'me.png', type: 'image/png' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/profile/avatar');
    expect(init.method).toBe('POST');
    // The field name apps/api's `FileInterceptor('avatar')` expects.
    expect(submittedAvatar(fetchMock).name).toBe('me.png');
  });

  it('re-renders the server tree on success, so both pages show the new image without a reload (AC-6)', async () => {
    mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name: 'me.webp', type: 'image/webp' }));

    // `router.refresh()` is what re-fetches `avatarUpdatedAt` and so changes
    // the image URL, which is what defeats T-1's cached copy (D-8).
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a file over 5 MB in the browser, before any request is sent (AC-7)', async () => {
    const fetchMock = mockProxy(new Response(null, { status: 201 }));
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(
      fileOf({
        name: 'huge.png',
        type: 'image/png',
        size: MAX_AVATAR_BYTES + 1,
      }),
    );

    expect(
      await screen.findByText(AVATAR_SIZE_LIMIT_MESSAGE),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends a file of exactly 5 MB, since the limit is inclusive on both sides', async () => {
    const fetchMock = mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(
      fileOf({ name: 'exact.png', type: 'image/png', size: MAX_AVATAR_BYTES }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a declared type outside the three accepted ones, before any request is sent (AC-8)', async () => {
    const fetchMock = mockProxy(new Response(null, { status: 201 }));
    render(<AvatarUploader hasAvatar={false} />);

    // `applyAccept: false` on purpose: the input's `accept` attribute is a
    // hint the picker applies, not a boundary — a file can still arrive by
    // drag and drop or from a picker set to "All files", and that is the path
    // this check exists for.
    await selectAvatar(fileOf({ name: 'map.svg', type: 'image/svg+xml' }), {
      applyAccept: false,
    });

    expect(
      await screen.findByText(UNSUPPORTED_AVATAR_TYPE_MESSAGE),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['image/png', 'me.png'],
    ['image/jpeg', 'me.jpg'],
    ['image/webp', 'me.webp'],
  ])('accepts a declared %s', async (type, name) => {
    const fetchMock = mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name, type }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows apps/api's own refusal verbatim when a file gets past the browser-side check (AC-8)", async () => {
    // A file renamed to `.png` whose *content* is something else: it declares
    // an accepted type and a legal size, so only apps/api's content sniffing
    // can catch it, and its wording is what the user has to be shown.
    mockProxy(refusal(415, UNSUPPORTED_AVATAR_TYPE_MESSAGE));
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name: 'not-really.png', type: 'image/png' }));

    expect(
      await screen.findByText(UNSUPPORTED_AVATAR_TYPE_MESSAGE),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows the 5 MB refusal apps/api answers when the size check was passed a lying file (AC-7)', async () => {
    mockProxy(refusal(413, AVATAR_SIZE_LIMIT_MESSAGE));
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name: 'me.png', type: 'image/png' }));

    expect(
      await screen.findByText(AVATAR_SIZE_LIMIT_MESSAGE),
    ).toBeInTheDocument();
  });

  it('announces a refusal rather than only painting it (AC-7)', async () => {
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(
      fileOf({
        name: 'huge.png',
        type: 'image/png',
        size: MAX_AVATAR_BYTES + 1,
      }),
    );

    // The refusal arrives while focus is still on the upload control, so
    // without a live region a screen reader user is told nothing happened.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      AVATAR_SIZE_LIMIT_MESSAGE,
    );
  });

  it('says a first upload worked, since the new image itself is never announced', async () => {
    mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name: 'me.png', type: 'image/png' }));

    // Polite, not an alert: a success has no reason to interrupt.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Avatar uploaded.',
    );
  });

  it('calls a replacement a replacement, not a first upload', async () => {
    mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    render(<AvatarUploader hasAvatar />);

    await selectAvatar(fileOf({ name: 'me.png', type: 'image/png' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Avatar replaced.',
    );
  });

  it('reports a transport failure instead of failing silently', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(fileOf({ name: 'me.png', type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed/i);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('withdraws a refusal when another file is chosen, so a retry is not blocked by the last attempt', async () => {
    render(<AvatarUploader hasAvatar={false} />);

    await selectAvatar(
      fileOf({
        name: 'huge.png',
        type: 'image/png',
        size: MAX_AVATAR_BYTES + 1,
      }),
    );
    expect(
      await screen.findByText(AVATAR_SIZE_LIMIT_MESSAGE),
    ).toBeInTheDocument();

    mockProxy(
      new Response(JSON.stringify({ hasAvatar: true }), { status: 201 }),
    );
    await selectAvatar(fileOf({ name: 'small.png', type: 'image/png' }));

    expect(
      screen.queryByText(AVATAR_SIZE_LIMIT_MESSAGE),
    ).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe('removing the avatar (AC-9)', () => {
    it('offers no removal control to an account that holds no avatar', () => {
      render(<AvatarUploader hasAvatar={false} />);

      expect(
        screen.queryByRole('button', { name: 'Remove avatar' }),
      ).not.toBeInTheDocument();
    });

    it('removes through the proxy and re-renders the server tree', async () => {
      const fetchMock = mockProxy(
        new Response(JSON.stringify({ hasAvatar: false }), { status: 200 }),
      );
      render(<AvatarUploader hasAvatar />);

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove avatar' }),
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/profile/avatar');
      expect(init.method).toBe('DELETE');
      // Both pages read `hasAvatar` server-side, so only a refresh returns
      // them to the placeholder (AC-9).
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('says the avatar is gone, since the mark returning to initials is not announced either', async () => {
      mockProxy(
        new Response(JSON.stringify({ hasAvatar: false }), { status: 200 }),
      );
      render(<AvatarUploader hasAvatar />);

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove avatar' }),
      );

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Avatar removed.',
      );
    });

    it("shows apps/api's refusal and keeps the avatar when a removal fails", async () => {
      mockProxy(refusal(500, 'Could not remove the avatar.'));
      render(<AvatarUploader hasAvatar />);

      await userEvent.click(
        screen.getByRole('button', { name: 'Remove avatar' }),
      );

      expect(
        await screen.findByText('Could not remove the avatar.'),
      ).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
