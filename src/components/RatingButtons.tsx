import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { toggleRating } from '../lib/rating'
import type { Recipe } from '../types'

/** Like or dislike a recipe. A liked recipe is picked more often; a disliked one is never suggested (you can still choose it by hand). */
export default function RatingButtons({ recipeId, rating }: { recipeId: number; rating: Recipe['rating'] }) {
  return (
    <div className="rating" role="group" aria-label="Rate this recipe">
      <button type="button" className={rating === 'like' ? 'on like' : ''} aria-pressed={rating === 'like'} onClick={() => toggleRating(recipeId, 'like')}>
        <ThumbsUp size={20} aria-hidden /> Like
      </button>
      <button
        type="button"
        className={rating === 'dislike' ? 'on dislike' : ''}
        aria-pressed={rating === 'dislike'}
        onClick={() => toggleRating(recipeId, 'dislike')}
      >
        <ThumbsDown size={20} aria-hidden /> Dislike
      </button>
    </div>
  )
}
