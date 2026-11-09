import { Module } from '@nestjs/common';
import { CriticalAssetsController } from './critical-assets.controller';
import { CriticalAssetsService } from './critical-assets.service';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';

@Module({ imports: [InfrastructureModule], controllers: [CriticalAssetsController], providers: [CriticalAssetsService] })
export class CriticalAssetsModule {}
