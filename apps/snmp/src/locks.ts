import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

export class DeviceLocks {
  constructor(private readonly redis: Redis) {}

  async withLock<T>(deviceId: string, ttlMs: number, action: () => Promise<T>) {
    const key = `snmp:device-lock:${deviceId}`;
    const token = randomUUID();
    if (await this.redis.set(key, token, 'PX', ttlMs, 'NX') !== 'OK') throw Object.assign(new Error('SNMP_DEVICE_BUSY'), { code: 'SNMP_DEVICE_BUSY' });
    try { return await action(); } finally {
      await this.redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', 1, key, token).catch(() => undefined);
    }
  }
}
