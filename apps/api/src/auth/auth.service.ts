import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const BCRYPT_SALT_ROUNDS = 12;
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

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
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        consentToTerms: dto.consentToTerms,
      },
    });

    return { accessToken: await this.signToken(user.id, user.email) };
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
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
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
