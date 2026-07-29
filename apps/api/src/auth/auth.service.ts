import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_SALT_ROUNDS = 12;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';
// A bcrypt hash of an unguessable, unused password. Compared against on
// login when the email isn't registered, so lookups for unknown vs. known
// emails cost the same amount of time and can't be told apart by timing.
const DUMMY_PASSWORD_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEeO6bh2xLpU8iuw1RG5hV3ZQ4gzGvvBQ8W';

/**
 * Handles user registration and authentication: password hashing,
 * credential checks, and JWT issuance.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Creates a new user with a bcrypt-hashed password and issues a JWT.
   * @param dto - Email, password, and terms consent for the new account.
   * @returns The signed access token for the newly created user.
   * @throws ConflictException if a user with the given email already exists.
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          consentToTerms: dto.consentToTerms,
        },
      });

      return { accessToken: await this.signToken(user.id, user.email) };
    } catch (error) {
      // Two concurrent registrations for the same email can both pass the
      // findUnique check above; the database's unique constraint is the
      // real guard, so translate its violation into the same 409 instead
      // of letting a raw Prisma error escape as a 500.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  /**
   * Verifies a user's email and password and issues a JWT on success.
   * @param dto - Email and password to authenticate.
   * @returns The signed access token for the authenticated user.
   * @throws UnauthorizedException if the email is unknown or the password is wrong.
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always run bcrypt.compare, even for an unknown email, against a fixed
    // dummy hash — otherwise an unknown email short-circuits before hashing
    // and a timing side-channel reveals which emails are registered.
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return { accessToken: await this.signToken(user.id, user.email) };
  }

  /**
   * Signs a JWT access token carrying the user's id and email.
   * @param userId - The user's database id.
   * @param email - The user's email address.
   * @returns The signed JWT string.
   */
  private signToken(userId: string, email: string): Promise<string> {
    return this.jwtService.signAsync({ sub: userId, email });
  }
}
