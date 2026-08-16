import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { MeetingsService } from '../../meetings/meetings.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

/** Request shape once {@link JwtAuthGuard} and this guard have both run. */
interface MeetingScopedRequest extends Request {
  user: AuthenticatedUser;
  params: Request['params'] & { meetingId: string };
}

/**
 * Resolves `:meetingId` against the authenticated caller before any other
 * guard, interceptor or handler runs, so a caller who does not own that
 * meeting gets the same 404 `MeetingsService.findOneForOwner` already gives
 * elsewhere — at zero bytes read, since Nest runs guards before
 * interceptors (and `FileInterceptor` is an interceptor).
 */
@Injectable()
export class MeetingOwnerGuard implements CanActivate {
  /** @param meetingsService - Reused to resolve `:meetingId` against the caller. */
  constructor(private readonly meetingsService: MeetingsService) {}

  /**
   * @param context - The current execution context.
   * @returns `true` once the meeting is confirmed to belong to the caller.
   * @throws NotFoundException if the meeting does not exist or belongs to
   * someone else.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MeetingScopedRequest>();
    await this.meetingsService.findOneForOwner(
      request.params.meetingId,
      request.user.userId,
    );
    return true;
  }
}
