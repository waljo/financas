# FinancasG Native (Android)

Base inicial do app nativo Android (Expo + React Native), com foco em:
- bootstrap completo para banco local;
- fila local de operacoes;
- sincronizacao manual para o backend existente.

## Estado atual
Fase inicial entregue:
- `bootstrap` via `GET /api/mobile/bootstrap`;
- armazenamento local em SQLite (`entity_rows`, `sync_ops`, `sync_state`);
- envio manual da fila para `POST /api/sync/push`.
- cadastro/exclusao local de lancamentos com fila de sync.

## Requisitos
- Node.js 20+
- Android Studio (emulador) ou celular Android com Expo Go

## Como rodar
1. Instalar dependencias:
```bash
cd apps/android-native
npm install
```

2. Iniciar:
```bash
npm run start
```

3. Abrir no Android (Expo Go ou emulador).

## URL do backend
Na tela inicial do app, informe a URL base do backend Next.js, por exemplo:
- `http://192.168.15.8:3000`

Para bootstrap/sync funcionar:
- backend com `MOBILE_OFFLINE_MODE=true`
- endpoint `GET /api/mobile/bootstrap` disponivel
- endpoint `POST /api/sync/push` disponivel
