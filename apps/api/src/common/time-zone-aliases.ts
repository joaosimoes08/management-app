/**
 * Exact-case IANA names (tzdata 2026f) that ICU accepts but reports under a different ID,
 * e.g. "Asia/Kolkata" -> "Asia/Calcutta", "Europe/Kyiv" -> "Europe/Kiev", "US/Eastern" -> "America/New_York".
 * `resolvedOptions().timeZone === value` alone would reject them, so they are allowed by exact match.
 * Regenerate: every name under /usr/share/zoneinfo whose resolvedOptions().timeZone differs from itself.
 */
export const IANA_ALIASES: ReadonlySet<string> = new Set([
  'Africa/Asmara', 'Africa/Timbuktu', 'America/Argentina/Buenos_Aires', 'America/Argentina/Catamarca',
  'America/Argentina/ComodRivadavia', 'America/Argentina/Cordoba', 'America/Argentina/Jujuy',
  'America/Argentina/Mendoza', 'America/Atikokan', 'America/Atka', 'America/Ensenada', 'America/Fort_Wayne',
  'America/Indiana/Indianapolis', 'America/Kentucky/Louisville', 'America/Knox_IN', 'America/Montreal',
  'America/Nipigon', 'America/Nuuk', 'America/Pangnirtung', 'America/Porto_Acre', 'America/Rainy_River',
  'America/Rosario', 'America/Santa_Isabel', 'America/Shiprock', 'America/Thunder_Bay', 'America/Virgin',
  'America/Yellowknife', 'Antarctica/South_Pole', 'Asia/Ashkhabad', 'Asia/Choibalsan', 'Asia/Chongqing',
  'Asia/Chungking', 'Asia/Dacca', 'Asia/Harbin', 'Asia/Ho_Chi_Minh', 'Asia/Istanbul', 'Asia/Kashgar',
  'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Macao', 'Asia/Tel_Aviv', 'Asia/Thimbu', 'Asia/Ujung_Pandang',
  'Asia/Ulan_Bator', 'Asia/Yangon', 'Atlantic/Faroe', 'Atlantic/Jan_Mayen', 'Australia/ACT',
  'Australia/Canberra', 'Australia/Currie', 'Australia/LHI', 'Australia/NSW', 'Australia/North',
  'Australia/Queensland', 'Australia/South', 'Australia/Tasmania', 'Australia/Victoria', 'Australia/West',
  'Australia/Yancowinna', 'Brazil/Acre', 'Brazil/DeNoronha', 'Brazil/East', 'Brazil/West', 'CET', 'CST6CDT',
  'Canada/Atlantic', 'Canada/Central', 'Canada/Eastern', 'Canada/Mountain', 'Canada/Newfoundland',
  'Canada/Pacific', 'Canada/Saskatchewan', 'Canada/Yukon', 'Chile/Continental', 'Chile/EasterIsland', 'Cuba',
  'EET', 'EST', 'EST5EDT', 'Egypt', 'Eire', 'Etc/GMT', 'Etc/GMT+0', 'Etc/GMT-0', 'Etc/GMT0', 'Etc/Greenwich',
  'Etc/UCT', 'Etc/UTC', 'Etc/Universal', 'Etc/Zulu', 'Europe/Belfast', 'Europe/Kyiv', 'Europe/Nicosia',
  'Europe/Tiraspol', 'Europe/Uzhgorod', 'Europe/Zaporozhye', 'GB', 'GB-Eire', 'GMT', 'GMT+0', 'GMT-0',
  'GMT0', 'Greenwich', 'HST', 'Hongkong', 'Iceland', 'Iran', 'Israel', 'Jamaica', 'Japan', 'Kwajalein',
  'Libya', 'MET', 'MST', 'MST7MDT', 'Mexico/BajaNorte', 'Mexico/BajaSur', 'Mexico/General', 'NZ', 'NZ-CHAT',
  'Navajo', 'PRC', 'PST8PDT', 'Pacific/Chuuk', 'Pacific/Johnston', 'Pacific/Kanton', 'Pacific/Pohnpei',
  'Pacific/Samoa', 'Pacific/Yap', 'Poland', 'Portugal', 'ROC', 'ROK', 'Singapore', 'Turkey', 'UCT',
  'US/Alaska', 'US/Aleutian', 'US/Arizona', 'US/Central', 'US/East-Indiana', 'US/Eastern', 'US/Hawaii',
  'US/Indiana-Starke', 'US/Michigan', 'US/Mountain', 'US/Pacific', 'US/Samoa', 'Universal', 'W-SU', 'WET',
  'Zulu',
]);
