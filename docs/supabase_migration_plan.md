# Plano de Migracao para Supabase (Registrado)

Status: Planejado  
Data de decisao: 2026-02-10

## Decisao
Migrar progressivamente a arquitetura operacional para Supabase, mantendo compatibilidade com Google Sheets durante periodo de transicao.

## Objetivos
- Usar Postgres como base operacional para sincronizacao e consultas.
- Introduzir autenticacao de aplicacao com Supabase Auth.
- Evoluir escrita offline com fila/outbox robusta e resolucao de conflitos.
- Melhorar observabilidade e rastreabilidade de sincronizacao.

## Estrategia de transicao (alto nivel)
1. Criar schema inicial no Supabase para entidades principais.
2. Implementar camada de abstracao de dados para alternar origem (Sheets/Supabase).
3. Iniciar dual-write controlado (quando aplicavel) com validacao.
4. Migrar leituras criticas para Supabase.
5. Migrar escrita e sincronizacao para Supabase como caminho principal.
6. Manter Sheets como legado/espelho ate estabilidade completa.

## Observacao
Este documento registra a decisao. O detalhamento tecnico (DDL, endpoints, politicas de conflito, cronograma) sera produzido na proxima sessao.
