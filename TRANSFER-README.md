# Transferência do projeto

O ficheiro `context.md` contém o contexto/memória técnica disponível no diretório do projeto.

As conversas do Codex não são armazenadas como ficheiros dentro deste projeto. Por isso, esta cópia preserva o contexto técnico local, mas não consegue incluir automaticamente o histórico de chats da aplicação.

Para continuar noutro computador:

1. Copiar o conteúdo da pasta `transfer/project` para uma nova pasta de trabalho.
2. Copiar os ficheiros da pasta `transfer/private-config` para os locais correspondentes, apenas se forem necessários. Estes ficheiros contêm configurações privadas e não devem ser enviados para um repositório público.
3. Instalar Node.js e Docker conforme `docs/setup.md`.
4. Executar `npm install` (ou `pnpm install`) e rever os ficheiros `.env` a partir dos exemplos.

O bundle exclui `node_modules`, caches do Next.js/pnpm e artefactos de compilação, pois são gerados novamente no computador de destino.
