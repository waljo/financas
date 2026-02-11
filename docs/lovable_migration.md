# Migração para Lovable (React + Vite + TypeScript + Tailwind)

## Status atual (branch `lovable`)
Foi criado um frontend paralelo em `lovable-app` compatível com a stack do Lovable.

Entregue nesta etapa:
- scaffold Vite + React + TypeScript + Tailwind
- navegação mobile base (`lovable-app/src/components/AppNav.tsx`)
- Dashboard funcional (`lovable-app/src/pages/DashboardPage.tsx`)
  - consumo de `/api/dashboard?mes=YYYY-MM`
  - consumo de `/api/lancamentos?mes=YYYY-MM`
  - status `/api/sync/status`
  - ação `POST /api/sync/run`
  - indicador online/offline no cliente
- placeholders de rotas para telas a migrar

Entregue na etapa seguinte:
- migração da tela de cartões para Lovable (`lovable-app/src/pages/CartoesPage.tsx`)
  - listagem de cartões
  - listagem de compras (pendentes + últimos gastos)
  - lançamento manual de compra
  - edição e exclusão de compra
  - filtros (cartão ativo e descrição)
  - fechamento/totalizadores via API existente

## Estrutura criada
- `lovable-app/package.json`
- `lovable-app/vite.config.ts`
- `lovable-app/tailwind.config.ts`
- `lovable-app/postcss.config.cjs`
- `lovable-app/src/*`

## Como rodar
1. Backend atual (Next/API):
   - `npm run dev`
2. Front Lovable:
   - `npm run lovable:install`
   - `npm run lovable:dev`

URLs:
- backend: `http://localhost:3000`
- frontend Lovable: `http://localhost:5173`

## Configuração de API
Arquivo opcional:
- `lovable-app/.env` com `VITE_API_BASE_URL=https://seu-backend`

Sem `VITE_API_BASE_URL`, o Vite usa proxy local para `http://localhost:3000`.

## Próximas fases recomendadas
1. Migrar `lancar`
2. Migrar `contas-fixas`
3. Migrar `relatorios` e `importar`
4. Revisar UX mobile final e estados offline/sync no frontend Lovable
5. Remover dependência de Next no frontend após cobertura total das telas

## Observações
- Nesta fase, o backend/integrações Google permanecem no app atual.
- O objetivo é desacoplar frontend para compatibilidade Lovable sem perder regras de negócio existentes.
