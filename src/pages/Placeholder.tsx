export default function Placeholder({ title, blurb }: { title: string; blurb: string }) {
  return (
    <section>
      <header className="page-head">
        <h1>{title}</h1>
        <p className="lede">{blurb}</p>
      </header>
      <p className="todo">This screen isn&apos;t built yet.</p>
    </section>
  )
}
