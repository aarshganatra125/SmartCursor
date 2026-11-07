export function ResponseView({ text, error, loading }: { text: string; error: string | null; loading: boolean }) {
  if (!text && !error && !loading) {
    return <div className="mx-3 flex-1 rounded-2xl border border-dashed border-black/10 px-3 py-4 text-[12px] text-zinc-500 dark:border-white/10">The response appears here. Nothing is sent until you choose an action.</div>
  }
  return (
    <div className="mx-3 min-h-0 flex-1 overflow-auto rounded-2xl bg-black/[0.03] px-3 py-3 dark:bg-black/30">
      {error && <p className="mb-2 text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
      {text && <RichText text={text} />}
      {loading && !text && <p className="text-[12.5px] text-zinc-500">Thinking…</p>}
    </div>
  )
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/```/g)
  return (
    <div className="space-y-2 text-[13px] leading-5 text-zinc-900 dark:text-zinc-50">
      {parts.map((part, index) => index % 2 === 1
        ? <pre key={index} className="overflow-auto rounded-xl bg-zinc-900 px-3 py-2 text-[12px] leading-5 text-zinc-100">{part.replace(/^\w+\n/, '')}</pre>
        : <p key={index} className="whitespace-pre-wrap">{part}</p>)}
    </div>
  )
}
