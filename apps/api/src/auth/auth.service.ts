import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { HashPasswordCommand } from '../credentials/commands/hash-password.command';
import { VerifyPasswordQuery } from '../credentials/queries/verify-password.query';
import { CreateUserCommand } from '../users/commands/create-user.command';
import { FindUserByEmailQuery } from '../users/queries/find-user-by-email.query';
import { AuthResponseDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

/**
 * Orchestrates registration and login: delegates user lookup/creation to the
 * users module and password hashing/verification to the credentials module
 * (both via CQRS commands/queries), and issues JWTs on success.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Registers a new user with a bcrypt-hashed password and issues a JWT.
   * @param dto - Email, password, and terms consent for the new account.
   * @returns The signed access token for the newly created user.
   * @throws ConflictException if a user with the given email already exists.
   */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existingUser = await this.queryBus.execute(
      new FindUserByEmailQuery(dto.email),
    );
    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.commandBus.execute(
      new HashPasswordCommand(dto.password),
    );

    // A second concurrent registration for the same email can still slip
    // past the check above; CreateUserHandler (users module) translates the
    // database's unique-constraint violation into the same ConflictException.
    const user = await this.commandBus.execute(
      new CreateUserCommand(dto.email, passwordHash, dto.consentToTerms),
    );

    return { accessToken: await this.signToken(user.id, user.email) };
  }

  /**
   * Verifies a user's email and password and issues a JWT on success.
   * @param dto - Email and password to authenticate.
   * @returns The signed access token for the authenticated user.
   * @throws UnauthorizedException if the email is unknown or the password is wrong.
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.queryBus.execute(
      new FindUserByEmailQuery(dto.email),
    );

    // Always issue the verify-password query, even for an unknown email —
    // its handler (credentials module) falls back to a dummy hash — so a
    // lookup for an unregistered address costs the same wall-clock time as
    // one for a registered address with a wrong password.
    const passwordMatches = await this.queryBus.execute(
      new VerifyPasswordQuery(dto.password, user?.passwordHash ?? null),
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
