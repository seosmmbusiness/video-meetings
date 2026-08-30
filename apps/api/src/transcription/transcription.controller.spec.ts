import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MeetingOwnerGuard } from '../files/guards/meeting-owner.guard';
import { TranscriptionController } from './transcription.controller';
import type { TranscriptionService } from './transcription.service';
import {
  TRANSCRIPTION_READ_THROTTLE_LIMIT,
  TRANSCRIPTION_READ_THROTTLE_TTL_MS,
} from './transcription.constants';

/**
 * The metadata keys `@Throttle({ default: … })` writes onto a handler, as
 * `@nestjs/throttler`'s `throttler.constants.ts` spells them — the package
 * does not re-export them from its entry point.
 */
const THROTTLER_LIMIT_KEY = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_KEY = 'THROTTLER:TTLdefault';

/** The key Nest writes `@UseGuards` onto a controller class with. */
const GUARDS_KEY = '__guards__';

/** The caller every case acts as. */
const CALLER: AuthenticatedUser = {
  userId: 'owner-1',
  email: 'owner@example.com',
};

/**
 * The function `@Throttle` wrote its metadata onto — read off the prototype's
 * descriptor rather than by naming the method, which would hand an unbound
 * method around.
 * @param route - The handler's method name.
 * @returns The handler function itself.
 */
function handlerOf(route: string): object {
  const descriptor = Object.getOwnPropertyDescriptor(
    TranscriptionController.prototype,
    route,
  );
  return descriptor?.value as object;
}

/** One call the controller made into the service. */
interface ServiceCall {
  method: string;
  args: string[];
}

/**
 * Builds a stub `TranscriptionService` recording what the controller asked of
 * it, and answering with fixed views.
 * @returns The stand-in service and the calls it recorded.
 */
function stubService(): {
  service: TranscriptionService;
  calls: ServiceCall[];
} {
  const calls: ServiceCall[] = [];

  const service = {
    startForOwner: (fileId: string, meetingId: string, ownerId: string) => {
      calls.push({
        method: 'startForOwner',
        args: [fileId, meetingId, ownerId],
      });
      return Promise.resolve({ fileId, state: 'QUEUED' });
    },
    getForOwner: (fileId: string, meetingId: string, ownerId: string) => {
      calls.push({ method: 'getForOwner', args: [fileId, meetingId, ownerId] });
      return Promise.resolve({ fileId, state: 'SUCCEEDED' });
    },
    listForOwner: (meetingId: string, ownerId: string) => {
      calls.push({ method: 'listForOwner', args: [meetingId, ownerId] });
      return Promise.resolve([{ fileId: 'file-1', state: 'QUEUED' }]);
    },
  } as unknown as TranscriptionService;

  return { service, calls };
}

describe('TranscriptionController', () => {
  it('starts a run for the file named in the path, on behalf of the caller alone', async () => {
    const { service, calls } = stubService();
    const controller = new TranscriptionController(service);

    await controller.start('meeting-1', 'file-1', CALLER);

    expect(calls).toEqual([
      { method: 'startForOwner', args: ['file-1', 'meeting-1', 'owner-1'] },
    ]);
  });

  it("reads one file's transcription on behalf of the caller alone", async () => {
    const { service, calls } = stubService();
    const controller = new TranscriptionController(service);

    await controller.readOne('meeting-1', 'file-1', CALLER);

    expect(calls).toEqual([
      { method: 'getForOwner', args: ['file-1', 'meeting-1', 'owner-1'] },
    ]);
  });

  it("wraps the meeting's run states in `transcriptions` (D-6)", async () => {
    const { service, calls } = stubService();
    const controller = new TranscriptionController(service);

    const body = await controller.list('meeting-1', CALLER);

    expect(calls).toEqual([
      { method: 'listForOwner', args: ['meeting-1', 'owner-1'] },
    ]);
    expect(body).toEqual({
      transcriptions: [{ fileId: 'file-1', state: 'QUEUED' }],
    });
  });

  it('resolves the caller and the meeting before any handler runs (S-1)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_KEY,
      TranscriptionController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(MeetingOwnerGuard);
  });

  it('lets the page poll both read routes without throttling its own owner out (D-6)', () => {
    for (const route of ['readOne', 'list']) {
      expect(Reflect.getMetadata(THROTTLER_LIMIT_KEY, handlerOf(route))).toBe(
        TRANSCRIPTION_READ_THROTTLE_LIMIT,
      );
      expect(Reflect.getMetadata(THROTTLER_TTL_KEY, handlerOf(route))).toBe(
        TRANSCRIPTION_READ_THROTTLE_TTL_MS,
      );
    }
  });

  it('leaves the start route on the global baseline, which is what AC-17 is about', () => {
    const start = handlerOf('start');

    expect(Reflect.getMetadata(THROTTLER_LIMIT_KEY, start)).toBeUndefined();
    expect(Reflect.getMetadata(THROTTLER_TTL_KEY, start)).toBeUndefined();
  });
});
