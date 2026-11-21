import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateOrganizationSettingsDto } from '../settings/dto';
import { OrganizationDto } from '../setup/dto/organization.dto';
import { isIanaTimeZone } from './time-zone';
import { IANA_ALIASES } from './time-zone-aliases';

test('accepts any IANA time zone the runtime knows, including the four previous ones', () => {
  for (const zone of ['Europe/Lisbon', 'UTC', 'Europe/London', 'Europe/Madrid', 'America/New_York', 'Asia/Tokyo', 'Australia/Lord_Howe', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'Etc/GMT+5', 'Asia/Kolkata', 'Asia/Calcutta', 'Asia/Kathmandu', 'Europe/Kyiv', 'Europe/Kiev', 'US/Eastern', 'Etc/UTC', 'GMT', 'Antarctica/DumontDUrville']) assert.equal(isIanaTimeZone(zone), true, zone);
  for (const zone of Intl.supportedValuesOf('timeZone')) assert.equal(isIanaTimeZone(zone), true, zone);
});

test('rejects unknown, wrongly cased and non-string time zones', () => {
  for (const zone of ['Mars/Base', 'Europe/Atlantis', 'europe/lisbon', 'EUROPE/LISBON', 'Europe/LISBON', 'utc', 'Utc', 'asia/kolkata', 'ASIA/KOLKATA', 'Asia/calcutta', 'us/eastern', 'US/EASTERN', 'etc/gmt+5', '-05:00', '+0100', '', ' Europe/Lisbon', 'Europe/Lisbon ', '+01:00', '../etc/passwd', 'A'.repeat(65), null, undefined, 42, {}]) assert.equal(isIanaTimeZone(zone), false, String(zone));
});

test('every exact-case alias in the list is a zone the runtime knows, and its lower-case form is rejected', () => {
  for (const zone of IANA_ALIASES) {
    assert.equal(isIanaTimeZone(zone), true, zone);
    if (zone !== zone.toLowerCase()) assert.equal(isIanaTimeZone(zone.toLowerCase()), false, zone.toLowerCase());
    if (zone !== zone.toUpperCase()) assert.equal(isIanaTimeZone(zone.toUpperCase()), false, zone.toUpperCase());
  }
});

test('settings and setup DTOs use the IANA check', () => {
  const settingsErrors = (timezone: unknown) => validateSync(plainToInstance(UpdateOrganizationSettingsDto, { timezone }));
  const setupErrors = (timezone: unknown) => validateSync(plainToInstance(OrganizationDto, { name: 'Org', timezone }));
  assert.deepEqual(settingsErrors('America/New_York'), []);
  assert.deepEqual(setupErrors('America/New_York'), []);
  assert.deepEqual(settingsErrors(undefined), []);
  assert.deepEqual(setupErrors(undefined), []);
  assert.equal(settingsErrors('EUROPE/LISBON').length, 1);
  assert.equal(setupErrors('Europe/LISBON').length, 1);
  assert.match(Object.values(settingsErrors('Mars/Base')[0].constraints ?? {})[0], /valid IANA time zone/);
  assert.match(Object.values(setupErrors('Mars/Base')[0].constraints ?? {})[0], /valid IANA time zone/);
});
