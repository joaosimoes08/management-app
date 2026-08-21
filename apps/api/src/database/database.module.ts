import { Global, Module } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';

@Global()
@Module({ providers: [PrismaClient], exports: [PrismaClient] })
export class DatabaseModule {}
