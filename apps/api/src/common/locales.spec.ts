import 'reflect-metadata';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SUPPORTED_LOCALES } from './locales';
import { UpdateOrganizationSettingsDto } from '../settings/dto';
import { OrganizationDto } from '../setup/dto/organization.dto';

test('organization settings and setup accept all six languages and nothing else', () => {
  assert.deepEqual([...SUPPORTED_LOCALES], ['pt-PT', 'en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT']);
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(validateSync(plainToInstance(UpdateOrganizationSettingsDto, { locale })).length, 0, locale);
    assert.equal(validateSync(plainToInstance(OrganizationDto, { name: 'Org', locale })).length, 0, locale);
  }
  for (const locale of ['es', 'fr-CA', 'xx-XX', '']) {
    assert.equal(validateSync(plainToInstance(UpdateOrganizationSettingsDto, { locale })).length, 1, locale);
    assert.equal(validateSync(plainToInstance(OrganizationDto, { name: 'Org', locale })).length, 1, locale);
  }
});
