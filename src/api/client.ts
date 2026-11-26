// Talks to the Worker that holds the planner's data (see worker/).

/** Where the Worker is. Set VITE_API_URL to point somewhere else, such as a local `npm run dev` in worker/. */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'https://meal-planner.base-defense.workers.dev'

const TOKEN_KEY = 'mealPlanner.apiToken'

/** The token you chose for the Worker. Stored in this browser only; without it the app asks for it. */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // nothing to clear
  }
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Calls the Worker. Resolves with the parsed JSON body, or throws an ApiError (status 0 if the server could not be reached). */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token ?? ''}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Could not reach the planner server. Check your internet connection.', 0)
  }
  const text = await response.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data ? String((data as { error: unknown }).error) : `Server error ${response.status}`
    throw new ApiError(message, response.status)
  }
  return data as T
}
