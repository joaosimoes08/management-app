# Guião cego do piloto operacional

## Instruções

- Executar individualmente, sem ajuda técnica e sem revelar previamente o caminho esperado.
- O observador regista tempo, cliques errados, bloqueios, perguntas e resultado final.
- Não usar pesquisa externa, consola, API ou base de dados.
- Parar uma tarefa aos 10 minutos e marcá-la como `BLOCKED`.

## Tarefas

1. A partir do switch `QA-SW-PILOT-01`, localizar a porta ligada ao servidor piloto e identificar VLAN, subnet, IP, Host e Service HTTPS.
2. Partindo da ficha do Service, regressar ao switch e à porta original sem voltar ao dashboard nem usar pesquisa global.
3. Como `qa-network-scoped`, alterar as notas do Host piloto e confirmar a alteração.
4. Ainda como operador scoped, tentar alterar uma subnet fora do Site `QA-PILOT`; registar o comportamento sem procurar contornar a permissão.
5. Abrir o resultado pendente `QA Pilot Review Evidence`, aprová-lo e localizar o respetivo evento na Auditoria.

## Formulário por tarefa

| Campo | Valor |
|---|---|
| Operador | |
| Persona | |
| Tarefa | |
| Início/fim | |
| Duração | |
| Resultado | PASS / FAIL / BLOCKED |
| Cliques errados | |
| Perguntas feitas | |
| Mensagens inesperadas | |
| Observações | |

## Fecho

Calcular a mediana da duração das tarefas concluídas, taxa de sucesso por persona e principais pontos de abandono. A execução automatizada do Computer não substitui estes resultados humanos.
