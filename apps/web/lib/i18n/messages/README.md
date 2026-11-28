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
3. Fill `en-US.ts` with **what `translateSourceText('en-US', <Portuguese>)` returns today**, so the
   English screen does not change. Fill es-ES, fr-FR, de-DE and it-IT the same way (take the
   existing text from `../locales/<locale>.ts` `sourceText` where there is one).
   `satisfies Record<…MessageKey, string>` makes tsc fail on a missing or extra key.
4. Rename the export in `index.ts` and add one line to `domains.ts`:
   `export { changePlans } from './change-plans';`
5. Replace the literals in the components with `t('<key>')`. Leave `source-text-messages.ts` and
   the `sourceText` tables alone: other screens may still show the same text, and the final
   removal PR deletes them as a whole.
6. Run `npm run i18n:check` from the repo root. It finds the folder by itself and fails when a
   locale file is missing, keys differ from pt-PT, a key is duplicated, the folder is not in
   `domains.ts`, or a key is not used by any app code (orphan). Plural forms (`.one`, `.other`)
   count as their base key, and `` `prefix.${…}` `` template keys count for every key under it.

## The test every domain PR copies

Copy `features/tags/tags-i18n.test.tsx` next to the converted components and keep its four checks:

1. **pt is unchanged**: for each key, `translateMessage('pt-PT', key, undefined, params)` equals the
   old Portuguese literal (written out in the test, with sample params for `{name}` etc.).
2. **en is unchanged**: `translateMessage('en-US', key, undefined, params)` equals
   `translateSourceText('en-US', <that Portuguese literal>)`, i.e. what the page showed before.
3. **every key in all 6 locales**: the keys the components use (matched from their source) equal
   the test's list, each resolves in pt-PT and en-US, and each is present in
   `messages/<domain>/{es-ES,fr-FR,de-DE,it-IT}.ts`.
4. **no Portuguese left**: the converted files, with comments stripped, contain no Portuguese
   accented character (`[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]`); add unaccented words the domain used if
   its literals had none.

A render test in pt-PT and en-US (as at the bottom of the tags test) is recommended for the main
screen of the domain.
