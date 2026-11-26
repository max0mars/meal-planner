import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '@fontsource-variable/schibsted-grotesk'
import './index.css'
import App from './App.tsx'
import { getToken } from './api/client'
import ConnectScreen from './components/ConnectScreen'
import { seedIfEmpty } from './lib/seed'
import { moveAdhocRecipesToMeals } from './lib/planEdit'
import { seedBaselineRecipes } from './lib/seedRecipes'

const root = createRoot(document.getElementById('root')!)

function renderApp() {
  root.render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  )
}

// Foods first (recipes refer to them by name), then the baseline recipes. Meals of plain foods that an earlier version
// saved as hidden recipes are moved onto their meals.
function start() {
  seedIfEmpty()
    .then(() => seedBaselineRecipes())
    .then(() => moveAdhocRecipesToMeals())
    .finally(renderApp)
}

// The data lives on the planner's server, so the first visit asks for the token.
if (getToken()) {
  start()
} else {
  root.render(
    <StrictMode>
      <ConnectScreen onConnected={start} />
    </StrictMode>,
  )
}
