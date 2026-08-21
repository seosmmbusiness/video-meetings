import { PayloadTooLargeException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  AVATAR_IDLE_TIMEOUT_MS,
  AVATAR_SIZE_LIMIT_MESSAGE,
  MAX_AVATAR_BYTES,
} from '../profile.constants';
import { AvatarSizeGuard } from './avatar-size.guard';

/**
 * Builds a minimal `ExecutionContext` carrying a stub request, enough for
 * `AvatarSizeGuard.canActivate` to read the declared size and arm the
 * inactivity timeout. The mocks are returned as their own named handles so
 * assertions never reference a class-typed method value directly.
 * @param contentLength - The `content-length` header value, or `undefined`
 * to simulate a chunked request that declares none.
 * @returns The stub context plus the mocks it wraps.
 */
function buildContext(contentLength: string | undefined) {
  let onIdle: () => void = () => {
    /* replaced once the guard calls request.setTimeout */
  };
  const setTimeout = jest.fn((_ms: number, cb: () => void) => {
    onIdle = cb;
  });
  const destroy = jest.fn();
  const request = {
    headers: { 'content-length': contentLength },
    user: { userId: 'owner-1' },
    setTimeout,
    destroy,
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, setTimeout, destroy, onIdle: () => onIdle() };
}

describe('AvatarSizeGuard', () => {
  it('refuses a declared size over the 5 MB ceiling at zero bytes read (AC-7)', () => {
    const guard = new AvatarSizeGuard();
    const { context, setTimeout } = buildContext(String(MAX_AVATAR_BYTES + 1));

    expect(() => guard.canActivate(context)).toThrow(PayloadTooLargeException);
    // Refused before anything is armed, and before a byte is read: the guard
    // runs ahead of `FileInterceptor` (D-6).
    expect(setTimeout).not.toHaveBeenCalled();
  });

  it('states the 5 MB limit verbatim in the refusal (AC-7)', () => {
    const guard = new AvatarSizeGuard();
    const { context } = buildContext(String(MAX_AVATAR_BYTES + 1));

    expect(() => guard.canActivate(context)).toThrow(AVATAR_SIZE_LIMIT_MESSAGE);
  });

  it('lets a body exactly at the ceiling through and arms the inactivity timeout', () => {
    const guard = new AvatarSizeGuard();
    const { context, setTimeout } = buildContext(String(MAX_AVATAR_BYTES));

    expect(guard.canActivate(context)).toBe(true);
    expect(setTimeout).toHaveBeenCalledWith(
      AVATAR_IDLE_TIMEOUT_MS,
      expect.any(Function),
    );
  });

  it("destroys the request when the idle timeout's callback fires", () => {
    const guard = new AvatarSizeGuard();
    const { context, destroy, onIdle } = buildContext('1000');

    guard.canActivate(context);
    onIdle();

    expect(destroy).toHaveBeenCalled();
  });

  it('treats a chunked request that declares nothing as the ceiling, not as zero', () => {
    const guard = new AvatarSizeGuard();
    const { context, setTimeout } = buildContext(undefined);

    // It passes the declared-size gate — multer's own `limits.fileSize` is
    // what catches this one once the bytes arrive (D-6, gate 2).
    expect(guard.canActivate(context)).toBe(true);
    expect(setTimeout).toHaveBeenCalled();
  });

  it('treats an unparseable Content-Length as the ceiling rather than as zero', () => {
    const guard = new AvatarSizeGuard();
    const { context } = buildContext('not-a-number');

    expect(guard.canActivate(context)).toBe(true);
  });
});
