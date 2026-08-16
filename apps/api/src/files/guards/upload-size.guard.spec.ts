import { PayloadTooLargeException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { MAX_FILE_BYTES, UPLOAD_IDLE_TIMEOUT_MS } from '../files.constants';
import type { QuotaReservationService } from '../quota-reservation.service';
import { UploadSizeGuard } from './upload-size.guard';

/**
 * Builds a minimal `ExecutionContext` carrying a stub request/response,
 * enough for `UploadSizeGuard.canActivate` to read headers, the caller and
 * to register `once` listeners. Mock functions are returned as their own
 * named handles (rather than read back off the stub objects) so assertions
 * never reference a class-typed method value directly.
 * @param contentLength - The `content-length` header value, or `undefined`
 * to simulate a chunked request that declares none.
 * @returns The stub context plus the mocks/listeners it wraps.
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
  const listeners: Record<string, () => void> = {};
  const once = jest.fn((event: string, cb: () => void) => {
    listeners[event] = cb;
  });
  const response = { once };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return {
    context,
    setTimeout,
    destroy,
    listeners,
    onIdle: () => onIdle(),
  };
}

/**
 * Builds a stub `QuotaReservationService` whose `reserve` resolves to
 * `release` (or throws, if given a rejection instead).
 * @param release - The release function `reserve` should resolve to.
 * @returns The stub service plus the `reserve` mock as its own handle.
 */
function buildQuota(release: () => void = jest.fn()) {
  const reserve = jest.fn().mockResolvedValue(release);
  const quota = { reserve } as unknown as QuotaReservationService;
  return { quota, reserve };
}

describe('UploadSizeGuard', () => {
  it('refuses a declared size over the per-file ceiling at zero bytes read', async () => {
    const { quota, reserve } = buildQuota();
    const guard = new UploadSizeGuard(quota);
    const { context } = buildContext(String(MAX_FILE_BYTES + 1));

    await expect(guard.canActivate(context)).rejects.toThrow(
      PayloadTooLargeException,
    );
    expect(reserve).not.toHaveBeenCalled();
  });

  it('reserves the declared size against the caller and arms the idle timeout', async () => {
    const { quota, reserve } = buildQuota();
    const guard = new UploadSizeGuard(quota);
    const { context, setTimeout } = buildContext('1000');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(reserve).toHaveBeenCalledWith('owner-1', 1000);
    expect(setTimeout).toHaveBeenCalledWith(
      UPLOAD_IDLE_TIMEOUT_MS,
      expect.any(Function),
    );
  });

  it("destroys the request when the idle timeout's callback fires", async () => {
    const { quota } = buildQuota();
    const guard = new UploadSizeGuard(quota);
    const { context, destroy, onIdle } = buildContext('1000');

    await guard.canActivate(context);
    onIdle();

    expect(destroy).toHaveBeenCalled();
  });

  it('reserves the per-file ceiling when no Content-Length is declared (chunked request)', async () => {
    const { quota, reserve } = buildQuota();
    const guard = new UploadSizeGuard(quota);
    const { context } = buildContext(undefined);

    await guard.canActivate(context);

    expect(reserve).toHaveBeenCalledWith('owner-1', MAX_FILE_BYTES);
  });

  it('releases the reservation exactly once even if both finish and close fire', async () => {
    const release = jest.fn();
    const { quota } = buildQuota(release);
    const guard = new UploadSizeGuard(quota);
    const { context, listeners } = buildContext('1000');

    await guard.canActivate(context);
    listeners.finish();
    listeners.close();

    expect(release).toHaveBeenCalledTimes(1);
  });
});
