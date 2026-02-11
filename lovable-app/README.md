# Lovable App (React + Vite + TypeScript + Tailwind)

Frontend compatível com a stack exigida pelo Lovable.

## Rodar local
1. Suba o backend/API atual (Next) na raiz do projeto:
   - `npm run dev`
2. Neste diretório:
   - `npm install`
   - `npm run dev`

Frontend: `http://localhost:5173`

## Variáveis
- `VITE_API_BASE_URL` (opcional)
  - vazio: usa proxy local `/api -> http://localhost:3000`
  - preenchido: usa backend remoto informado

## Escopo da migração (inicial)
- Navegação mobile base
- Dashboard com consumo de API (`/api/dashboard`, `/api/lancamentos`, `/api/sync/status`, `/api/sync/run`)
- Tela `cartoes` migrada com fluxo principal (listar, lançar, editar, excluir, filtrar, fechar mês)
- Tela `lancar` migrada com fluxo principal (avulsa/fixa/receita + categorias)
- Rotas placeholder para demais telas a migrar
