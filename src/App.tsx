import type { ComponentType } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { CalendarCheck, CalendarDays, CookingPot, Refrigerator, Settings as SettingsIcon, ShoppingBasket } from 'lucide-react'
import './App.css'
import Ingredients from './pages/Ingredients'
import Pantry from './pages/Pantry'
import Placeholder from './pages/Placeholder'
import Plan from './pages/Plan'
import RecipeDetail from './pages/RecipeDetail'
import RecipeEditor from './pages/RecipeEditor'
import Recipes from './pages/Recipes'
import Settings from './pages/Settings'
import Today from './pages/Today'
import Shopping from './pages/Shopping'

interface Tab {
  path: string
  label: string
  Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
}

const TABS: Tab[] = [
  { path: '/today', label: 'Today', Icon: CalendarCheck },
  { path: '/pantry', label: 'Pantry', Icon: Refrigerator },
  { path: '/recipes', label: 'Recipes', Icon: CookingPot },
  { path: '/plan', label: 'Plan', Icon: CalendarDays },
  { path: '/shopping', label: 'Shopping', Icon: ShoppingBasket },
  { path: '/settings', label: 'Settings', Icon: SettingsIcon },
]

/** Screens that are not built yet. */
const PLACEHOLDERS = [
  { path: '/leftovers', label: 'Leftovers', blurb: 'Cooked food waiting to be eaten.' },
  { path: '/log', label: 'Log', blurb: 'Calories and protein against your targets.' },
]

export default function App() {
  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<Today />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/ingredients" element={<Ingredients />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/recipes/new" element={<RecipeEditor />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="/recipes/:id/edit" element={<RecipeEditor />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/shopping" element={<Shopping />} />
          <Route path="/settings" element={<Settings />} />
          {PLACEHOLDERS.map((t) => (
            <Route key={t.path} path={t.path} element={<Placeholder title={t.label} blurb={t.blurb} />} />
          ))}
        </Routes>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ path, label, Icon }) => (
          <NavLink key={path} to={path} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <Icon size={24} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
