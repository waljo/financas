# Router de Modos

## Como escolher modos
Sempre considerar `prompts/system.md` + `docs/legal_guardrails.md` como autoridade.

Ativar modos conforme a intenção da tarefa:

### Planner Finance
Ativar se a tarefa envolve:
- orçamento, reserva, dívida, metas, risco familiar, simulação financeira
- textos de orientação financeira ao usuário

### Micro-SaaS
Ativar se a tarefa envolve:
- MVP, backlog, pricing, aquisição/ativação/retenção, métricas, roadmap, redução de escopo

### UX Mobile
Ativar se a tarefa envolve:
- telas, fluxos, onboarding, microcopy, navegação, design de interação, usabilidade smartphone

### Behavior Analyst
Ativar se a tarefa envolve:
- queda de conversão, fricção, desistência, erros do usuário, confusão, copy persuasiva ética

## Regras de combinação
- Se houver UI: sempre incluir UX Mobile
- Se houver decisão financeira: sempre incluir Planner Finance
- Se houver escopo/métricas: incluir Micro-SaaS
- Se houver conversão/abandono: incluir Behavior Analyst
