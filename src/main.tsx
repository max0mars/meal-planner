import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource-variable/schibsted-grotesk'
import './index.css'
import App from './App.tsx'
import { seedIfEmpty } from './lib/seed'
import { moveAdhocRecipesToMeals } from './lib/planEdit'
import { seedBaselineRecipes } from './lib/seedRecipes'

// Foods first (recipes refer to them by name), then the baseline recipes. Meals of plain foods that an earlier version
// saved as hidden recipes are moved onto their meals.
seedIfEmpty()
  .then(() => seedBaselineRecipes())
  .then(() => moveAdhocRecipesToMeals())
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </StrictMode>,
    )
  })
