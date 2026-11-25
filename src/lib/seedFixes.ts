import type { Unit } from '../types'

export interface FixLine {
  name: string
  qty: number
  unit: Unit
}

/** A correction to one starter recipe whose import was wrong. */
export interface SeedFix {
  seedId: string
  title: string
  why: string
  /** Lines as they shipped, replaced by `now`. An installed recipe is only changed if it still has every one of them. */
  was?: FixLine[]
  now?: FixLine[]
  /** Lines the import left out, added if the food is not already in the recipe. */
  add?: FixLine[]
  /** Foods the page does not list, removed. */
  drop?: string[]
  /** Servings as they shipped, and what they should be. `estimated` says whether the new number is still a guess. */
  servings?: { was: number; now: number; estimated: boolean }
}

const g = (name: string, qty: number): FixLine => ({ name, qty, unit: 'g' })
const pc = (name: string, qty: number): FixLine => ({ name, qty, unit: 'piece' })
const tbsp = (name: string, qty: number): FixLine => ({ name, qty, unit: 'tbsp' })
/** The page publishes this many servings, and the recipe already had them as a guess. */
const published = (seedId: string, title: string, n: number): SeedFix => ({ seedId, title, why: 'The page publishes these servings.', servings: { was: n, now: n, estimated: false } })
const S = (was: number, now: number, estimated: boolean) => ({ was, now, estimated })

/**
 * Checked against each recipe's own page where it publishes servings, calories and protein. Amounts are raw weights of
 * what you eat: a whole chicken is counted as the meat on it, not the bones and skin.
 */
export const SEED_FIXES: SeedFix[] = [
  {
    seedId: 'themealdb:53039',
    title: 'Piri-piri chicken and slaw',
    why: 'A 1.5 kg whole chicken was counted as 1.5 kg of breast, and "4 leaves" of greens as 4 cabbages. The page says 33 g protein.',
    was: [g('Chicken breast', 1500), { name: 'Cabbage', qty: 4, unit: 'piece' }],
    now: [g('Chicken thigh', 620), g('Cabbage', 40)],
    servings: { was: 4, now: 4, estimated: false },
  },
  {
    seedId: 'themealdb:53510',
    title: 'Cayman-Style Lobster',
    why: 'Six whole lobsters (2.7 kg) for four people. It is six tails, about 800 g of meat.',
    was: [{ name: 'Lobster', qty: 6, unit: 'piece' }],
    now: [g('Lobster', 800)],
  },
  {
    seedId: 'themealdb:52933',
    title: 'Rappie Pie',
    why: 'A whole chicken was counted as 1.5 kg of breast. About 650 g of meat.',
    was: [g('Chicken breast', 1500)],
    now: [g('Chicken thigh', 650)],
  },
  {
    seedId: 'themealdb:53186',
    title: 'Chicken with saffron, raisins & pine nuts',
    why: 'Bone-in chicken counted as boneless breast. The page says 45 g protein a serving.',
    was: [g('Chicken breast', 1250)],
    now: [g('Chicken thigh', 860)],
    servings: S(4, 4, false),
  },
  {
    seedId: 'themealdb:52937',
    title: 'Jerk chicken with rice & peas',
    why: '800 g of dried kidney beans where the recipe uses canned ones. The page says 38 g protein a serving.',
    was: [g('Kidney beans', 800)],
    now: [g('Kidney beans (canned)', 800)],
  },
  {
    seedId: 'themealdb:53356',
    title: 'Jamaican Fried Dumplings',
    why: 'All the frying oil (1.5 cups) was counted as eaten. The page says 356 kcal a serving.',
    was: [{ name: 'Olive oil', qty: 1.5, unit: 'cup' }],
    now: [{ name: 'Olive oil', qty: 3, unit: 'tbsp' }],
  },
  {
    seedId: 'themealdb:53442',
    title: 'Cheese Sticks',
    why: '1 kg of cheese makes a few dozen sticks, not four servings.',
    servings: { was: 4, now: 10, estimated: true },
  },
  {
    seedId: 'themealdb:53021',
    title: 'Golabki (cabbage roll)',
    why: '420 g of tomato paste where the recipe uses a can of tomato sauce, and a batch of rolls feeds about six.',
    was: [g('Tomato paste', 420)],
    now: [g('Tomato sauce', 420)],
    servings: { was: 4, now: 6, estimated: true },
  },
  {
    seedId: 'themealdb:52906',
    title: 'Flamiche',
    why: 'A leek tart serves about six.',
    servings: { was: 4, now: 6, estimated: true },
  },
  {
    seedId: 'themealdb:53516',
    title: 'Chilean Dobladitas',
    why: 'A batch of small folded breads, not four servings.',
    servings: { was: 4, now: 12, estimated: true },
  },
  {
    seedId: 'themealdb:53560',
    title: 'Mini butter buns',
    why: '1.8 kg of flour makes about three dozen mini buns, not ten servings.',
    servings: { was: 10, now: 36, estimated: true },
  },
  {
    seedId: 'themealdb:53403',
    title: 'Muraba-E-Kadu (Pumpkin Jam)',
    why: 'Jam is eaten by the spoonful. Four servings made it about 950 kcal each.',
    servings: { was: 4, now: 40, estimated: true },
  },
  {
    seedId: 'themealdb:53429',
    title: 'Paracuca (Roasted Peanuts)',
    why: 'The page says it makes 5 cups. A serving is a quarter cup, not a whole cup.',
    servings: { was: 5, now: 20, estimated: true },
  },
  {
    seedId: 'themealdb:53109',
    title: 'Mini chilli beef pies',
    why: 'The page says it makes 24 pies at 137 kcal each.',
    servings: { was: 4, now: 24, estimated: false },
  },
  {
    seedId: 'themealdb:53180',
    title: 'Garlicky prawns with sherry',
    why: 'The page says it serves 6 as a starter.',
    servings: { was: 4, now: 6, estimated: false },
  },
  {
    seedId: 'themealdb:53301',
    title: 'Pork & sauerkraut goulash',
    why: 'The page says it serves 6.',
    servings: { was: 4, now: 6, estimated: false },
  },
  {
    seedId: 'themealdb:52874',
    title: 'Beef and Mustard Pie',
    why: 'The page says it serves 4 to 6. Six is used, since the pie is heavy.',
    servings: { was: 4, now: 6, estimated: true },
  },
  {
    seedId: 'themealdb:53280',
    title: "Poulet Roti a l'Algerienne (Algerian Roast Chicken)",
    why: 'A whole chicken was counted as one chicken breast. About 700 g of meat for four.',
    was: [{ name: 'Chicken breast', qty: 1, unit: 'piece' }],
    now: [g('Chicken thigh', 700)],
  },
  {
    seedId: 'themealdb:53041',
    title: 'Grilled Portuguese sardines',
    why: 'Eight fresh sardines were weighed as small canned ones. The page says 26 g protein a serving.',
    was: [{ name: 'Sardines', qty: 8, unit: 'piece' }],
    now: [g('Sardines', 400)],
  },
  {
    seedId: 'themealdb:52955',
    title: 'Egg Drop Soup',
    why: 'The eggs were missing from the ingredients, and three cups of broth is two bowls, not one.',
    add: [{ name: 'Eggs', qty: 2, unit: 'piece' }],
    servings: { was: 1, now: 2, estimated: true },
  },

  // ---- every other recipe whose page publishes servings, calories and protein, checked against what the app showed ----
  { seedId: 'themealdb:53072', title: 'Crispy Eggplant', why: 'The page uses 3 eggplants, a flour and cornstarch batter and no egg or sesame. It serves 3.',
    was: [pc('Eggplant', 1), { name: 'Breadcrumbs', qty: 1, unit: 'cup' }, tbsp('Canola oil', 1)],
    now: [pc('Eggplant', 3), { name: 'Breadcrumbs', qty: 1.5, unit: 'cup' }, tbsp('Canola oil', 4)],
    add: [{ name: 'All-purpose flour', qty: 1, unit: 'cup' }, { name: 'Cornstarch', qty: 0.5, unit: 'cup' }, { name: 'Baking powder', qty: 0.5, unit: 'tbsp' }, { name: 'Turmeric', qty: 0.5, unit: 'tsp' }],
    drop: ['Sesame seeds', 'Eggs'], servings: S(4, 3, false) },
  { seedId: 'themealdb:53567', title: 'Dominican Bakes', why: 'The page serves 6.', servings: S(8, 6, false) },
  { seedId: 'themealdb:53123', title: 'Fårikål (Norwegian National Dish)', why: 'The page serves 4.', servings: S(6, 4, false) },
  { seedId: 'themealdb:53272', title: 'Griddled flatbreads', why: 'The page makes about 16, at 117 kcal each.', servings: S(4, 16, false) },
  { seedId: 'themealdb:53467', title: 'Liegeoise Salad', why: 'The page serves 2.', servings: S(4, 2, false) },
  { seedId: 'themealdb:53417', title: 'Pa Amb Tomaquet (Bread with Tomato)', why: 'The page serves 12.', servings: S(2, 12, false) },
  { seedId: 'themealdb:53275', title: 'Sweet potato salad', why: 'The page serves 6.', servings: S(4, 6, false) },
  { seedId: 'themealdb:53232', title: 'Vietnamese chicken salad', why: 'The page serves 3.', servings: S(4, 3, false) },
  { seedId: 'themealdb:53106', title: 'Warm roast asparagus salad', why: 'The page serves 4 and uses 16 small new potatoes (about 700 g), not 16 large ones.',
    was: [pc('Potato', 16)], now: [g('Potato', 700)], servings: S(6, 4, false) },
  { seedId: 'themealdb:52841', title: 'Creamy Tomato Soup', why: 'The page says 6 adults and 6 kids and publishes 180 kcal, which is about ten servings.', servings: S(4, 10, true) },
  { seedId: 'themealdb:53479', title: 'Smoky tomato pepper salsa', why: 'It makes 250 ml and the page publishes 76 kcal a serving, which is about six spoonfuls.', servings: S(3, 6, true) },
  { seedId: 'themealdb:53307', title: 'Beetroot & red cabbage sauerkraut', why: 'It fills two jars and the page publishes 6 kcal a serving, which is a spoonful.', servings: S(2, 50, true) },
  { seedId: 'themealdb:53172', title: 'Patatas bravas', why: 'The page serves 10 to 12 and publishes 116 kcal.', servings: S(10, 12, true) },
  { seedId: 'themealdb:53031', title: 'Egyptian Fatteh', why: 'The page serves 6 and publishes 1,100 kcal a serving.', servings: S(8, 6, false) },
  { seedId: 'themealdb:53012', title: 'Gigantes Plaki', why: 'The page uses 400 g of dried butter beans (22 g protein a serving), not 240 g of canned, and 1 tsp of sugar.',
    was: [g('Butter beans (canned)', 240), tbsp('Sugar', 1)], now: [g('White beans', 400), { name: 'Sugar', qty: 1, unit: 'tsp' }], servings: S(4, 4, false) },
  { seedId: 'themealdb:53164', title: 'Spanish Chicken', why: 'Eight skin-on, bone-in thighs, about 1.1 kg. The page says 53 g protein a serving.',
    was: [pc('Chicken thigh', 8)], now: [g('Chicken thigh', 1100)], servings: S(4, 4, false) },
  { seedId: 'themealdb:53268', title: 'Roasted chicken with creamy walnut sauce', why: 'Eight skin-on, bone-in thighs, about 1.1 kg. The page says 67 g protein a serving.',
    was: [pc('Chicken thigh', 8)], now: [g('Chicken thigh', 1100)] },
  { seedId: 'themealdb:53181', title: 'Spanish beans with chicken & chorizo', why: 'Four skin-on thighs, about 550 g. The page says 55 g protein a serving.',
    was: [pc('Chicken thigh', 4)], now: [g('Chicken thigh', 550)], servings: S(4, 4, false) },
  { seedId: 'themealdb:53389', title: 'Apple Potato Mash (Hete bliksem)', why: 'The page uses 500 g each of potato and apple, 250 g Gouda, 200 g sesame seeds, an onion and butter, and no cinnamon or maple syrup. It publishes 824 kcal.',
    was: [g('Apple', 250), g('Potato', 250), g('Cheddar cheese', 200), g('Sesame seeds', 50)],
    now: [g('Apple', 500), g('Potato', 500), g('Gouda', 250), g('Sesame seeds', 200)],
    add: [pc('Onion', 1), tbsp('Butter', 1)], drop: ['Cinnamon', 'Maple syrup'] },
  { seedId: 'themealdb:53055', title: 'Cevapi Sausages', why: 'The page uses 450 g ground beef and 270 g ground pork, not a chuck roast and a pork loin. It publishes 571 kcal.',
    was: [g('Beef chuck roast', 500), g('Pork loin', 250)], now: [g('Ground beef (80/20)', 450), g('Ground pork', 270)] },
  { seedId: 'themealdb:53273', title: "Roast aubergine with goat's cheese & toasted flatbread", why: 'Twelve cherry tomatoes (about 200 g) were weighed as full-size tomatoes. The page publishes 339 kcal.',
    was: [pc('Tomato', 12)], now: [g('Tomato', 200)] },
  { seedId: 'themealdb:52840', title: 'Clam chowder', why: '1.5 kg of clams is their weight in the shell. About 700 g is meat. The page says 22 g protein a serving.',
    was: [g('Clams', 1500)], now: [g('Clams', 700)] },
  { seedId: 'themealdb:52977', title: 'Corba', why: 'The page uses 2 tbsp of olive oil, which was left out.', add: [tbsp('Olive oil', 2)] },
  { seedId: 'themealdb:52978', title: 'Kumpir', why: 'The page uses four potatoes and 200 g of cheese, and no butter. It publishes 450 kcal.',
    was: [pc('Potato', 2), g('Cheddar cheese', 150)], now: [pc('Potato', 4), g('Cheddar cheese', 200)], drop: ['Butter'] },
  { seedId: 'themealdb:53464', title: 'Flemish Hutsepot', why: 'Four fresh sausages weigh about 400 g. The page publishes 648 kcal.',
    was: [pc('Pork sausages', 4)], now: [g('Pork sausages', 400)], servings: S(4, 4, false) },
  { seedId: 'themealdb:52869', title: 'Tahini Lentils', why: 'The page uses a 250 g pack of cooked lentils, not dry ones. It publishes 293 kcal.',
    was: [g('Lentils', 250)], now: [g('Lentils (cooked)', 250)], servings: S(4, 4, false) },
  { seedId: 'themealdb:52834', title: 'Beef stroganoff', why: 'The page uses fillet steak and 150 g of crème fraîche, closer to cream than sour cream. It publishes 438 kcal.',
    was: [g('Beef chuck roast', 500), g('Sour cream', 150)], now: [g('Beef sirloin steak', 500), { name: 'Heavy cream', qty: 150, unit: 'ml' }], servings: S(4, 4, false) },
  published('themealdb:52873', 'Beef Dumpling Stew', 4),
  published('themealdb:53157', 'Chorizo & soft-boiled egg salad', 4),
  published('themealdb:53035', 'Ham hock colcannon', 4),
  published('themealdb:52844', 'Lasagne', 6),
  published('themealdb:52876', 'Minced Beef Pie', 4),
  published('themealdb:53173', 'Quick gazpacho', 1),
  published('themealdb:52960', 'Salmon Avocado Salad', 4),
  { seedId: 'themealdb:53302', title: 'Slow-roasted ham with lemon, garlic & sage', why: 'A 2 kg bone-in pork joint is about 1.7 kg of meat. The page serves 6 and publishes 672 kcal and 57 g protein.',
    was: [g('Pork shoulder', 2000)], now: [g('Pork shoulder', 1700)], servings: S(6, 6, false) },
  { seedId: 'themealdb:53169', title: 'Ajo blanco', why: 'A cold starter soup. The page publishes 265 kcal a serving, which is about eight small bowls.', servings: S(4, 8, true) },
  published('themealdb:53183', 'Spanish meatballs with clams, chorizo & squid', 4),
]
