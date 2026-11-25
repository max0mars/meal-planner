export interface TagDef {
  id: string
  label: string
  hint: string
}

/** Allergen / intolerance categories. Each ingredient carries zero or more of these. */
export const TAGS: TagDef[] = [
  { id: 'gluten', label: 'Gluten', hint: 'Wheat, rye, barley and foods made from them' },
  { id: 'wheat', label: 'Wheat', hint: 'Wheat only (pasta, bread, flour, couscous)' },
  { id: 'oats', label: 'Oats', hint: 'Oats and oat milk' },
  { id: 'dairy', label: 'Dairy', hint: 'Any milk product, including butter and aged cheese' },
  { id: 'lactose', label: 'Lactose', hint: 'Higher-lactose dairy: milk, yogurt, cream, soft cheese' },
  { id: 'egg', label: 'Egg', hint: 'Eggs and egg-based foods like mayo' },
  { id: 'soy', label: 'Soy', hint: 'Soy milk, tofu, tempeh, soy sauce' },
  { id: 'peanut', label: 'Peanuts', hint: 'Peanuts and peanut butter' },
  { id: 'tree-nut', label: 'Tree nuts', hint: 'Almonds, walnuts, cashews and their milks/butters' },
  { id: 'sesame', label: 'Sesame', hint: 'Sesame seeds and tahini' },
  { id: 'fish', label: 'Fish', hint: 'Finfish' },
  { id: 'shellfish', label: 'Shellfish', hint: 'Shrimp, crab, etc.' },
  { id: 'corn', label: 'Corn', hint: 'Corn, cornmeal, corn tortillas' },
  { id: 'legumes', label: 'Legumes', hint: 'Beans, lentils, chickpeas, peanuts' },
  { id: 'onion-garlic', label: 'Onion & garlic', hint: 'Alliums, including powders' },
  { id: 'high-fodmap', label: 'High FODMAP', hint: 'Foods commonly high in fermentable carbs' },
  { id: 'cruciferous', label: 'Cruciferous veg', hint: 'Broccoli, cabbage, kale, cauliflower' },
  { id: 'nightshade', label: 'Nightshades', hint: 'Tomato, peppers, eggplant, paprika' },
  { id: 'spicy', label: 'Spicy', hint: 'Capsaicin-heavy foods like chili and cayenne' },
  { id: 'alcohol', label: 'Alcohol', hint: 'Wine, beer and spirits, including in cooking' },
]

export const TAG_LABEL: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.id, t.label]))
