export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black tracking-tight text-ink">{title}</h1>
      <article className="rounded-3xl border border-dashed border-ink/20 bg-white/70 p-6 text-sm font-semibold text-ink/60">
        Tela em migracao para stack Lovable. Backend atual continua no app Next durante a transicao.
      </article>
    </section>
  );
}
