import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

const MAX_NAME_LENGTH = 80;
const MAX_NAME_LENGTH_MESSAGE = 'Name must be 80 characters or fewer.';

/**
 * Runs a raw payload through the DTO exactly as the global `ValidationPipe`
 * does — transform first, then validate with `whitelist` on.
 * @param payload - The raw request body to validate.
 * @returns The transformed instance and the validation errors it produced.
 */
async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, payload);
  const errors = await validate(dto, { whitelist: true });

  return { dto, errors };
}

/**
 * Transforms a raw name through the DTO without validating it.
 * @param name - The raw name value.
 * @returns The normalised name the DTO produced.
 */
function normalisedName(name: string): unknown {
  return plainToInstance(UpdateProfileDto, { name }).name;
}

describe('UpdateProfileDto', () => {
  describe('name — length and trimming (D-2, AC-3)', () => {
    it('trims surrounding whitespace before validating', async () => {
      const { dto, errors } = await validateDto({ name: '  Alice Example  ' });

      expect(errors).toHaveLength(0);
      expect(dto.name).toBe('Alice Example');
    });

    it('accepts a name of exactly 80 characters after trimming', async () => {
      const name = 'a'.repeat(MAX_NAME_LENGTH);
      const { dto, errors } = await validateDto({ name: `   ${name}   ` });

      expect(errors).toHaveLength(0);
      expect(dto.name).toBe(name);
    });

    it('rejects 81 characters with the message naming the limit', async () => {
      const { errors } = await validateDto({
        name: 'a'.repeat(MAX_NAME_LENGTH + 1),
      });

      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})).toContain(
        MAX_NAME_LENGTH_MESSAGE,
      );
    });

    it('accepts a payload with no name at all (the field is optional)', async () => {
      const { errors } = await validateDto({});

      expect(errors).toHaveLength(0);
    });

    it('accepts an empty name — that is how a name is cleared (AC-4)', async () => {
      const { dto, errors } = await validateDto({ name: '   ' });

      expect(errors).toHaveLength(0);
      expect(dto.name).toBe('');
    });
  });

  describe('name — mass assignment (S-1)', () => {
    it('strips an unknown field rather than carrying it through', async () => {
      const { dto, errors } = await validateDto({
        name: 'Alice Example',
        isAdmin: true,
        passwordHash: 'nope',
      });

      expect(errors).toHaveLength(0);
      expect(dto).not.toHaveProperty('isAdmin');
      expect(dto).not.toHaveProperty('passwordHash');
      expect(Object.keys(dto)).toEqual(['name']);
    });
  });

  describe('name — normalisation (S-2)', () => {
    it('strips a C0 control byte (U+0000)', () => {
      expect(normalisedName('Al\u0000ice')).toBe('Alice');
    });

    it('strips U+007F', () => {
      expect(normalisedName('Al\u007Fice')).toBe('Alice');
    });

    it('strips a bidirectional override (U+202E)', () => {
      expect(normalisedName('Al\u202Eice')).toBe('Alice');
    });

    it('keeps a right-to-left mark (U+200F)', () => {
      expect(normalisedName('Al\u200Fice')).toBe('Al\u200Fice');
    });

    it('normalises before measuring the length, so 80 characters plus stripped bytes still fit', async () => {
      const name = 'a'.repeat(MAX_NAME_LENGTH);
      const { dto, errors } = await validateDto({
        name: ` ${name}\u202E`,
      });

      expect(errors).toHaveLength(0);
      expect(dto.name).toBe(name);
    });

    it('leaves a non-string value alone for the validator to refuse', async () => {
      const { errors } = await validateDto({ name: 42 });

      expect(errors).toHaveLength(1);
    });
  });
});
