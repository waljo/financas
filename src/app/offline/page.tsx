export default function OfflinePage() {
  return (
    <section className="space-y-4 pb-20">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Modo offline</h1>
        <p className="text-sm font-medium text-ink/60">
          Sem internet agora. Você ainda pode usar <strong>/lancar</strong>, <strong>/contas-fixas</strong>, <strong>/calendario-anual</strong>, <strong>/categorias</strong> e <strong>/relatorios</strong>; depois acesse <strong>/sync</strong> para enviar pendências.
        </p>
      </header>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-ink/10">
        <p className="text-sm text-ink/70">
          Quando a conexão voltar, acesse a tela <strong>Sync</strong> e toque em <strong>Sincronizar agora</strong>.
        </p>
      </div>
    </section>
  );
}
