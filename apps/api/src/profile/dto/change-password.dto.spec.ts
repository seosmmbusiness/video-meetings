import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const LENGTH_MESSAGE = `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters long`;
const MAX_LENGTH_MESSAGE = `newPassword must not exceed ${MAX_PASSWORD_LENGTH} characters`;
const COMPLEXITY_MESSAGE =
  'newPassword must contain an uppercase letter, a lowercase letter, and a digit';

const VALID_CURRENT = 'Str0ngPass';
const VALID_NEW = 'N3wStrongPass';

/**
 * Runs a raw payload through the DTO exactly as the global `ValidationPipe`
 * does — transform first, then validate with `whitelist` on.
 * @param payload - The raw request body to validate.
 * @returns The transformed instance and the validation errors it produced.
 */
async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(ChangePasswordDto, payload);
  const errors = await validate(dto, { whitelist: true });

  return { dto, errors };
}

/**
 * Collects every constraint message a single property produced.
 * @param payload - The raw request body to validate.
 * @param property - The property whose messages are wanted.
 * @returns The messages that property's failed constraints carried.
 */
async function messagesFor(
  payload: Record<string, unknown>,
  property: string,
): Promise<string[]> {
  const { errors } = await validateDto(payload);

  return errors
    .filter((error) => error.property === property)
    .flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('ChangePasswordDto', () => {
  describe('newPassword — the registration rules (AC-12)', () => {
    it('accepts a password that holds every rule', async () => {
      const { errors } = await validateDto({
        currentPassword: VALID_CURRENT,
        newPassword: VALID_NEW,
      });

      expect(errors).toHaveLength(0);
    });

    it('accepts exactly 8 characters', async () => {
      const { errors } = await validateDto({
        currentPassword: VALID_CURRENT,
        newPassword: 'Abcdefg1',
      });

      expect(errors).toHaveLength(0);
    });

    it('names the length rule at 7 characters', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT, newPassword: 'Ab1cdef' },
        'newPassword',
      );

      expect(messages).toContain(LENGTH_MESSAGE);
    });

    it('accepts exactly 72 characters', async () => {
      const { errors } = await validateDto({
        currentPassword: VALID_CURRENT,
        newPassword: `A1${'b'.repeat(MAX_PASSWORD_LENGTH - 2)}`,
      });

      expect(errors).toHaveLength(0);
    });

    it('names the 72-character cap at 73 characters', async () => {
      const messages = await messagesFor(
        {
          currentPassword: VALID_CURRENT,
          newPassword: `A1${'b'.repeat(MAX_PASSWORD_LENGTH - 1)}`,
        },
        'newPassword',
      );

      expect(messages).toContain(MAX_LENGTH_MESSAGE);
    });

    it('names the complexity rule when there is no uppercase letter', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT, newPassword: 'nouppercase1' },
        'newPassword',
      );

      expect(messages).toContain(COMPLEXITY_MESSAGE);
    });

    it('names the complexity rule when there is no lowercase letter', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT, newPassword: 'NOLOWERCASE1' },
        'newPassword',
      );

      expect(messages).toContain(COMPLEXITY_MESSAGE);
    });

    it('names the complexity rule when there is no digit', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT, newPassword: 'NoDigitsHere' },
        'newPassword',
      );

      expect(messages).toContain(COMPLEXITY_MESSAGE);
    });

    it('refuses an empty new password', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT, newPassword: '' },
        'newPassword',
      );

      expect(messages.length).toBeGreaterThan(0);
    });

    it('refuses a missing new password', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT },
        'newPassword',
      );

      expect(messages.length).toBeGreaterThan(0);
    });

    it('refuses a non-string new password rather than measuring it', async () => {
      const messages = await messagesFor(
        { currentPassword: VALID_CURRENT, newPassword: 12345678 },
        'newPassword',
      );

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('currentPassword — bounded like LoginDto, with no complexity check', () => {
    it('accepts a current password that would fail the complexity rule', async () => {
      const { errors } = await validateDto({
        currentPassword: 'oldweak',
        newPassword: VALID_NEW,
      });

      expect(errors).toHaveLength(0);
    });

    it('refuses an empty current password', async () => {
      const messages = await messagesFor(
        { currentPassword: '', newPassword: VALID_NEW },
        'currentPassword',
      );

      expect(messages).toContain('currentPassword must not be empty');
    });

    it('refuses a missing current password', async () => {
      const messages = await messagesFor(
        { newPassword: VALID_NEW },
        'currentPassword',
      );

      expect(messages.length).toBeGreaterThan(0);
    });

    it('accepts exactly 72 characters', async () => {
      const { errors } = await validateDto({
        currentPassword: 'a'.repeat(MAX_PASSWORD_LENGTH),
        newPassword: VALID_NEW,
      });

      expect(errors).toHaveLength(0);
    });

    it('names the 72-character cap at 73 characters', async () => {
      const messages = await messagesFor(
        {
          currentPassword: 'a'.repeat(MAX_PASSWORD_LENGTH + 1),
          newPassword: VALID_NEW,
        },
        'currentPassword',
      );

      expect(messages).toContain(
        `currentPassword must not exceed ${MAX_PASSWORD_LENGTH} characters`,
      );
    });

    it('refuses a non-string current password', async () => {
      const messages = await messagesFor(
        { currentPassword: 12345678, newPassword: VALID_NEW },
        'currentPassword',
      );

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('mass assignment (S-1)', () => {
    it('strips unknown fields rather than carrying them through', async () => {
      const { dto, errors } = await validateDto({
        currentPassword: VALID_CURRENT,
        newPassword: VALID_NEW,
        userId: 'someone-else',
        tokenVersion: 99,
      });

      expect(errors).toHaveLength(0);
      expect(dto).not.toHaveProperty('userId');
      expect(dto).not.toHaveProperty('tokenVersion');
      expect(Object.keys(dto).sort()).toEqual([
        'currentPassword',
        'newPassword',
      ]);
    });
  });
});
