import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { translateMessage } from './i18n';

// Text shown on screen comes from the message files (lib/i18n/messages/<domain>/<locale>.ts, the added
// languages in lib/i18n/locales and the core tables in i18n.tsx). An accented Portuguese literal anywhere
// else in apps/web is either a text that skipped translation or one of the cases below.
const webRoot = join(__dirname, '..', '..');
const accented = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;

// Each entry names the exact literals it allows (the trimmed text of the string, template part or JSX text); no patterns.
type Allowed = { file: string; texts: readonly string[]; reason: string };

// Also allowed without an entry: the fallback of a key that exists in pt-PT and en-US (t('key', 'Texto'),
// { key, fallback: 'Texto' }, { key, label: 'Texto' }). It is never shown while the key exists, and the
// keyed tests check the key's values.
const allowed: Allowed[] = [
  {
    file: "lib/api/errors.ts",
    reason: "pt-PT column of the API error-code, client-error, rack face and port layout tables, kept next to their English column",
    texts: [
      "O utilizador tem de manter pelo menos uma role da aplicação.",
      "Não foi possível autenticar o serviço administrativo no Keycloak.",
      "A integração administrativa do Keycloak não está configurada.",
      "O Keycloak recusou a operação administrativa.",
      "Não é possível remover a role do último administrador ativo.",
      "A seleção de roles não é válida.",
      "Já tens uma ou mais das roles pedidas.",
      "Já existe um pedido de roles pendente.",
      "Este pedido já foi processado.",
      "Só é possível eliminar Sites vazios.",
      "A rede pertence ou sobrepõe uma gama especial bloqueada.",
      "A subnet não está incluída nas redes autorizadas para Discovery.",
      "A enumeração de subnets IPv6 ainda não é suportada.",
      "Discovery aceita no máximo 64 portas por execução.",
      "Já existe uma execução ativa para esta subnet.",
      "Não tens permissão para esta operação neste scope IPAM.",
      "O scope não pertence ao Site do grupo.",
      "Site, VLAN, VRF e subnet pai têm de pertencer ao mesmo Site.",
      "A lista não tem nenhum prefixo válido. Usa notação CIDR com comprimento, por exemplo 193.0.0.0/21 ou 2001:db8::/32.",
      "A lista tem demasiados prefixos: o máximo é 500 por pré-visualização. Divide-a em várias listas.",
      "O Site ou VRF mudou depois da pré-visualização. Pré-visualiza novamente antes de importar.",
      "O equipamento já está associado a outro Host.",
      "Existem campos inválidos no pedido.",
      "O mapeamento de portas está incompleto: o total das faces frontal e traseira tem de ser igual ao número de portas do modelo.",
      "A imagem frontal é obrigatória. Escolhe ou carrega uma imagem frontal para o modelo.",
      "Há uma porta mapeada mais de uma vez. Cada porta só pode estar numa face.",
      "O ficheiro escolhido não é uma imagem. Escolhe uma imagem PNG, JPG, SVG ou WebP.",
      "A revisão desta semana já foi registada. Não é possível registar outra para o mesmo ciclo.",
      "A credencial não foi eliminada: está em uso neste equipamento (recolha SNMP, enriquecimento SNMP da descoberta, validação de traps ou SET). Revê o aviso e escolhe Eliminar mesmo assim se quiseres continuar.",
      "A credencial não foi eliminada: há uma tarefa SNMP em curso que a usa. Tenta novamente quando a tarefa terminar.",
      "O cliente da API não está inicializado.",
      "Sessão expirada",
      "não estão completamente mapeadas.",
      "portas de rede mas só",
      "estão mapeadas (frente + traseira).",
    ],
  },
  {
    file: "lib/i18n/locales/catalog.ts",
    reason: "native language names in the language picker",
    texts: [
      "Português (Portugal)",
      "Français",
    ],
  },
  {
    file: "features/settings/settings-page.tsx",
    reason: "bilingual search keywords, matched against what the user types and never shown; and the template fallback of settings.snmpApplyHint",
    texts: [
      "nome name organização organization",
      "código code organização organization",
      "fuso horário timezone",
      "linguagem idioma language locale português english",
      "sites localização location edifícios buildings equipamentos devices vlan subnet",
      "grupos groups membros permissões ipam infraestrutura",
      "utilizadores users roles permissões keycloak acessos",
      "teams microsoft webhook email e-mail smtp servidor correio canal channel notificações alertas críticos entrega mensagem teste",
      "relatórios reports agendados scheduled semanal mensal weekly monthly resumo digest csv destinatários conformidade capacidade alterações",
      "discovery métodos methods icmp tcp",
      "saúde health limites limits alertas alerts cpu memória memory temperatura temperature erros errors interfaces snmp",
      "tema theme aparência appearance cores colours colors escuro dark claro light sistema system contraste contrast",
      "auditoria audit retenção retention dias limpeza eventos",
      "O agente do host reaplica a configuração em até",
    ],
  },
  { file: "features/portal/portal-page.tsx", texts: ["Operações"], reason: "saved category value from the portal data, compared as data" },
  { file: "features/topology/topology-page.tsx", texts: ["já utilizadas"], reason: "matches the API's own error text to pick the error to show" },
  { file: "lib/auth/api.ts", texts: ["Identidade inválida devolvida pela API."], reason: "internal error thrown on a malformed API reply; unchanged, not translated in any locale today" },
  { file: "app/layout.tsx", texts: ["Centro de operações para infraestrutura e ciberdefesa."], reason: "HTML metadata description; server-rendered default, replaced on the client by meta.description" },
  { file: "features/infrastructure/types.ts", texts: ["padrão"], reason: "power source value of the data model" },
  { file: "features/infrastructure/components/editors/device-power-fields.tsx", texts: ["padrão"], reason: "power source value of the data model, the t() fallback of power.source.*" },
  { file: "features/settings/components/notification-channels-settings.tsx", texts: ["noc@empresa.pt\nprevenção@empresa.pt"], reason: "example e-mail addresses in a placeholder" },
];

function sourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(webRoot, path).split(sep).join('/');
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'coverage', 'public'].includes(entry.name) || rel === 'lib/i18n/messages' || rel === 'lib/i18n/locales/translations') continue;
      sourceFiles(path, files);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name)) {
      if (/^lib\/i18n\/locales\/[^/]+\.ts$/.test(rel) && rel !== 'lib/i18n/locales/catalog.ts' && rel !== 'lib/i18n/locales/loader.ts') continue;
      files.push(rel);
    }
  }
  return files;
}

const keyExists = (key: string) => translateMessage('pt-PT', key) !== key && translateMessage('en-US', key) !== key;

/** The key whose fallback this literal is, if it is one. */
function fallbackKey(node: ts.Node, file: ts.SourceFile): string | undefined {
  const parent = node.parent;
  if (ts.isCallExpression(parent) && parent.arguments[1] === node && parent.arguments[0] && ts.isStringLiteralLike(parent.arguments[0])) return parent.arguments[0].text;
  if (ts.isPropertyAssignment(parent) && ['fallback', 'label'].includes(parent.name.getText(file)) && ts.isObjectLiteralExpression(parent.parent)) {
    const key = parent.parent.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(file) === 'key');
    if (key && ts.isPropertyAssignment(key) && ts.isStringLiteralLike(key.initializer)) return key.initializer.text;
  }
  return undefined;
}

function accentedLiterals(rel: string) {
  const text = readFileSync(join(webRoot, rel), 'utf8');
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Array<{ file: string; line: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    // The core message tables of i18n.tsx are translation files.
    if (rel === 'lib/i18n/i18n.tsx' && ts.isVariableDeclaration(node) && node.name.getText(file) === 'messages') return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const key = fallbackKey(node, file);
      if (accented.test(node.text) && !(key && keyExists(key))) found.push({ file: rel, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, text: node.text.trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const isAllowed = (literal: { file: string; text: string }) => allowed.some((entry) => entry.file === literal.file && entry.texts.includes(literal.text));

describe('Portuguese literals in apps/web', () => {
  const files = sourceFiles(webRoot);
  const literals = files.flatMap(accentedLiterals);

  it('scans the app source', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('lib/i18n/i18n.tsx');
    expect(files.some((file) => file.startsWith('lib/i18n/messages/'))).toBe(false);
  });

  it('has no accented Portuguese text outside the message files and the allow-list', () => {
    expect(literals.filter((literal) => !isAllowed(literal)).map(({ file, line, text }) => `${file}:${line} ${text.slice(0, 80)}`)).toEqual([]);
  });

  it('gives every allow-list entry a reason, and every allowed literal still exists in its file', () => {
    expect(allowed).toHaveLength(10);
    expect(allowed.flatMap((entry) => entry.texts)).toHaveLength(58);
    for (const entry of allowed) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(10);
      expect(entry.texts.length, entry.file).toBeGreaterThan(0);
      for (const text of entry.texts) expect(literals.some((literal) => literal.file === entry.file && literal.text === text), `${entry.file} ${text.slice(0, 60)}`).toBe(true);
    }
  });

  it('catches a Portuguese literal', () => {
    expect(isAllowed({ file: 'features/example.tsx', text: 'Não foi possível guardar.' })).toBe(false);
    // An allowed file allows only its listed literals, not any new text in it.
    expect(isAllowed({ file: 'lib/api/errors.ts', text: 'Não foi possível guardar.' })).toBe(false);
    expect(isAllowed({ file: 'lib/api/errors.ts', text: 'Sessão expirada' })).toBe(true);
    expect(keyExists('rack.pdu.readOnly')).toBe(true);
    expect(keyExists('rack.pdu.noSuchKey')).toBe(false);
  });
});
