import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Injectable wrapper around the generated Prisma client that connects and
 * disconnects in step with the Nest module lifecycle.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Builds the Prisma client on top of a pg driver adapter pointed at
   * `DATABASE_URL`.
   * @param config - Provides access to the app's environment configuration.
   */
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
      }),
    });
  }

  /**
   * Opens the database connection when the hosting module initializes.
   * @returns A promise that resolves once the connection is established.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  /**
   * Closes the database connection when the hosting module is destroyed.
   * @returns A promise that resolves once the connection is closed.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
