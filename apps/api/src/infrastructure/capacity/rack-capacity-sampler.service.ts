import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { DAY_MS, HISTORY_DAYS, usableMeasurement, utcDay } from './estimate-capacity';
import { rackMeasurements, readCapacityRacks } from './rack-capacity';

@Injectable()
export class RackCapacitySampler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RackCapacitySampler.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly prisma: PrismaClient) {}

  onModuleInit() { this.schedule(1000); }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule(delay: number) {
    this.timer = setTimeout(async () => {
      try { await this.capture(new Date()); }
      catch (error) { this.logger.error('Could not sample rack capacity', error); }
      if (!this.stopped) {
        const now = Date.now();
        this.schedule(utcDay(new Date(now)) + DAY_MS - now);
      }
    }, delay);
    this.timer.unref();
  }

  async capture(now: Date) {
    const day = utcDay(now);
    const sampledAt = new Date(day);
    let after: string | undefined;
    while (!this.stopped) {
      const racks = await readCapacityRacks(this.prisma, {}, { after, take: 200 });
      if (!racks.length) break;
      const data = racks.flatMap((rack) => rackMeasurements(rack).flatMap(({ resourceKey, used, total }) => (
        total !== null && usableMeasurement(used, total) ? [{ rackId: rack.id, resourceKey, sampledAt, used, total }] : []
      )));
      if (data.length) await this.prisma.rackCapacitySample.createMany({ data, skipDuplicates: true });
      after = racks.at(-1)?.id;
      if (racks.length < 200) break;
    }
    if (!this.stopped) await this.prisma.rackCapacitySample.deleteMany({ where: { sampledAt: { lt: new Date(day - HISTORY_DAYS * DAY_MS) } } });
  }
}
