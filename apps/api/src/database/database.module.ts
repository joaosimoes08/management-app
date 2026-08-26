import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';

@Injectable()
class DatabaseClient extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() { await this.$disconnect(); }
}

@Global()
@Module({ providers: [DatabaseClient, { provide: PrismaClient, useExisting: DatabaseClient }], exports: [PrismaClient] })
export class DatabaseModule {}
