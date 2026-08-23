import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProfileController } from './profile.controller';
import { ChangePasswordDto } from './dto/change-password.dto';
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

/** The profile of an account that already holds an avatar. */
const PROFILE_WITH_AVATAR: ProfileResponseDto = {
  ...PROFILE,
  hasAvatar: true,
  avatarUpdatedAt: new Date('2026-08-21T10:00:00.000Z'),
};

/** The checked upload the pipe hands the route, carrying its detected type. */
const CHECKED_UPLOAD = {
  path: '/srv/.data/uploads/tmp/staged-avatar',
  mimetype: 'image/png',
  size: 2048,
};

/**
 * Builds a response double recording exactly what the byte-serving route
 * sets on it.
 * @returns A stubbed Express response.
 */
function responseDouble(): {
  set: jest.Mock;
  status: jest.Mock;
  sendFile: jest.Mock;
} {
  const res = {
    set: jest.fn(),
    status: jest.fn(),
    sendFile: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('ProfileController', () => {
  let service: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    setAvatar: jest.Mock;
    getAvatarFile: jest.Mock;
    removeAvatar: jest.Mock;
    changePassword: jest.Mock;
  };
  let controller: ProfileController;

  beforeEach(() => {
    service = {
      getProfile: jest.fn().mockResolvedValue(PROFILE),
      updateProfile: jest.fn().mockResolvedValue(PROFILE),
      setAvatar: jest.fn().mockResolvedValue(PROFILE_WITH_AVATAR),
      getAvatarFile: jest.fn().mockResolvedValue({
        path: '/srv/.data/uploads/users/user-1/avatar/stored',
        mimeType: 'image/png',
      }),
      removeAvatar: jest.fn().mockResolvedValue(PROFILE),
      changePassword: jest.fn().mockResolvedValue(undefined),
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

  describe('POST /profile/avatar', () => {
    it("commits the checked upload against the caller's own id (AC-15)", async () => {
      const res = responseDouble();

      await expect(
        controller.setAvatar(CALLER, CHECKED_UPLOAD, res as never),
      ).resolves.toBe(PROFILE_WITH_AVATAR);

      expect(service.setAvatar).toHaveBeenCalledWith('user-1', CHECKED_UPLOAD);
    });

    it('answers 201 when the account had no avatar yet (AC-6)', async () => {
      service.getProfile.mockResolvedValue(PROFILE);
      const res = responseDouble();

      await controller.setAvatar(CALLER, CHECKED_UPLOAD, res);

      expect(res.status).not.toHaveBeenCalled();
    });

    it('answers 200 when it replaced an existing avatar (AC-6)', async () => {
      service.getProfile.mockResolvedValue(PROFILE_WITH_AVATAR);
      const res = responseDouble();

      await controller.setAvatar(CALLER, CHECKED_UPLOAD, res);

      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('GET /profile/avatar', () => {
    it('serves the caller their own bytes with D-8 and T-1’s headers', async () => {
      const res = responseDouble();

      await controller.getAvatar(CALLER, res);

      expect(service.getAvatarFile).toHaveBeenCalledWith('user-1');
      expect(res.set).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.set).toHaveBeenCalledWith('Content-Disposition', 'inline');
      expect(res.set).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(res.set).toHaveBeenCalledWith(
        'Cache-Control',
        'private, max-age=60',
      );
    });

    it("splits the path so send's dotfiles check never sees STORAGE_ROOT (D-8)", async () => {
      const res = responseDouble();

      await controller.getAvatar(CALLER, res);

      expect(res.sendFile).toHaveBeenCalledWith('stored', {
        root: '/srv/.data/uploads/users/user-1/avatar',
        dotfiles: 'deny',
      });
    });

    it('lets a missing avatar surface as the service raised it (AC-9)', async () => {
      const failure = new Error('Avatar not found');
      service.getAvatarFile.mockRejectedValue(failure);
      const res = responseDouble();

      await expect(controller.getAvatar(CALLER, res as never)).rejects.toBe(
        failure,
      );
      expect(res.sendFile).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /profile/avatar', () => {
    it("removes the caller's own avatar and answers the profile (AC-9, AC-15)", async () => {
      await expect(controller.removeAvatar(CALLER)).resolves.toBe(PROFILE);

      expect(service.removeAvatar).toHaveBeenCalledWith('user-1');
    });
  });

  describe('PATCH /profile/password', () => {
    const CHANGE: ChangePasswordDto = {
      currentPassword: 'Str0ngPass',
      newPassword: 'N3wStrongPass',
    };

    it('takes its subject from the token, never from the body (AC-15)', async () => {
      await controller.changePassword(CALLER, CHANGE);

      expect(service.changePassword).toHaveBeenCalledWith('user-1', CHANGE);
    });

    it('answers the fresh token the service issued, alone (AC-13, AC-18)', async () => {
      service.changePassword.mockResolvedValue({
        accessToken: 'signed.jwt.token',
      });

      const response = await controller.changePassword(CALLER, CHANGE);

      expect(response).toEqual({ accessToken: 'signed.jwt.token' });
    });

    it('carries the same throttle override /auth/login does (S-4, AC-20)', () => {
      // The route answers whether a supplied password is the account's, so
      // one stolen session must not buy the global 20 guesses a minute.
      // @nestjs/throttler writes one metadata key per named throttler and
      // exports neither prefix from its entry point, hence the literals.
      const route = Object.getOwnPropertyDescriptor(
        ProfileController.prototype,
        'changePassword',
      )?.value as object;
      const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', route) as
        number | undefined;
      const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', route) as
        number | undefined;

      expect(limit).toBe(10);
      expect(ttl).toBe(60_000);
    });

    it("lets the service's refusal through untouched (AC-11)", async () => {
      const failure = new ForbiddenException('Current password is incorrect.');
      service.changePassword.mockRejectedValue(failure);

      await expect(controller.changePassword(CALLER, CHANGE)).rejects.toBe(
        failure,
      );
    });
  });
});
