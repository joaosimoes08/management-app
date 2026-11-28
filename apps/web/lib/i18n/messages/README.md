# Per-domain keyed messages

New keyed messages live here, one folder per domain, instead of in the pt-PT/en-US blocks of
`../i18n.tsx` and the four files in `../locales/`. A domain PR adds one folder and one line, so
parallel PRs do not edit the same files. `tags/` is the worked example.

```
messages/
  domains.ts          one export line per domain (alphabetical)
  registry.ts         merges every domain into t() and the lazy language bundles
  tags/
    index.ts          pt-PT + en-US bundled, es/fr/de/it as literal import()
    pt-PT.ts          the source: Portuguese, exactly the old literals
    en-US.ts          English, also the fallback of es/fr/de/it
    es-ES.ts fr-FR.ts de-DE.ts it-IT.ts
```

## Why one file per locale

pt-PT and en-US ship with the app, as before. The other four languages must not end up in the
main bundle, so each `<domain>/<locale>.ts` is reached only through a literal `import('./es-ES')`
in `index.ts`: the bundler gives each its own chunk, and `locales/loader.ts` downloads a
language's chunks (its own file plus one per domain, in parallel) only when that language is
chosen. One file holding all six locales would put every language in the main bundle.

## Adding a domain

1. Copy `tags/` to `<domain>/` (folder name in kebab-case, e.g. `change-plans`).
2. In `pt-PT.ts`, list the keys with the **exact Portuguese text the component showed before**.
   Rename the key type (`TagsMessageKey` → e.g. `ChangePlansMessageKey`). Prefix keys with the
   domain (`changePlans.…`); a key may not exist in another domain or in the `i18n.tsx` block.
3. Fill `en-US.ts` with the English text, and es-ES, fr-FR, de-DE and it-IT with their
   translations (en-US is the fallback of the other four for a missing key).
   `satisfies Record<…MessageKey, string>` makes tsc fail on a missing or extra key.
4. Rename the export in `index.ts` and add one line to `domains.ts`:
   `export { changePlans } from './change-plans';`
5. Replace the literals in the components with `t('<key>')`. There is no on-page translation any
   more: a literal left in Portuguese shows in Portuguese in every language, and
   `lib/i18n/portuguese-literals.test.ts` fails on it.
6. Run `npm run i18n:check` from the repo root. It finds the folder by itself and fails when a
   locale file is missing, keys differ from pt-PT, a key is listed twice in one file, a key is
   also in another domain, the `i18n.tsx` block or a `../locales/<locale>.ts` `messages` table,
   the folder is not in `domains.ts`, or a key is not used by any app code (orphan). Plural forms
   (`.one`, `.other`) count as their base key, and `` `prefix.${…}` `` template keys count for
   every key under it.
   - Build dynamic keys **only as template literals**: `` t(`tags.color.${color}`) ``. String
     concatenation (`t('tags.color.' + color)`) is not recognised, so those keys are reported as
     orphans.
   - One template prefix marks **every** key under it as used, so the check can no longer find an
     orphan there. Keep the prefix as narrow as the keys it really builds (`` `tags.color.${…}` ``,
     never `` `tags.${…}` ``).

## The test every domain PR copies

Copy `features/tags/tags-i18n.test.tsx` next to the converted components and keep its four checks:

1. **pt is unchanged**: for each key, `translateMessage('pt-PT', key, undefined, params)` equals the
   old Portuguese literal (written out in the test, with sample params for `{name}` etc.).
2. **en is right**: `translateMessage('en-US', key, undefined, params)` equals the English text,
   written out in the test.
3. **every key in all 6 locales**: the keys the components use (matched from their source) equal
   the test's list, each resolves in pt-PT and en-US, and each is present in
   `messages/<domain>/{es-ES,fr-FR,de-DE,it-IT}.ts`.
4. **no Portuguese left**: the converted files, with comments stripped, contain no Portuguese
   accented character (`[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]`); add unaccented words the domain used if
   its literals had none.

A render test in pt-PT and en-US (as at the bottom of the tags test) is recommended for the main
screen of the domain.

## Text the API sends in Portuguese

Some API replies carry Portuguese text (error messages, alert and inventory titles, SNMP trap
labels). `server/` holds those texts as keys, valued at the API's Portuguese in pt-PT.
`localizeServerText(t, text)` in `../server-text.ts` turns an exact match, or a templated one with
its values filled in (`{device} não tem VLANs permitidas.`), into the active language and returns
anything else unchanged. Call it only where the text is shown. A new API text gets a key in all six
`server/` files and a row in `../server-text.test.ts`; `server` keys are found by their text, so the
orphan check skips them.
