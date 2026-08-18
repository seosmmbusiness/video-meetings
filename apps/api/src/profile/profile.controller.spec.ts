import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileController } from './profile.controller';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { ProfileService } from './profile.service';

const CALLER: AuthenticatedUser = {
  userId: 'user-1',
  email: 'alice@example.com',
};

const PROFILE: ProfileResponseDto = {
  id: 'user-1',
  email: 'alice@example.com',
  name: 'Alice',
  hasAvatar: false,
  avatarUpdatedAt: null,
};

describe('ProfileController', () => {
  let service: { getProfile: jest.Mock; updateProfile: jest.Mock };
  let controller: ProfileController;

  beforeEach(() => {
    service = {
      getProfile: jest.fn().mockResolvedValue(PROFILE),
      updateProfile: jest.fn().mockResolvedValue(PROFILE),
    };
    controller = new ProfileController(service as unknown as ProfileService);
  });

  it('is protected by the JWT guard, so an anonymous caller never reaches it', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      ProfileController,
    ) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });

  describe('GET /profile', () => {
    it('resolves the subject from the token alone (AC-15)', async () => {
      await expect(controller.getProfile(CALLER)).resolves.toBe(PROFILE);

      expect(service.getProfile).toHaveBeenCalledWith('user-1');
    });
  });

  describe('PATCH /profile', () => {
    it("passes the caller's own id and the validated payload (AC-15)", async () => {
      await expect(
        controller.updateProfile(CALLER, { name: 'Alice' }),
      ).resolves.toBe(PROFILE);

      expect(service.updateProfile).toHaveBeenCalledWith('user-1', {
        name: 'Alice',
      });
    });

    it('ignores an id smuggled into the body — the token stays the subject (AC-15)', async () => {
      await controller.updateProfile(CALLER, {
        name: 'Alice',
        id: 'someone-else',
        userId: 'someone-else',
      } as never);

      expect(service.updateProfile).toHaveBeenCalledWith(
        'user-1',
        expect.anything(),
      );
      const [subjectId] = service.updateProfile.mock.calls[0] as [string];
      expect(subjectId).toBe('user-1');
    });
  });
});
