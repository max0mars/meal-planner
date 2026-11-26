// Adds the plain everyday recipes in this file to src/data/recipes.seed.json (skips any seedId already there).
// Usage: node scripts/add-basic-recipes.mjs
// Quantities are raw (uncooked) weights. Every ingredient name must exist in ingredients.seed.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const seedPath = join(here, '..', 'src', 'data', 'recipes.seed.json')
const foods = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'ingredients.seed.json'), 'utf8'))
const byName = new Map(foods.map((f) => [f.name, f]))

const g = (name, qty) => ({ name, qty, unit: 'g' })
const ml = (name, qty) => ({ name, qty, unit: 'ml' })
const tbsp = (name, qty) => ({ name, qty, unit: 'tbsp' })
const tsp = (name, qty) => ({ name, qty, unit: 'tsp' })
const pc = (name, qty) => ({ name, qty, unit: 'piece' })
// a line the recipe works without (left out for anyone sensitive to it)
const optional = (line) => ({ ...line, optional: true })
// a flexible line: `line` is the default, and any food in `anyCategory` or named in `anyOf` can be used instead
const flex = (label, line, { anyOf, anyCategory } = {}) => ({ ...line, label, ...(anyOf ? { anyOf } : {}), ...(anyCategory ? { anyCategory } : {}) })

const R = (id, title, category, cuisine, description, servings, estMinutes, ingredients, steps) => ({
  seedId: `basic:${id}`, title, category, cuisine, description, source: '', servings, servingsEstimated: false,
  estMinutes, timeEstimated: false, ingredients, steps,
})

const recipes = [
  R('beef-rice-bowl', 'Ground beef rice bowl', 'Beef', 'American', 'Browned ground beef with soy sauce and garlic over rice, with steamed broccoli on the side.', 4, 25,
    [g('White rice', 300), g('Ground beef (93/7)', 500), g('Broccoli', 300), pc('Garlic', 3), tbsp('Soy sauce', 3), tbsp('Canola oil', 1)],
    ['Cook the rice.', 'Brown the beef in the oil in a large pan, breaking it up. Stir in the chopped garlic and soy sauce.', 'Steam or microwave the broccoli until tender.', 'Serve the beef and broccoli over the rice.']),
  R('taco-bowl', 'Taco bowl', 'Beef', 'American', 'Seasoned ground beef over rice with black beans, lettuce, salsa and cheese.', 4, 25,
    [g('White rice', 300), g('Ground beef (80/20)', 500), g('Black beans (canned)', 400), g('Romaine lettuce', 150), g('Salsa', 120), g('Cheddar cheese', 80), tbsp('Chili powder', 2), tsp('Cumin', 1)],
    ['Cook the rice.', 'Brown the beef, drain off most of the fat, then stir in the chili powder, cumin and a splash of water.', 'Warm the beans.', 'Fill bowls with rice, beef and beans. Top with shredded lettuce, salsa and cheese.']),
  R('turkey-rice-skillet', 'Ground turkey and rice skillet', 'Chicken', 'American', 'One pan of ground turkey, peppers, tomatoes and rice cooked together.', 4, 35,
    [g('Ground turkey', 500), g('White rice', 225), pc('Onion', 1), pc('Bell pepper', 2), g('Canned tomatoes', 400), ml('Chicken broth', 400), tbsp('Olive oil', 1), tsp('Paprika', 2)],
    ['Brown the turkey in the oil with the chopped onion and peppers.', 'Stir in the rice, tomatoes, broth and paprika.', 'Cover and simmer on low for about 20 minutes until the rice is cooked.']),
  R('beef-broccoli-rice', 'Beef and broccoli over rice', 'Beef', 'American', 'Sliced steak and broccoli in a simple soy and garlic sauce, served over rice.', 4, 30,
    [g('Beef sirloin steak', 500), g('Broccoli', 400), g('White rice', 300), tbsp('Soy sauce', 4), pc('Garlic', 3), tbsp('Honey', 1), tbsp('Cornstarch', 1), tbsp('Canola oil', 1)],
    ['Cook the rice.', 'Slice the steak thin. Mix the soy sauce, honey, cornstarch and 4 tbsp water.', 'Sear the steak in the oil, then set it aside.', 'Cook the broccoli and garlic in the pan for 4 minutes, add the steak and sauce and stir until thick.', 'Serve over the rice.']),
  R('spaghetti-meat-sauce', 'Spaghetti with meat sauce', 'Pasta', 'Italian', 'Spaghetti with a quick ground beef and tomato sauce.', 4, 30,
    [g('Wheat pasta', 340), g('Ground beef (80/20)', 500), g('Canned tomatoes', 400), g('Tomato sauce', 200), pc('Onion', 1), pc('Garlic', 3), tsp('Oregano (dried)', 2)],
    ['Boil the pasta in salted water.', 'Brown the beef with the chopped onion and garlic, and drain off extra fat.', 'Add the tomatoes, tomato sauce and oregano and simmer for 15 minutes.', 'Drain the pasta and mix in the sauce.']),
  R('chicken-broccoli-pasta', 'Chicken and broccoli pasta', 'Pasta', 'Italian', 'Pasta tossed with pan-cooked chicken, broccoli, garlic and parmesan.', 4, 25,
    [g('Wheat pasta', 300), g('Chicken breast', 500), g('Broccoli', 300), pc('Garlic', 3), tbsp('Olive oil', 2), g('Parmesan', 40)],
    ['Boil the pasta, adding the broccoli for the last 3 minutes. Save a cup of the water.', 'Cut the chicken into pieces and cook in the oil until done. Add the garlic for the last minute.', 'Toss everything together with the parmesan and a splash of pasta water.']),
  R('sausage-pepper-pasta', 'Sausage and pepper pasta', 'Pasta', 'Italian', 'Pasta with browned sausage, peppers, onion and tomato sauce.', 4, 30,
    [g('Wheat pasta', 300), g('Pork sausages', 400), pc('Bell pepper', 2), pc('Onion', 1), g('Tomato sauce', 400)],
    ['Boil the pasta.', 'Brown the sliced sausage in a pan, then add the sliced peppers and onion and cook until soft.', 'Add the tomato sauce and simmer for 10 minutes.', 'Mix with the drained pasta.']),
  R('tuna-pasta', 'Tuna pasta', 'Pasta', 'Italian', 'A five-ingredient pasta with canned tuna, peas, lemon and parmesan.', 3, 20,
    [g('Wheat pasta', 250), g('Canned tuna', 280), g('Green peas', 150), tbsp('Olive oil', 2), tbsp('Lemon juice', 2), g('Parmesan', 30)],
    ['Boil the pasta, adding the peas for the last 2 minutes.', 'Drain, then toss with the drained tuna, oil, lemon juice and parmesan.']),
  R('meatballs-pasta', 'Meatballs and pasta', 'Pasta', 'Italian', 'Baked ground beef meatballs in tomato sauce over pasta.', 4, 40,
    [g('Ground beef (80/20)', 500), g('Breadcrumbs', 60), pc('Eggs', 1), g('Parmesan', 30), g('Tomato sauce', 500), g('Wheat pasta', 300), tsp('Garlic powder', 1), tsp('Oregano (dried)', 1)],
    ['Heat the oven to 200 C (400 F).', 'Mix the beef, breadcrumbs, egg, parmesan, garlic powder and oregano. Roll into balls and bake for 18 minutes.', 'Boil the pasta and warm the tomato sauce.', 'Add the meatballs to the sauce and serve over the pasta.']),
  R('cheesy-beef-pasta', 'Cheesy beef pasta', 'Pasta', 'American', 'Pasta, ground beef and tomato sauce with melted cheddar, all in one dinner.', 4, 30,
    [g('Wheat pasta', 300), g('Ground beef (80/20)', 500), g('Tomato sauce', 300), g('Cheddar cheese', 120), pc('Onion', 1), ml('Whole milk', 100)],
    ['Boil the pasta.', 'Brown the beef with the chopped onion and drain off extra fat.', 'Stir in the tomato sauce, milk and most of the cheese until melted.', 'Mix in the pasta and top with the rest of the cheese.']),
  R('chicken-thighs-rice-green-beans', 'Baked chicken thighs with rice and green beans', 'Chicken', 'American', 'Seasoned chicken thighs baked on a tray with green beans, served with rice.', 4, 45,
    [g('Chicken thigh', 800), g('White rice', 300), g('Green beans', 400), tbsp('Olive oil', 2), tsp('Paprika', 2), tsp('Garlic powder', 1)],
    ['Heat the oven to 220 C (425 F).', 'Rub the chicken with half the oil, paprika, garlic powder and salt. Toss the beans in the rest of the oil.', 'Bake the chicken for 25 minutes, add the beans to the tray, and bake 15 more minutes.', 'Cook the rice and serve alongside.']),
  R('sheet-pan-chicken', 'Sheet pan chicken, potatoes and broccoli', 'Chicken', 'American', 'Chicken breast, potatoes and broccoli roasted on one tray.', 4, 45,
    [g('Chicken breast', 600), g('Potato', 600), g('Broccoli', 400), tbsp('Olive oil', 3), tsp('Paprika', 2), tsp('Garlic powder', 1)],
    ['Heat the oven to 220 C (425 F).', 'Cut the potatoes into chunks and roast them with half the oil for 15 minutes.', 'Add the chicken and broccoli tossed with the rest of the oil and the spices.', 'Roast another 20 to 25 minutes until the chicken is cooked through.']),
  R('pork-chops-rice-green-beans', 'Pan-seared pork chops with rice and green beans', 'Pork', 'American', 'Pork chops browned in a pan, served with rice and buttery green beans.', 4, 30,
    [g('Pork chop', 700), g('White rice', 300), g('Green beans', 400), tbsp('Butter', 1), tbsp('Olive oil', 1), tsp('Garlic powder', 1)],
    ['Cook the rice.', 'Season the chops with salt and garlic powder. Sear in the oil for about 5 minutes a side until cooked through.', 'Steam the green beans and toss with the butter.', 'Serve together.']),
  R('steak-potatoes-asparagus', 'Steak, potatoes and asparagus', 'Beef', 'American', 'Pan-seared sirloin with roasted potatoes and asparagus.', 3, 40,
    [g('Beef sirloin steak', 500), g('Potato', 500), g('Asparagus', 250), tbsp('Butter', 1), tbsp('Olive oil', 2)],
    ['Heat the oven to 220 C (425 F). Roast the potato chunks with half the oil for 25 minutes.', 'Add the asparagus for the last 10 minutes.', 'Season the steak and sear in a hot pan with the rest of the oil, 3 to 4 minutes a side. Add the butter at the end.', 'Rest the steak a few minutes, slice and serve.']),
  R('pulled-pork-rice-bowl', 'Slow cooker pulled pork rice bowl', 'Pork', 'American', 'Pork shoulder cooked slowly until it falls apart, served on rice with shredded cabbage.', 6, 480,
    [g('Pork shoulder', 1000), g('White rice', 450), g('Cabbage', 300), pc('Onion', 1), tbsp('Ketchup', 3), tbsp('Brown sugar', 2), tbsp('Apple cider vinegar', 2), tsp('Paprika', 2)],
    ['Put the pork, sliced onion, ketchup, sugar, vinegar, paprika and salt in a slow cooker.', 'Cook on low for 8 hours, until it shreds easily.', 'Shred the pork and stir it in the juices.', 'Cook the rice. Serve the pork over rice with shredded cabbage.']),
  R('chicken-fried-rice', 'Chicken fried rice', 'Chicken', 'American', 'Rice stir-fried with chicken, egg, peas, carrot and soy sauce.', 4, 30,
    [g('White rice', 300), g('Chicken breast', 400), pc('Eggs', 3), g('Green peas', 150), pc('Carrot', 2), tbsp('Soy sauce', 3), tbsp('Sesame oil', 1), pc('Green onion', 3)],
    ['Cook the rice ahead (cold rice works best).', 'Cook the diced chicken and carrot in the sesame oil until the chicken is done.', 'Push to the side, scramble the eggs, then add the rice, peas and soy sauce.', 'Stir-fry for 3 minutes and top with sliced green onion.']),
  R('chicken-burrito-bowl', 'Chicken burrito bowl', 'Chicken', 'American', 'Chicken, rice, black beans, corn, salsa and avocado in a bowl.', 4, 30,
    [g('Chicken breast', 500), g('White rice', 225), g('Black beans (canned)', 400), g('Sweet corn', 200), g('Salsa', 120), pc('Avocado', 1), tbsp('Chili powder', 1), tbsp('Olive oil', 1)],
    ['Cook the rice.', 'Season the chicken with chili powder and salt and cook in the oil, then slice.', 'Warm the beans and corn.', 'Fill bowls with rice, chicken, beans and corn. Top with salsa and sliced avocado.']),
  R('turkey-chili', 'Turkey chili', 'Chicken', 'American', 'A big pot of ground turkey, beans and tomatoes that keeps well for the week.', 5, 40,
    [g('Ground turkey', 500), g('Kidney beans (canned)', 400), g('Canned tomatoes', 800), pc('Onion', 1), pc('Bell pepper', 1), tbsp('Chili powder', 2), tsp('Cumin', 2), tbsp('Olive oil', 1)],
    ['Soften the chopped onion and pepper in the oil, then brown the turkey.', 'Add the drained beans, tomatoes, chili powder and cumin.', 'Simmer for 25 minutes, stirring now and then.']),
  R('beef-potato-hash', 'Beef and potato hash', 'Beef', 'American', 'Diced potatoes fried with ground beef, onion and pepper in one pan.', 4, 35,
    [g('Ground beef (80/20)', 500), g('Potato', 600), pc('Onion', 1), pc('Bell pepper', 1), tbsp('Olive oil', 2), tsp('Paprika', 1)],
    ['Dice the potatoes small and fry in the oil for 12 minutes until golden.', 'Add the onion and pepper, then the beef and paprika.', 'Cook until the beef is browned and everything is tender.']),
  R('salmon-rice-broccoli', 'Baked salmon with rice and broccoli', 'Seafood', 'American', 'Salmon fillets baked with lemon, served with rice and broccoli.', 3, 30,
    [g('Salmon', 500), g('White rice', 225), g('Broccoli', 400), tbsp('Olive oil', 1), tbsp('Lemon juice', 2)],
    ['Heat the oven to 200 C (400 F).', 'Put the salmon and broccoli on a tray, drizzle with the oil and lemon juice, and season with salt.', 'Bake 12 to 15 minutes.', 'Serve with cooked rice.']),
  R('shrimp-rice-stir-fry', 'Shrimp and vegetable rice', 'Seafood', 'American', 'Shrimp stir-fried with peppers and broccoli and served on rice.', 4, 25,
    [g('Shrimp', 500), g('White rice', 300), pc('Bell pepper', 2), g('Broccoli', 300), tbsp('Soy sauce', 3), pc('Garlic', 2), tbsp('Canola oil', 1)],
    ['Cook the rice.', 'Stir-fry the vegetables and garlic in the oil for 5 minutes.', 'Add the shrimp and soy sauce and cook until the shrimp turn pink, about 3 minutes.', 'Serve over the rice.']),
  R('sloppy-joes', 'Sloppy joes', 'Beef', 'American', 'Ground beef in a sweet tomato sauce, piled into buns.', 4, 25,
    [g('Ground beef (80/20)', 500), g('Tomato sauce', 200), pc('Onion', 1), tbsp('Ketchup', 2), tsp('Yellow mustard', 2), tbsp('Brown sugar', 1), g('Burger buns', 240)],
    ['Brown the beef with the chopped onion and drain off extra fat.', 'Stir in the tomato sauce, ketchup, mustard and sugar and simmer for 10 minutes.', 'Spoon into the buns.']),
  R('chicken-quesadillas', 'Chicken quesadillas', 'Chicken', 'American', 'Tortillas filled with chicken, peppers and cheese and fried until crisp.', 4, 25,
    [pc('Flour tortillas', 4), g('Chicken breast', 400), g('Cheddar cheese', 150), pc('Bell pepper', 1), tbsp('Olive oil', 1), g('Salsa', 100)],
    ['Cook the diced chicken and pepper in half the oil until done.', 'Fill half of each tortilla with chicken and cheese and fold over.', 'Fry in the rest of the oil for 2 minutes a side until golden. Serve with salsa.']),
  R('ham-cheese-omelette', 'Ham and cheese omelette', 'Breakfast', 'American', 'A three-egg omelette with ham, pepper and cheese.', 2, 10,
    [pc('Eggs', 6), g('Ham', 100), g('Cheddar cheese', 50), pc('Bell pepper', 1), tbsp('Butter', 1)],
    ['Whisk the eggs with a pinch of salt.', 'Melt the butter in a pan, cook the diced pepper and ham for 2 minutes, then pour in the eggs.', 'Add the cheese, fold over and cook until set.']),
  R('rice-beans-eggs', 'Rice and beans with eggs', 'Vegetarian', 'American', 'Rice and black beans topped with fried eggs, salsa and avocado.', 3, 20,
    [g('White rice', 225), g('Black beans (canned)', 400), pc('Eggs', 4), g('Salsa', 90), pc('Avocado', 1), tbsp('Olive oil', 1)],
    ['Cook the rice and warm the beans.', 'Fry the eggs in the oil.', 'Serve the eggs on the rice and beans with salsa and sliced avocado.']),
  R('chicken-sweet-potato-green-beans', 'Chicken, sweet potato and green beans', 'Chicken', 'American', 'Roasted chicken breast with sweet potato chunks and green beans.', 4, 40,
    [g('Chicken breast', 600), g('Sweet potato', 600), g('Green beans', 400), tbsp('Olive oil', 3), tsp('Paprika', 2)],
    ['Heat the oven to 220 C (425 F).', 'Roast the sweet potato chunks with half the oil for 15 minutes.', 'Add the chicken and green beans tossed with the rest of the oil and the paprika.', 'Roast 20 more minutes until the chicken is cooked through.']),
  R('one-pot-chicken-rice', 'One-pot chicken thighs and rice', 'Chicken', 'American', 'Chicken thighs, rice, carrot and peas all cooked together in one pot.', 4, 45,
    [g('Chicken thigh', 700), g('White rice', 300), ml('Chicken broth', 600), pc('Carrot', 2), g('Green peas', 150), tbsp('Olive oil', 1), tsp('Garlic powder', 1)],
    ['Brown the seasoned chicken in the oil, then set it aside.', 'Stir the rice, diced carrot, broth and garlic powder into the pot and put the chicken on top.', 'Cover and simmer 25 minutes, adding the peas for the last 5.']),
  R('pork-tenderloin-rice-carrots', 'Pork tenderloin with rice and carrots', 'Pork', 'American', 'Roasted pork tenderloin with roasted carrots and rice.', 4, 45,
    [g('Pork tenderloin', 600), g('White rice', 300), pc('Carrot', 4), tbsp('Olive oil', 2), tsp('Paprika', 1), tsp('Garlic powder', 1)],
    ['Heat the oven to 200 C (400 F).', 'Rub the pork with half the oil and the spices. Toss the carrot sticks in the rest.', 'Roast together for 25 minutes until the pork reaches 63 C (145 F). Rest 5 minutes and slice.', 'Serve with cooked rice.']),
  R('tuna-rice-bowl', 'Tuna rice bowl', 'Seafood', 'American', 'Canned tuna over rice with cucumber, avocado and soy sauce.', 2, 15,
    [g('White rice', 150), g('Canned tuna', 280), pc('Cucumber', 1), pc('Avocado', 1), tbsp('Soy sauce', 2), tbsp('Mayonnaise', 1)],
    ['Cook the rice.', 'Mix the drained tuna with the mayonnaise.', 'Top the rice with the tuna, sliced cucumber and avocado and drizzle with soy sauce.']),
  R('oatmeal-pb-banana', 'Peanut butter banana oatmeal', 'Breakfast', 'American', 'Oats cooked in milk with banana and peanut butter.', 2, 10,
    [g('Rolled oats', 160), ml('2% milk', 480), pc('Banana', 2), tbsp('Peanut butter', 2)],
    ['Simmer the oats in the milk for 5 minutes, stirring.', 'Top with sliced banana and a spoonful of peanut butter.']),
  R('yogurt-berry-bowl', 'Greek yogurt berry bowl', 'Breakfast', 'American', 'Greek yogurt with blueberries, almonds and honey.', 2, 5,
    [g('Greek yogurt (nonfat)', 500), g('Blueberries', 150), g('Almonds', 40), tbsp('Honey', 1)],
    ['Spoon the yogurt into two bowls.', 'Top with the blueberries, chopped almonds and honey.']),
  R('egg-scramble-toast', 'Egg scramble with toast', 'Breakfast', 'American', 'Scrambled eggs with spinach and cheese, with whole wheat toast.', 2, 10,
    [pc('Eggs', 6), g('Spinach', 60), g('Cheddar cheese', 40), g('Whole wheat bread', 120), tbsp('Butter', 1)],
    ['Melt the butter and wilt the spinach in a pan.', 'Pour in the whisked eggs and stir gently until just set. Stir in the cheese.', 'Toast the bread and serve.']),
  // A flexible recipe: make it with whatever meat, pasta and sauce you have. Onion and garlic can be left out.
  // One hearty meal: half a 1 lb (454 g) box of pasta, half a 24 oz (680 g) jar of sauce, 2 sausages (60 g each), 1 onion.
  R('meat-sauce-pasta', 'Meat sauce pasta', 'Pasta', 'Italian', 'Pasta in a tomato sauce with cooked meat, made with any meat, pasta and pasta sauce you have.', 1, 25,
    [
      flex('Meat', g('Pork sausages', 120), { anyCategory: 'meat' }),
      flex('Pasta', g('Wheat pasta', 227), { anyOf: ['Whole wheat pasta', 'Gluten-free pasta'] }),
      flex('Pasta sauce', g('Tomato sauce', 340), { anyOf: ['Canned tomatoes'] }),
      optional(pc('Onion', 1)),
      optional(pc('Garlic', 2)),
    ],
    ['Boil the pasta in salted water.', 'Slice the meat (or break up ground meat) and cook it in a pan with the chopped onion and garlic, if using, until the meat is cooked through.', 'Pour in the sauce and simmer for 10 minutes.', 'Drain the pasta and mix in the sauce.']),
]

const problems = []
for (const r of recipes) {
  for (const l of r.ingredients) {
    const f = byName.get(l.name)
    for (const alt of l.anyOf ?? []) if (!byName.has(alt)) problems.push(`${r.title}: unknown food "${alt}"`)
    if (!f) problems.push(`${r.title}: unknown food "${l.name}"`)
    else if (l.unit === 'piece' && !f.gramsPerPiece) problems.push(`${r.title}: "${l.name}" has no piece weight`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
const have = new Set(seed.map((s) => s.seedId))
const fresh = recipes.filter((r) => !have.has(r.seedId))
writeFileSync(seedPath, JSON.stringify([...seed, ...fresh], null, 1))
console.log(`Added ${fresh.length} recipes (${seed.length} -> ${seed.length + fresh.length}).`)
