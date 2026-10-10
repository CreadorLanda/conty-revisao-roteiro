# Revisão de roteiro

API que modela a revisão de um roteiro como versões com estado explícito. O criador envia o roteiro, a marca pede alteração (com motivo e prazo) ou aprova, o criador reenvia, e a aprovação encerra a revisão.

## Estados

```
pending_review ──requestChanges──> changes_requested
       │                                   │
       │<──────── submitNewVersion ────────┘
       │
   approve──> approved (terminal)
```

- `pending_review`: existe uma versão aguardando a marca.
- `changes_requested`: a marca pediu alteração com motivo e prazo; a bola está com o criador.
- `approved`: terminal. Não aceita nova versão nem novo pedido de alteração.

O prazo do pedido é um dia civil no fuso da marca (`America/Sao_Paulo`). O último instante desse dia ainda vale; a partir do primeiro instante do dia seguinte o prazo já passou. A conversão é feita a partir do offset real do fuso no instante, então o dia não "vira" quando o horário UTC já passou da meia-noite.

## Como rodar

Node 22.

```bash
npm install
npm test
npm run dev   # sobe em http://127.0.0.1:3003
```

## Exemplos

Criar a revisão com a primeira versão:

```bash
curl -s -X POST localhost:3003/reviews \
  -H 'content-type: application/json' \
  -d '{"content":"Roteiro v1: abertura + 3 cenas"}'
```

```json
{
  "id": "0f3c...",
  "state": "pending_review",
  "versions": [{ "number": 1, "content": "Roteiro v1: abertura + 3 cenas", "submittedAt": "2026-03-10T12:00:00.000Z" }],
  "changeRequests": [],
  "createdAt": "2026-03-10T12:00:00.000Z",
  "approvedAt": null
}
```

Marca pede alteração:

```bash
curl -s -X POST localhost:3003/reviews/<id>/change-requests \
  -H 'content-type: application/json' \
  -d '{"reason":"Ajustar o gancho dos 3 primeiros segundos","deadline":"2026-03-20"}'
```

```json
{
  "state": "changes_requested",
  "changeRequests": [{ "reason": "Ajustar o gancho dos 3 primeiros segundos", "deadline": "2026-03-20", "requestedAt": "..." }]
}
```

Criador reenvia (`POST /reviews/<id>/versions` com `{ "content": "..." }`) e a marca aprova (`POST /reviews/<id>/approval`). `GET /reviews/<id>` devolve o estado atual com todo o histórico de versões e de pedidos.

Erros usam código legível: `missing_reason`, `missing_deadline`, `invalid_deadline` e `empty_content` (400); `deadline_passed`, `not_pending` e `already_approved` (409); `not_found` (404).

## O que eu faria diferente com mais tempo

Separaria papéis (criador x marca) com autorização de verdade em cada transição, persistiria num banco com histórico append-only em vez do store em memória, e adicionaria idempotência nas submissões para tolerar reenvio de request duplicado. Deixei de fora notificação de prazo e diff entre versões.

## Uso de IA

Usei o Claude para criar os testes.
