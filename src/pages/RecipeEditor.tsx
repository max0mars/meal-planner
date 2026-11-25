import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import RecipeForm from '../components/RecipeForm'
import { db } from '../db'
import { useKitchenData } from '../lib/useKitchenData'

/** Loads what the form needs, then renders it. Used for both new recipes and edits. */
export default function RecipeEditor() {
  const { id } = useParams()
  const editing = id != null
  // null = not found (or a new recipe); undefined = still loading.
  const recipe = useLiveQuery(async () => (editing ? ((await db.recipes.get(Number(id))) ?? null) : null), [id, editing])
  const data = useKitchenData()

  if (!data || (editing && recipe === undefined)) return <p className="muted">Loading…</p>
  if (editing && !recipe) {
    return (
      <section>
        <header className="page-head">
          <h1>Recipe not found</h1>
        </header>
        <Link to="/recipes" className="btn-quiet">
          Back to recipes
        </Link>
      </section>
    )
  }
  return <RecipeForm initial={recipe ?? undefined} ingredients={data.ingredients} tagRows={data.tagRows} combinedCap={data.combinedCap} defaultLimit={data.defaultLimit} />
}
