// Builds src/data/ingredients.seed.json: a curated list of everyday ingredients whose
// nutrition values are looked up in the USDA FoodData Central "SR Legacy" CSV bundle.
// Usage: node scripts/build-seed.mjs <path-to-extracted-csv-folder>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node scripts/build-seed.mjs <csv-folder>')
  process.exit(1)
}

// ---- shelf life defaults by category (days from purchase) ----
const SHELF = {
  meat: { fridge: 3, freezer: 270 },
  seafood: { fridge: 2, freezer: 180 },
  'dairy-eggs': { fridge: 10, freezer: 90 },
  produce: { fridge: 7, freezer: 240, pantry: 5 },
  fruit: { fridge: 7, freezer: 240, pantry: 5 },
  grains: { pantry: 365, fridge: 365, freezer: 365 },
  legumes: { pantry: 730, fridge: 730 },
  'nuts-seeds': { pantry: 180, fridge: 365, freezer: 540 },
  'fats-oils': { pantry: 365, fridge: 540 },
  'spices-herbs': { pantry: 730, fridge: 730 },
  pantry: { pantry: 365, fridge: 365 },
}

// ---- curated list ----
// m: substrings that must all appear in the USDA description (shortest match wins), joined with '+'
// x: substrings that must NOT appear, joined with '+'
// n: [kcal, protein] per 100 g, used instead of a USDA lookup
const L = []
const add = (name, m, cat, tags = [], aliases = [], extra = {}) => L.push({ name, m, cat, tags, aliases, ...extra })

// Meat
add('Chicken breast', 'Chicken, broilers or fryers, light meat, meat only, raw', 'meat', [], ['chicken'])
add('Chicken thigh', 'Chicken, broilers or fryers, dark meat, thigh, meat only, raw', 'meat', [], ['chicken'])
add('Ground chicken', 'Chicken, ground, raw', 'meat', [], ['chicken'])
add('Ground turkey', 'Turkey, ground, raw', 'meat', [], ['turkey'])
add('Turkey breast', 'Turkey+breast+meat only+raw', 'meat', [], ['turkey'])
add('Ground beef (80/20)', 'Beef, ground, 80% lean meat / 20% fat, raw', 'meat', [], ['hamburger', 'mince', 'beef mince', 'minced beef', 'ground beef'])
add('Ground beef (93/7)', 'Beef, ground, 93% lean meat / 7% fat, raw', 'meat', [], ['lean beef', 'lean ground beef'])
add('Beef sirloin steak', 'Beef+top sirloin+separable lean only+raw', 'meat', [], ['steak'])
add('Beef chuck roast', 'Beef+chuck+separable lean and fat+raw', 'meat', [], ['beef', 'pot roast', 'stewing beef', 'stew beef', 'beef stew meat', 'chuck roast'])
add('Pork loin', 'Pork, fresh, loin, whole, separable lean and fat, raw', 'meat', [], ['pork'])
add('Pork tenderloin', 'Pork+tenderloin+separable lean only+raw', 'meat', [], ['pork'])
add('Bacon', 'Pork, cured, bacon, unprepared', 'meat', [], [])
// Seafood
add('Salmon', 'Fish, salmon, Atlantic, farmed, raw', 'seafood', ['fish'], [])
add('Cod', 'Fish, cod, Atlantic, raw', 'seafood', ['fish'], [])
add('Tilapia', 'Fish, tilapia, raw', 'seafood', ['fish'], [])
add('Canned tuna', 'Fish, tuna, light, canned in water, drained solids', 'seafood', ['fish'], ['tuna'], { shelf: { pantry: 1095, fridge: 3 } })
add('Shrimp', 'Crustaceans, shrimp, mixed species, raw', 'seafood', ['shellfish'], ['prawn', 'king prawns', 'tiger prawns'])
// Eggs & dairy
add('Eggs', 'Egg, whole, raw, fresh', 'dairy-eggs', ['egg'], ['egg'], { shelf: { fridge: 28, freezer: 365 } })
add('Whole milk', 'Milk, whole, 3.25% milkfat', 'dairy-eggs', ['dairy', 'lactose'], ['milk'], { shelf: { fridge: 7, freezer: 90 } })
add('2% milk', 'Milk, reduced fat, fluid, 2% milkfat', 'dairy-eggs', ['dairy', 'lactose'], ['milk'], { shelf: { fridge: 7, freezer: 90 } })
add('Skim milk', 'Milk, nonfat, fluid', 'dairy-eggs', ['dairy', 'lactose'], ['milk'], { x: 'calcium+protein+flavored', shelf: { fridge: 7, freezer: 90 } })
add('Lactose-free milk', '', 'dairy-eggs', ['dairy'], ['milk'], { n: [50, 3.3], shelf: { fridge: 14, freezer: 90 } })
add('Butter', 'Butter, salted', 'dairy-eggs', ['dairy'], [], { shelf: { fridge: 60, freezer: 270, pantry: 3 } })
add('Ghee', 'Butter oil, anhydrous', 'dairy-eggs', ['dairy'], ['clarified butter'], { shelf: { pantry: 90, fridge: 365 } })
add('Heavy cream', 'Cream, fluid, heavy whipping', 'dairy-eggs', ['dairy', 'lactose'], ['cream', 'double cream', 'whipping cream'], { shelf: { fridge: 10, freezer: 90 } })
add('Sour cream', 'Cream, sour, cultured', 'dairy-eggs', ['dairy', 'lactose'], ['soured cream', 'creme fraiche', 'crème fraîche'], { shelf: { fridge: 14 } })
add('Plain yogurt', 'Yogurt, plain, whole milk', 'dairy-eggs', ['dairy', 'lactose'], ['yoghurt'], { x: 'Greek', shelf: { fridge: 14, freezer: 60 } })
add('Greek yogurt (nonfat)', 'Yogurt, Greek, plain, nonfat', 'dairy-eggs', ['dairy', 'lactose'], ['yoghurt'], { shelf: { fridge: 14, freezer: 60 } })
add('Cheddar cheese', 'Cheese, cheddar (Includes', 'dairy-eggs', ['dairy'], ['cheese'], { shelf: { fridge: 28, freezer: 180 } })
add('Mozzarella', 'Cheese, mozzarella, whole milk', 'dairy-eggs', ['dairy', 'lactose'], ['cheese', 'mozzarella balls', 'mozzarella ball', 'buffalo mozzarella'], { x: 'low', shelf: { fridge: 14, freezer: 180 } })
add('Parmesan', 'Cheese, parmesan, hard', 'dairy-eggs', ['dairy'], ['cheese', 'parmesan cheese', 'parmigiano-reggiano', 'parmigiano reggiano'], { shelf: { fridge: 60, freezer: 270 } })
add('Swiss cheese', 'Cheese, swiss', 'dairy-eggs', ['dairy'], ['cheese'], { x: 'low+imitation+processed', shelf: { fridge: 28, freezer: 180 } })
add('Cottage cheese', 'Cheese, cottage, creamed, large or small curd', 'dairy-eggs', ['dairy', 'lactose'], ['cheese'], { shelf: { fridge: 10 } })
add('Cream cheese', 'Cheese, cream', 'dairy-eggs', ['dairy', 'lactose'], ['cheese'], { x: 'fat free+low+whipped', shelf: { fridge: 14 } })
add('Feta', 'Cheese, feta', 'dairy-eggs', ['dairy', 'lactose'], ['cheese'], { shelf: { fridge: 21 } })
add('Almond milk (unsweetened)', 'Beverages, almond milk, unsweetened', 'dairy-eggs', ['tree-nut'], ['milk'], { shelf: { fridge: 7, pantry: 180 } })
add('Soy milk', 'Soymilk, original and vanilla, unfortified', 'dairy-eggs', ['soy'], ['milk'], { x: '', shelf: { fridge: 7, pantry: 180 } })
add('Oat milk', '', 'dairy-eggs', ['oats'], ['milk'], { n: [43, 1], shelf: { fridge: 7, pantry: 180 } })
add('Whey protein powder', '', 'pantry', ['dairy', 'lactose'], ['protein powder'], { n: [400, 80], shelf: { pantry: 540 } })
add('Pea protein powder', '', 'pantry', [], ['protein powder'], { n: [380, 75], shelf: { pantry: 540 } })
// Grains & starches
add('White rice', 'Rice, white, long-grain, regular, raw', 'grains', [], ['rice', 'basmati rice', 'jasmine rice', 'long grain rice', 'long-grain rice', 'paella rice', 'arborio rice', 'risotto rice', 'pudding rice'])
add('Brown rice', 'Rice, brown, long-grain, raw', 'grains', [], ['rice'])
add('Rolled oats', 'Cereals, oats, regular and quick, not fortified, dry', 'grains', ['oats'], ['oatmeal', 'porridge'])
add('Wheat pasta', 'Pasta, dry, enriched', 'grains', ['gluten', 'wheat'], ['spaghetti', 'noodles', 'lasagne sheets', 'lasagna sheets', 'lasagne', 'lasagna', 'macaroni', 'linguine', 'linguine pasta', 'penne', 'fusilli', 'tagliatelle', 'farfalle', 'rigatoni', 'pappardelle', 'fettuccine', 'orzo', 'pasta', 'pasta shapes', 'penne rigate', 'paccheri', 'paccheri pasta', 'bowtie pasta', 'conchiglie', 'tagliolini', 'spaghettini', 'cannelloni'])
add('Gluten-free pasta', '', 'grains', [], ['pasta', 'noodles'], { n: [357, 7.5] })
add('Rice noodles', 'Rice noodles, dry', 'grains', [], ['noodles', 'chow fun', 'chow fun noodles', 'ho fun'])
add('White bread', 'Bread, white, commercially prepared', 'grains', ['gluten', 'wheat'], ['bread', 'sliced bread'], { x: 'low+toasted+cubes', shelf: { pantry: 5, fridge: 10, freezer: 90 } })
add('Whole wheat bread', 'Bread, whole-wheat, commercially prepared', 'grains', ['gluten', 'wheat'], [], { x: 'low+toasted+crumbs+cubes+reduced', shelf: { pantry: 5, fridge: 10, freezer: 90 } })
add('Corn tortillas', 'Tortillas, ready-to-bake or -fry, corn', 'grains', ['corn'], ['tortilla'], { shelf: { pantry: 7, fridge: 21, freezer: 180 } })
add('Flour tortillas', 'Tortillas, ready-to-bake or -fry, flour', 'grains', ['gluten', 'wheat'], ['tortilla'], { x: 'low', shelf: { pantry: 7, fridge: 21, freezer: 180 } })
add('All-purpose flour', 'Wheat flour, white, all-purpose, enriched, bleached', 'grains', ['gluten', 'wheat'], ['flour', 'plain flour', 'white flour', 'wheat flour', 'strong white flour', 'bread flour', 'strong flour', 'strong white bread flour'])
add('Rice flour', 'Rice flour, white', 'grains', [], ['flour'])
add('Quinoa', 'Quinoa, uncooked', 'grains', [], [])
add('Cornmeal', 'Cornmeal, whole-grain, yellow', 'grains', ['corn'], ['polenta'])
add('Couscous', 'Couscous, dry', 'grains', ['gluten', 'wheat'], [])
add('Potato', 'Potatoes, flesh and skin, raw', 'produce', [], ['potatoes'], { shelf: { pantry: 30, fridge: 30 } })
add('Sweet potato', 'Sweet potato, raw, unprepared', 'produce', [], ['yam'], { shelf: { pantry: 21, fridge: 21 } })
// Legumes
add('Lentils', 'Lentils, raw', 'legumes', ['legumes', 'high-fodmap'], ['brown lentils', 'green lentils', 'puy lentils', 'red lentils'])
add('Black beans', 'Beans, black, mature seeds, raw', 'legumes', ['legumes', 'high-fodmap'], ['beans'])
add('Chickpeas', 'Chickpeas (garbanzo beans, bengal gram), mature seeds, raw', 'legumes', ['legumes', 'high-fodmap'], ['garbanzo'])
add('Kidney beans', 'Beans, kidney, all types, mature seeds, raw', 'legumes', ['legumes', 'high-fodmap'], ['beans'])
add('Firm tofu', 'Tofu, raw, firm, prepared with calcium sulfate', 'legumes', ['soy'], [], { shelf: { fridge: 7, freezer: 150 } })
add('Tempeh', 'Tempeh', 'legumes', ['soy'], [], { shelf: { fridge: 10, freezer: 180 } })
add('Peanuts', 'Peanuts, all types, raw', 'nuts-seeds', ['peanut', 'legumes'], [])
add('Peanut butter', 'Peanut butter, smooth style, with salt', 'nuts-seeds', ['peanut', 'legumes'], [])
// Nuts & seeds
add('Almonds', 'Nuts, almonds', 'nuts-seeds', ['tree-nut'], ['flaked almonds', 'ground almonds', 'almond flakes'], { x: 'butter+milk+paste+oil+flour+blanched+dry roasted+oil roasted' })
add('Walnuts', 'Nuts, walnuts, english', 'nuts-seeds', ['tree-nut'], [])
add('Cashews', 'Nuts, cashew nuts, raw', 'nuts-seeds', ['tree-nut', 'high-fodmap'], [])
add('Almond butter', 'Nuts, almond butter, plain, without salt added', 'nuts-seeds', ['tree-nut'], [])
add('Chia seeds', 'Seeds, chia seeds, dried', 'nuts-seeds', [], [])
add('Flaxseed', 'Seeds, flaxseed', 'nuts-seeds', [], ['linseed'])
add('Sunflower seeds', 'Seeds, sunflower seed kernels, dried', 'nuts-seeds', [], [])
add('Tahini', 'Seeds, sesame butter, tahini', 'nuts-seeds', ['sesame'], ['sesame paste'])
// Vegetables
add('Carrot', 'Carrots, raw', 'produce', [], ['carrots'], { shelf: { fridge: 21, freezer: 240 } })
add('Onion', 'Onions, raw', 'produce', ['onion-garlic', 'high-fodmap'], ['onions'], { shelf: { pantry: 30, fridge: 60 } })
add('Green onion', 'Onions, spring or scallions (includes tops and bulb), raw', 'produce', ['onion-garlic'], ['scallion', 'spring onion'], { shelf: { fridge: 10 } })
add('Garlic', 'Garlic, raw', 'produce', ['onion-garlic', 'high-fodmap'], ['garlic clove', 'clove garlic', 'cloves garlic'], { shelf: { pantry: 60, fridge: 90 } })
add('Tomato', 'Tomatoes, red, ripe, raw, year round average', 'produce', ['nightshade'], ['tomatoes'])
add('Bell pepper', 'Peppers, sweet, red, raw', 'produce', ['nightshade'], ['pepper', 'capsicum', 'red pepper', 'green pepper', 'yellow pepper', 'orange pepper', 'red bell pepper', 'green bell pepper', 'yellow bell pepper'])
add('Cucumber', 'Cucumber, with peel, raw', 'produce', [], [])
add('Zucchini', 'Squash, summer, zucchini, includes skin, raw', 'produce', [], ['courgette'])
add('Spinach', 'Spinach, raw', 'produce', [], [], { shelf: { fridge: 5, freezer: 240 } })
add('Kale', 'Kale, raw', 'produce', ['cruciferous'], [], { shelf: { fridge: 7, freezer: 240 } })
add('Romaine lettuce', 'Lettuce, cos or romaine, raw', 'produce', [], ['lettuce'], { shelf: { fridge: 7 } })
add('Broccoli', 'Broccoli, raw', 'produce', ['cruciferous'], [], { shelf: { fridge: 7, freezer: 240 } })
add('Cauliflower', 'Cauliflower, raw', 'produce', ['cruciferous', 'high-fodmap'], [])
add('Cabbage', 'Cabbage, raw', 'produce', ['cruciferous'], ['savoy cabbage', 'white cabbage'], { shelf: { fridge: 21 } })
add('Mushrooms', 'Mushrooms, white, raw', 'produce', ['high-fodmap'], ['button mushrooms', 'chestnut mushrooms', 'cremini', 'chestnut mushroom', 'button mushroom'], { shelf: { fridge: 5 } })
add('Celery', 'Celery, raw', 'produce', [], [], { shelf: { fridge: 14 } })
add('Green beans', 'Beans, snap, green, raw', 'produce', [], ['string beans'])
add('Green peas', 'Peas, green, raw', 'produce', ['high-fodmap'], ['peas'])
add('Sweet corn', 'Corn, sweet, yellow, raw', 'produce', ['corn', 'high-fodmap'], ['corn', 'sweetcorn'], { shelf: { fridge: 5, freezer: 240 } })
add('Butternut squash', 'Squash, winter, butternut, raw', 'produce', [], ['squash'], { shelf: { pantry: 60, fridge: 14 } })
add('Avocado', 'Avocados, raw, all commercial varieties', 'produce', [], [], { shelf: { pantry: 4, fridge: 7 } })
add('Asparagus', 'Asparagus, raw', 'produce', ['high-fodmap'], [])
add('Eggplant', 'Eggplant, raw', 'produce', ['nightshade'], ['aubergine', 'egg plant'])
add('Ginger root', 'Ginger root, raw', 'produce', [], ['ginger'], { shelf: { fridge: 21, freezer: 180 } })
add('Beets', 'Beets, raw', 'produce', [], ['beetroot'], { shelf: { fridge: 21 } })
// Fruit
add('Banana', 'Bananas, raw', 'fruit', [], ['bananas'], { shelf: { pantry: 5, fridge: 7, freezer: 180 } })
add('Apple', 'Apples, raw, with skin', 'fruit', ['high-fodmap'], ['apples'], { shelf: { fridge: 28, pantry: 7 } })
add('Blueberries', 'Blueberries, raw', 'fruit', [], [], { shelf: { fridge: 7, freezer: 365 } })
add('Strawberries', 'Strawberries, raw', 'fruit', [], [], { shelf: { fridge: 5, freezer: 365 } })
add('Orange', 'Oranges, raw, all commercial varieties', 'fruit', [], ['oranges'], { shelf: { fridge: 21, pantry: 7 } })
add('Grapes', 'Grapes, red or green', 'fruit', [], [], { shelf: { fridge: 7 } })
add('Pineapple', 'Pineapple, raw, all varieties', 'fruit', [], [], { shelf: { fridge: 5, pantry: 3 } })
add('Mango', 'Mangos, raw', 'fruit', ['high-fodmap'], [], { shelf: { fridge: 5, pantry: 4 } })
add('Pear', 'Pears, raw', 'fruit', ['high-fodmap'], ['pears'], { shelf: { fridge: 10, pantry: 5 } })
add('Peach', 'Peaches, yellow, raw', 'fruit', ['high-fodmap'], ['peaches'], { shelf: { fridge: 5, pantry: 3 } })
add('Watermelon', 'Watermelon, raw', 'fruit', ['high-fodmap'], [], { shelf: { fridge: 7, pantry: 7 } })
add('Lemon', 'Lemons, raw, without peel', 'fruit', [], [], { shelf: { fridge: 28, pantry: 7 } })
add('Lime', 'Limes, raw', 'fruit', [], [], { shelf: { fridge: 28, pantry: 7 } })
add('Raisins', 'Raisins, dark, seedless', 'fruit', [], ['sultanas', 'golden raisins', 'mixed dried fruit', 'dried fruit'], { shelf: { pantry: 180, fridge: 365 } })
add('Dates', 'Dates, deglet noor', 'fruit', ['high-fodmap'], [], { shelf: { pantry: 180, fridge: 365 } })
// Fats & oils
add('Olive oil', 'Oil, olive, salad or cooking', 'fats-oils', [], ['oil'])
add('Canola oil', 'Oil, canola', 'fats-oils', [], ['oil', 'vegetable oil', 'frying oil', 'frying vegetable oil', 'cooking oil', 'rapeseed oil'])
add('Coconut oil', 'Oil, coconut', 'fats-oils', [], ['oil'])
add('Mayonnaise', 'Salad dressing, mayonnaise, regular', 'pantry', ['egg'], ['mayo'], { x: 'light+reduced+low+fat free+soybean+imitation', shelf: { fridge: 90 } })
// Pantry
add('Sugar', 'Sugars, granulated', 'pantry', [], ['caster sugar', 'icing sugar', 'powdered sugar', 'confectioners sugar', 'vanilla sugar', 'golden caster sugar', 'golden sugar'], { shelf: { pantry: 1825 } })
add('Honey', 'Honey', 'pantry', ['high-fodmap'], ['clear honey', 'runny honey'], { shelf: { pantry: 1825 } })
add('Maple syrup', 'Syrups, maple', 'pantry', [], [], { shelf: { pantry: 730, fridge: 730 } })
add('Soy sauce', 'Soy sauce made from soy and wheat (shoyu)', 'pantry', ['soy', 'gluten', 'wheat'], ['shoyu'], { shelf: { pantry: 730, fridge: 730 } })
add('Tamari', 'Soy sauce made from soy (tamari)', 'pantry', ['soy'], ['gluten-free soy sauce'], { shelf: { pantry: 730, fridge: 730 } })
add('Chicken broth', 'Soup, chicken broth, ready-to-serve', 'pantry', [], ['stock', 'chicken stock'], { shelf: { pantry: 540, fridge: 5, freezer: 180 } })
add('Canned tomatoes', 'Tomatoes, red, ripe, canned, packed in tomato juice', 'pantry', ['nightshade'], ['tinned tomatoes', 'chopped tomatoes', 'tinned chopped tomatoes', 'canned chopped tomatoes'], { shelf: { pantry: 540, fridge: 5 } })
add('Tomato sauce', 'Tomato products, canned, sauce', 'pantry', ['nightshade'], ['marinara', 'pasta sauce', 'passata', 'tomato passata', 'sieved tomatoes'], { x: 'spanish+mushroom+onions+herbs', shelf: { pantry: 540, fridge: 5 } })
add('Tomato paste', 'Tomato products, canned, paste, without salt added', 'pantry', ['nightshade'], ['tomato puree', 'tomato purée'], { shelf: { pantry: 540, fridge: 7 } })
add('Apple cider vinegar', 'Vinegar, cider', 'pantry', [], ['vinegar', 'white vinegar', 'white wine vinegar', 'red wine vinegar', 'rice vinegar', 'wine vinegar', 'distilled vinegar', 'sherry vinegar'], { shelf: { pantry: 1825 } })
add('Salt', 'Salt, table', 'pantry', [], ['celery salt'], { shelf: { pantry: 3650 } })
add('Yellow mustard', 'Mustard, prepared, yellow', 'pantry', [], ['mustard', 'dijon mustard', 'english mustard', 'wholegrain mustard'], { shelf: { pantry: 365, fridge: 365 } })
add('Ketchup', 'Catsup', 'pantry', ['nightshade'], ['catsup', 'tomato ketchup'], { shelf: { pantry: 365, fridge: 180 } })
// Spices & herbs
add('Black pepper', 'Spices, pepper, black', 'spices-herbs', [], ['peppercorns', 'black peppercorns'])
add('Cumin', 'Spices, cumin seed', 'spices-herbs', [], ['cumin seeds', 'ground cumin'])
add('Paprika', 'Spices, paprika', 'spices-herbs', ['nightshade'], [])
add('Turmeric', 'Spices, turmeric, ground', 'spices-herbs', [], [])
add('Cinnamon', 'Spices, cinnamon, ground', 'spices-herbs', [], ['cinnamon stick', 'cinnamon sticks', 'ground cinnamon'])
add('Oregano (dried)', 'Spices, oregano, dried', 'spices-herbs', [], ['oregano'])
add('Basil (dried)', 'Spices, basil, dried', 'spices-herbs', [], [])
add('Garlic powder', 'Spices, garlic powder', 'spices-herbs', ['onion-garlic', 'high-fodmap'], [])
add('Onion powder', 'Spices, onion powder', 'spices-herbs', ['onion-garlic', 'high-fodmap'], [])
add('Chili powder', 'Spices, chili powder', 'spices-herbs', ['nightshade', 'spicy'], ['chilli powder'])
add('Cayenne pepper', 'Spices, pepper, red or cayenne', 'spices-herbs', ['nightshade', 'spicy'], ['chili flakes', 'chilli flakes', 'red pepper flakes', 'crushed red pepper'])
add('Ground ginger', 'Spices, ginger, ground', 'spices-herbs', [], [])
add('Parsley', 'Parsley, fresh', 'spices-herbs', [], [], { shelf: { fridge: 10 } })
add('Cilantro', 'Coriander (cilantro) leaves, raw', 'spices-herbs', [], ['coriander'], { shelf: { fridge: 10 } })
add('Basil (fresh)', 'Basil, fresh', 'spices-herbs', [], ['basil', 'basil leaves'], { shelf: { fridge: 7 } })
add('Thyme (fresh)', 'Thyme, fresh', 'spices-herbs', [], ['thyme'], { shelf: { fridge: 14 } })
add('Rosemary (fresh)', 'Rosemary, fresh', 'spices-herbs', [], ['rosemary'], { shelf: { fridge: 14 } })

// ---- second batch: more everyday staples ----
// Fruit
add('Raspberries', 'Raspberries, raw', 'fruit', [], [], { shelf: { fridge: 4, freezer: 365 } })
add('Blackberries', 'Blackberries, raw', 'fruit', ['high-fodmap'], [], { shelf: { fridge: 4, freezer: 365 } })
add('Cherries', 'Cherries, sweet, raw', 'fruit', ['high-fodmap'], [], { shelf: { fridge: 7, freezer: 365 } })
add('Kiwi', 'Kiwifruit, green, raw', 'fruit', [], ['kiwifruit'], { shelf: { fridge: 21, pantry: 5 } })
add('Cantaloupe', 'Melons, cantaloupe, raw', 'fruit', [], ['melon', 'rockmelon'], { shelf: { fridge: 5, pantry: 3 } })
add('Honeydew melon', 'Melons, honeydew, raw', 'fruit', [], ['melon'], { shelf: { fridge: 5, pantry: 3 } })
add('Grapefruit', 'Grapefruit, raw, pink and red', 'fruit', [], [], { shelf: { fridge: 21, pantry: 7 } })
add('Mandarin', 'Tangerines, (mandarin oranges), raw', 'fruit', [], ['tangerine', 'clementine'], { shelf: { fridge: 21, pantry: 7 } })
add('Plums', 'Plums, raw', 'fruit', ['high-fodmap'], ['plum'], { shelf: { fridge: 5, pantry: 3 } })
add('Apricots', 'Apricots, raw', 'fruit', ['high-fodmap'], ['apricot'], { shelf: { fridge: 5, pantry: 3 } })
add('Pomegranate', 'Pomegranates, raw', 'fruit', [], [], { shelf: { fridge: 28, pantry: 14 } })
add('Papaya', 'Papayas, raw', 'fruit', [], [], { shelf: { fridge: 5, pantry: 3 } })
add('Figs', 'Figs, raw', 'fruit', ['high-fodmap'], [], { shelf: { fridge: 4, pantry: 2 } })
add('Cranberries', 'Cranberries, raw', 'fruit', [], [], { shelf: { fridge: 28, freezer: 365 } })
// Vegetables
add('Brussels sprouts', 'Brussels sprouts, raw', 'produce', ['cruciferous', 'high-fodmap'], [], { shelf: { fridge: 7, freezer: 240 } })
add('Bok choy', 'Cabbage, chinese (pak-choi), raw', 'produce', ['cruciferous'], ['pak choi'], { shelf: { fridge: 5 } })
add('Arugula', 'Arugula, raw', 'produce', ['cruciferous'], ['rocket'], { shelf: { fridge: 5 } })
add('Radish', 'Radishes, raw', 'produce', ['cruciferous'], ['radishes'], { shelf: { fridge: 14 } })
add('Leek', 'Leeks, (bulb and lower leaf-portion), raw', 'produce', ['onion-garlic', 'high-fodmap'], ['leeks'], { shelf: { fridge: 14 } })
add('Shallot', 'Shallots, raw', 'produce', ['onion-garlic', 'high-fodmap'], ['shallots'], { shelf: { pantry: 30, fridge: 60 } })
add('Jalapeno', 'Peppers, jalapeno, raw', 'produce', ['nightshade', 'spicy'], ['jalapeño', 'chili pepper'], { shelf: { fridge: 10, freezer: 240 } })
add('Pumpkin', 'Pumpkin, raw', 'produce', [], [], { shelf: { pantry: 60, fridge: 14 } })
add('Spaghetti squash', 'Squash, winter, spaghetti, raw', 'produce', [], ['squash'], { shelf: { pantry: 60, fridge: 14 } })
add('Parsnip', 'Parsnips, raw', 'produce', [], ['parsnips'], { shelf: { fridge: 21 } })
add('Okra', 'Okra, raw', 'produce', [], [], { shelf: { fridge: 4, freezer: 240 } })
add('Snap peas', 'Peas, edible-podded, raw', 'produce', ['high-fodmap'], ['snow peas', 'sugar snap peas'], { shelf: { fridge: 5, freezer: 240 } })
add('Fennel', 'Fennel, bulb, raw', 'produce', [], [], { shelf: { fridge: 7 } })
add('Artichoke', 'Artichokes, (globe or french), raw', 'produce', ['high-fodmap'], [], { shelf: { fridge: 5 } })
// Meat & seafood
add('Chicken drumstick', 'Chicken, broilers or fryers, dark meat, drumstick, meat only, raw', 'meat', [], ['chicken'])
add('Ground pork', 'Pork, ground, 84% lean / 16% fat, raw', 'meat', [], ['pork', 'mince', 'pork mince', 'minced pork'])
add('Pork chop', 'Pork, fresh, loin, center loin (chops), bone-in, separable lean only, raw', 'meat', [], ['pork'])
add('Ground lamb', 'Lamb, ground, raw', 'meat', [], ['lamb', 'mince', 'lamb mince', 'minced lamb'])
add('Egg whites', 'Egg, white, raw, fresh', 'dairy-eggs', ['egg'], ['egg white'], { shelf: { fridge: 5, freezer: 365 } })
add('Haddock', 'Fish, haddock, raw', 'seafood', ['fish'], [])
add('Trout', 'Fish, trout, rainbow, farmed, raw', 'seafood', ['fish'], [])
add('Sardines', 'Fish, sardine, Atlantic, canned in oil, drained solids with bone', 'seafood', ['fish'], [], { shelf: { pantry: 1095, fridge: 3 } })
add('Scallops', 'Mollusks, scallop, mixed species, raw', 'seafood', ['shellfish'], [])
add('Crab', 'Crustaceans, crab, blue, raw', 'seafood', ['shellfish'], [])
// Dairy
add('Ricotta', 'Cheese, ricotta, whole milk', 'dairy-eggs', ['dairy', 'lactose'], ['cheese'], { shelf: { fridge: 7, freezer: 60 } })
add('Goat cheese', 'Cheese, goat, soft type', 'dairy-eggs', ['dairy'], ['chevre', 'cheese'], { shelf: { fridge: 14 } })
add('Half and half', '', 'dairy-eggs', ['dairy', 'lactose'], ['cream', 'single cream'], { n: [131, 3.1], shelf: { fridge: 10 } })
add('Buttermilk', 'Milk, buttermilk, fluid, cultured, lowfat', 'dairy-eggs', ['dairy', 'lactose'], ['milk'], { shelf: { fridge: 14, freezer: 90 } })
add('Coconut milk (canned)', 'Nuts, coconut milk, canned', 'pantry', [], ['milk'], { shelf: { pantry: 730, fridge: 5 } })
// Grains
add('Whole wheat pasta', 'Pasta, whole-wheat, dry', 'grains', ['gluten', 'wheat'], ['spaghetti', 'noodles'])
add('Pearl barley', 'Barley, pearled, raw', 'grains', ['gluten'], ['barley'])
add('Buckwheat', 'Buckwheat groats, roasted, dry', 'grains', [], ['kasha'])
add('Millet', 'Millet, raw', 'grains', [], [])
add('Breadcrumbs', 'Bread, crumbs, dry, grated, plain', 'grains', ['gluten', 'wheat'], ['panko', 'bread crumbs', 'breadcrumb'])
add('Pita bread', 'Bread, pita, white, enriched', 'grains', ['gluten', 'wheat'], ['pita'], { shelf: { pantry: 5, fridge: 10, freezer: 90 } })
add('Rice cakes', 'Snacks, rice cakes, brown rice, plain, unsalted', 'grains', [], [])
add('Cornstarch', 'Cornstarch', 'pantry', ['corn'], ['corn flour'], { shelf: { pantry: 1825 } })
// Legumes
add('Pinto beans', 'Beans, pinto, mature seeds, raw', 'legumes', ['legumes', 'high-fodmap'], ['beans'])
add('White beans', 'Beans, white, mature seeds, raw', 'legumes', ['legumes', 'high-fodmap'], ['cannellini', 'cannellini beans', 'navy beans', 'haricot beans', 'beans'])
add('Split peas', '', 'legumes', ['legumes', 'high-fodmap'], [], { n: [341, 24.6] })
add('Edamame', 'Edamame, frozen, unprepared', 'legumes', ['soy', 'legumes'], [], { shelf: { freezer: 240, fridge: 3 } })
add('Hummus', 'Hummus, commercial', 'pantry', ['legumes', 'sesame', 'high-fodmap'], [], { shelf: { fridge: 7, freezer: 90 } })
// Nuts & seeds
add('Pistachios', 'Nuts, pistachio nuts, raw', 'nuts-seeds', ['tree-nut', 'high-fodmap'], [])
add('Pecans', 'Nuts, pecans', 'nuts-seeds', ['tree-nut'], ['pecan nuts', 'pecan'], { x: 'oil+roasted+coated+candied' })
add('Hazelnuts', 'Nuts, hazelnuts or filberts', 'nuts-seeds', ['tree-nut'], ['filberts'], { x: 'blanched+dry roasted+oil roasted' })
add('Pumpkin seeds', 'Seeds, pumpkin and squash seed kernels, dried', 'nuts-seeds', [], ['pepitas'])
add('Sesame seeds', 'Seeds, sesame seeds, whole, dried', 'nuts-seeds', ['sesame'], [])
add('Hemp seeds', 'Seeds, hemp seed, hulled', 'nuts-seeds', [], [])
// Pantry
add('Sesame oil', 'Oil, sesame, salad or cooking', 'fats-oils', ['sesame'], ['oil', 'sesame seed oil'])
add('Avocado oil', 'Oil, avocado', 'fats-oils', [], ['oil'])
add('Brown sugar', 'Sugars, brown', 'pantry', [], ['muscovado sugar', 'dark brown sugar', 'light brown sugar', 'soft brown sugar', 'demerara sugar', 'dark brown soft sugar', 'light brown soft sugar'], { shelf: { pantry: 1825 } })
add('Cocoa powder', 'Cocoa, dry powder, unsweetened', 'pantry', [], ['cacao'], { shelf: { pantry: 730 } })
add('Dark chocolate', 'Chocolate, dark, 70-85% cacao solids', 'pantry', [], [], { shelf: { pantry: 365 } })
add('Applesauce (unsweetened)', 'Applesauce, canned, unsweetened, without added ascorbic acid', 'pantry', ['high-fodmap'], [], { shelf: { pantry: 540, fridge: 7 } })
add('Jam', 'Jams and preserves', 'pantry', [], ['jelly', 'preserves', 'raspberry jam', 'strawberry jam', 'apricot jam', 'marmalade'], { shelf: { pantry: 365, fridge: 180 } })
add('Salsa', 'Salsa, ready-to-serve', 'pantry', ['nightshade', 'onion-garlic'], [], { shelf: { pantry: 540, fridge: 14 } })
add('Hot sauce', 'Sauce, hot chile, sriracha', 'pantry', ['spicy', 'nightshade'], ['sriracha', 'hotsauce', 'tabasco'], { shelf: { pantry: 730, fridge: 730 } })
add('Balsamic vinegar', 'Vinegar, balsamic', 'pantry', [], [], { shelf: { pantry: 1825 } })
add('Beef broth', 'Soup, beef broth or bouillon canned, ready-to-serve', 'pantry', [], ['beef stock'], { shelf: { pantry: 540, fridge: 5, freezer: 180 } })
// Spices & herbs
add('Nutmeg', 'Spices, nutmeg, ground', 'spices-herbs', [], [])
add('Sage (dried)', 'Spices, sage, ground', 'spices-herbs', [], ['sage'])
add('Dill (fresh)', 'Dill weed, fresh', 'spices-herbs', [], ['dill'], { shelf: { fridge: 7 } })
add('Mint (fresh)', 'Spearmint, fresh', 'spices-herbs', [], ['mint'], { shelf: { fridge: 7 } })
add('Vanilla extract', 'Vanilla extract', 'spices-herbs', [], ['vanilla'])
// Added after testing real recipes
add('Sun-dried tomatoes (in oil)', 'Tomatoes, sun-dried, packed in oil, drained', 'pantry', ['nightshade'], ['sundried tomatoes', 'sun dried tomatoes', 'sun-dried tomatoes'], { shelf: { pantry: 365, fridge: 30 } })
add('Sea bass', 'Fish, sea bass, mixed species, raw', 'seafood', ['fish'], ['seabass'])
// ---- third batch: staples that come up in real recipes ----
add('Baking powder', 'Leavening agents, baking powder, double-acting, straight phosphate', 'pantry', [], [], { shelf: { pantry: 365 } })
add('Baking soda', 'Leavening agents, baking soda', 'pantry', [], ['bicarbonate soda', 'bicarbonate of soda', 'bicarb'], { shelf: { pantry: 730 } })
add('Yeast', "Leavening agents, yeast, baker's, active dry", 'pantry', [], ['dried yeast', 'active dry yeast', 'fast action yeast', 'instant yeast'], { shelf: { pantry: 365, fridge: 730 } })
add('Self-raising flour', 'Wheat flour, white, all-purpose, self-rising, enriched', 'grains', ['gluten', 'wheat'], ['self-rising flour', 'self raising flour'])
add('Bay leaf', 'Spices, bay leaf', 'spices-herbs', [], ['bay leaves'])
add('Lemon juice', 'Lemon juice, raw', 'fruit', [], [], { shelf: { fridge: 5, freezer: 180 } })
add('Lime juice', 'Lime juice, raw', 'fruit', [], [], { shelf: { fridge: 5, freezer: 180 } })
add('Fish sauce', 'Sauce, fish, ready-to-serve', 'pantry', ['fish'], [], { shelf: { pantry: 1095, fridge: 1095 } })
add('Worcestershire sauce', 'Sauce, worcestershire', 'pantry', ['fish'], ['worcester sauce'], { shelf: { pantry: 1095, fridge: 1095 } })
add('Egg yolks', 'Egg, yolk, raw, fresh', 'dairy-eggs', ['egg'], ['egg yolk'], { shelf: { fridge: 4, freezer: 365 } })
add('Allspice', 'Spices, allspice, ground', 'spices-herbs', [], ['ground allspice', 'pimento'])
add('Cardamom', 'Spices, cardamom', 'spices-herbs', [], ['cardamom pods', 'ground cardamom'])
add('Saffron', 'Spices, saffron', 'spices-herbs', [], [])
add('Curry powder', 'Spices, curry powder', 'spices-herbs', [], [])
add('Cloves', 'Spices, cloves, ground', 'spices-herbs', [], ['ground cloves', 'whole cloves'])
add('Coriander seed', 'Spices, coriander seed', 'spices-herbs', [], ['coriander seeds', 'ground coriander'])
add('Mustard seed', 'Spices, mustard seed, ground', 'spices-herbs', [], ['mustard seeds', 'mustard powder'])
add('Fennel seed', 'Spices, fennel seed', 'spices-herbs', [], ['fennel seeds'])
add('White pepper', 'Spices, pepper, white', 'spices-herbs', [], [])
add('Chives', 'Chives, raw', 'spices-herbs', ['onion-garlic'], [], { shelf: { fridge: 7, freezer: 180 } })
add('Chili pepper (fresh)', 'Peppers, hot chili, red, raw', 'produce', ['nightshade', 'spicy'], ['chilli', 'chili', 'red chilli', 'green chilli', 'red chili', 'green chili', 'chilli pepper', 'chili pepper', 'scotch bonnet', 'bird eye chilli'], { shelf: { fridge: 10, freezer: 240 } })
add('Sunflower oil', 'Oil, sunflower, linoleic (less than 60%)', 'fats-oils', [], ['oil'])
add('Wine', 'Alcoholic beverage, wine, table, all', 'pantry', ['alcohol'], ['white wine', 'red wine', 'dry white wine', 'dry red wine', 'dry sherry', 'sherry', 'port', 'madeira', 'marsala'], { shelf: { pantry: 365, fridge: 5 } })
add('Chorizo', 'Sausage, pork, chorizo, link or ground, raw', 'meat', [], ['chorizo sausage'])
add('Pork sausages', 'Pork sausage, link/patty, unprepared', 'meat', ['gluten'], ['sausage', 'sausages', 'pork sausage'])
add('Puff pastry', 'Puff pastry, frozen, ready-to-bake', 'grains', ['gluten', 'wheat'], [], { shelf: { freezer: 180, fridge: 3 } })
add('Condensed milk', 'Milk, canned, condensed, sweetened', 'dairy-eggs', ['dairy', 'lactose'], ['sweetened condensed milk'], { shelf: { pantry: 540, fridge: 5 } })
add('Baguette', 'Bread, french or vienna (includes sourdough)', 'grains', ['gluten', 'wheat'], ['french bread', 'french stick'], { shelf: { pantry: 2, fridge: 5, freezer: 90 } })
add('Bouillon cube', 'Soup, chicken broth cubes, dry', 'pantry', [], ['stock cube', 'chicken stock cube', 'beef stock cube', 'vegetable stock cube', 'stock cubes'], { shelf: { pantry: 730 } })
add('Gruyere', 'Cheese, gruyere', 'dairy-eggs', ['dairy'], ['gruyère'], { shelf: { fridge: 28, freezer: 180 } })
add('Desiccated coconut', 'Nuts, coconut meat, dried (desiccated), not sweetened', 'nuts-seeds', [], ['coconut', 'shredded coconut', 'coconut flakes', 'dried coconut'])
add('Vegetable broth', 'Soup, vegetable broth, ready to serve', 'pantry', [], ['vegetable stock', 'veg stock'], { shelf: { pantry: 540, fridge: 5, freezer: 180 } })
add('Olives', 'Olives, ripe, canned (small-extra large)', 'pantry', [], ['olive', 'green olives', 'black olives', 'kalamata olives'], { shelf: { pantry: 730, fridge: 14 } })
add('Ham', 'Pork, cured, ham, boneless, regular (approximately 11% fat), roasted', 'meat', [], ['gammon', 'cooked ham'], { shelf: { fridge: 5, freezer: 60 } })
// Canned or cooked beans weigh and count very differently from dry ones: a 400 g tin is about 1/3 the calories of 400 g dry.
add('Chickpeas (canned)', 'Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained solids', 'legumes', ['legumes', 'high-fodmap'], ['canned chickpeas', 'tinned chickpeas'], { shelf: { pantry: 1095, fridge: 3 } })
add('Black beans (canned)', 'Beans, black turtle, mature seeds, canned', 'legumes', ['legumes', 'high-fodmap'], ['canned black beans', 'tinned black beans'], { shelf: { pantry: 1095, fridge: 3 } })
add('Kidney beans (canned)', 'Beans, kidney, red, mature seeds, canned, drained solids', 'legumes', ['legumes', 'high-fodmap'], ['canned kidney beans', 'tinned kidney beans'], { shelf: { pantry: 1095, fridge: 3 } })
add('White beans (canned)', 'Beans, white, mature seeds, canned', 'legumes', ['legumes', 'high-fodmap'], ['canned white beans', 'canned cannellini beans', 'tinned cannellini beans'], { shelf: { pantry: 1095, fridge: 3 } })
add('Pinto beans (canned)', 'Beans, pinto, canned, drained solids', 'legumes', ['legumes', 'high-fodmap'], ['canned pinto beans'], { shelf: { pantry: 1095, fridge: 3 } })
add('Lentils (cooked)', 'Lentils, mature seeds, cooked, boiled, without salt', 'legumes', ['legumes', 'high-fodmap'], ['cooked lentils', 'canned lentils'], { shelf: { fridge: 5, freezer: 180, pantry: 1 } })
add('Pecorino', 'Cheese, romano', 'dairy-eggs', ['dairy'], ['pecorino romano', 'romano'], { shelf: { fridge: 60, freezer: 270 } })
add('Gouda', 'Cheese, gouda', 'dairy-eggs', ['dairy'], [], { shelf: { fridge: 28, freezer: 180 } })
// ---- fourth batch: everyday western kitchen items that were blocking familiar recipes ----
add('Molasses', 'Molasses', 'pantry', [], ['black treacle', 'treacle', 'blackstrap molasses'], { shelf: { pantry: 730 } })
add('Digestive biscuits', 'Cookies, graham crackers, plain or honey (includes cinnamon)', 'grains', ['gluten', 'wheat'], ['digestives', 'graham crackers', 'digestive biscuit'], { shelf: { pantry: 120 } })
add('Butter beans (canned)', 'Lima beans, large, mature seeds, canned', 'legumes', ['legumes', 'high-fodmap'], ['butter beans', 'tinned butter beans', 'canned butter beans', 'lima beans'], { shelf: { pantry: 1095, fridge: 3 } })
add('Beef brisket', 'Beef, brisket, whole, separable lean only, all grades, raw', 'meat', [], ['brisket'])
add('Pork shoulder', 'Pork, fresh, shoulder, whole, separable lean and fat, raw', 'meat', [], ['pork butt', 'pulled pork', 'pork neck'])
add('Lamb leg', 'Lamb, leg, shank half, separable lean and fat+raw', 'meat', [], ['leg of lamb', 'lamb shoulder', 'lamb chops', 'lamb steak', 'diced lamb', 'lamb cubes', 'lamb neck'])
add('Chicken leg', 'Chicken, broilers or fryers, leg, meat only, raw', 'meat', [], ['chicken legs', 'chicken leg'])
add('Swede', 'Rutabagas, raw', 'produce', [], ['rutabaga', 'rutabagas'], { shelf: { fridge: 21, pantry: 14, freezer: 240 } })
add('Celeriac', 'Celeriac, raw', 'produce', [], [], { shelf: { fridge: 21, freezer: 240 } })
add('Turnip', 'Turnips, raw', 'produce', ['cruciferous'], ['turnips'], { shelf: { fridge: 21, freezer: 240 } })
add('Sauerkraut', 'Sauerkraut, canned, solids and liquids', 'produce', ['cruciferous', 'high-fodmap'], [], { shelf: { pantry: 540, fridge: 30 } })
add('Marjoram', 'Spices, marjoram, dried', 'spices-herbs', [], [])
add('Caraway seed', 'Spices, caraway seed', 'spices-herbs', [], ['caraway seeds', 'caraway'])
add('Star anise', 'Spices, anise seed', 'spices-herbs', [], ['aniseed', 'anise seed'])
add('Currants', 'Currants, zante, dried', 'fruit', [], ['dried currants'], { shelf: { pantry: 180, fridge: 365 } })
add('Brie', 'Cheese, brie', 'dairy-eggs', ['dairy'], ['camembert'], { shelf: { fridge: 21, freezer: 120 } })
add('Beer', 'Alcoholic beverage, beer, regular, all', 'pantry', ['alcohol', 'gluten'], ['lager', 'ale', 'stout'], { shelf: { pantry: 180, fridge: 3 } })
add('Spirits', 'Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof', 'pantry', ['alcohol'], ['brandy', 'rum', 'vodka', 'whisky', 'whiskey', 'gin', 'cognac', 'liqueur'], { shelf: { pantry: 1825 } })
add('Burger buns', 'Rolls, hamburger or hotdog, plain', 'grains', ['gluten', 'wheat'], ['hamburger buns', 'burger bun', 'bread rolls', 'rolls', 'buns', 'sesame seed burger buns'], { shelf: { pantry: 4, fridge: 7, freezer: 90 } })
add('Pine nuts', 'Nuts, pine nuts, dried', 'nuts-seeds', ['tree-nut'], ['pine kernels'])
add('Golden syrup', 'Syrups, corn, light', 'pantry', [], ['light corn syrup', 'corn syrup'], { shelf: { pantry: 1095 } })
add('Shortcrust pastry', 'Pie crust, deep dish, frozen, unbaked, made with enriched flour', 'grains', ['gluten', 'wheat'], ['pastry', 'pie crust', 'pie dough'], { shelf: { fridge: 5, freezer: 120 } })
add('Whole wheat flour', 'Wheat flour, whole-grain, soft wheat', 'grains', ['gluten', 'wheat'], ['wholemeal flour', 'whole wheat flour', 'wholewheat flour'])
add('Lard', '', 'fats-oils', [], ['goose fat', 'duck fat', 'beef dripping', 'dripping', 'suet'], { n: [902, 0], shelf: { pantry: 180, fridge: 365 } })
// Water has no calories but appears in many recipes (and "water" must not match "Watermelon")
add('Water', '', 'pantry', [], [], { n: [0, 0], shelf: { pantry: 3650, fridge: 3650 } })
// Oyster sauce usually contains oyster extract and soy sauce (which is usually brewed with wheat)
add('Oyster sauce', 'Sauce, oyster, ready-to-serve', 'pantry', ['shellfish', 'soy', 'gluten'], [], { shelf: { pantry: 730, fridge: 730 } })
// More fish and shellfish
add('Fresh tuna', 'Fish, tuna, fresh, yellowfin, raw', 'seafood', ['fish'], ['tuna steak', 'tuna steaks', 'yellowfin tuna', 'ahi'])
add('Mackerel', 'Fish, mackerel, Atlantic, raw', 'seafood', ['fish'], [])
add('Halibut', 'Fish, halibut, Atlantic and Pacific, raw', 'seafood', ['fish'], [])
add('Catfish', 'Fish, catfish, channel, farmed, raw', 'seafood', ['fish'], [])
add('Mahi-mahi', 'Fish, mahimahi, raw', 'seafood', ['fish'], ['mahi mahi', 'mahimahi', 'dolphinfish'])
add('Snapper', 'Fish, snapper, mixed species, raw', 'seafood', ['fish'], ['red snapper'])
add('Swordfish', 'Fish, swordfish, raw', 'seafood', ['fish'], [])
add('Herring', 'Fish, herring, Atlantic, raw', 'seafood', ['fish'], [])
add('Pollock', 'Fish, pollock, Atlantic, raw', 'seafood', ['fish'], ['pollack'])
add('Flounder or sole', 'Fish, flatfish (flounder and sole species), raw', 'seafood', ['fish'], ['flounder', 'sole', 'dover sole', 'lemon sole', 'plaice'])
add('Perch', 'Fish, perch, mixed species, raw', 'seafood', ['fish'], [])
add('Monkfish', 'Fish, monkfish, raw', 'seafood', ['fish'], [])
add('Anchovies', 'Fish, anchovy, european, canned in oil, drained solids', 'seafood', ['fish'], ['anchovy', 'anchovy fillets'], { shelf: { pantry: 730, fridge: 14 } })
add('Smoked salmon', 'Fish, salmon, chinook, smoked', 'seafood', ['fish'], ['lox'], { shelf: { fridge: 5, freezer: 60 } })
add('Canned salmon', 'Fish, salmon, pink, canned, drained solids', 'seafood', ['fish'], ['tinned salmon', 'pink salmon'], { shelf: { pantry: 1095, fridge: 3 } })
add('Mussels', 'Mollusks, mussel, blue, raw', 'seafood', ['shellfish'], [])
add('Oysters', 'Mollusks, oyster, Pacific, raw', 'seafood', ['shellfish'], ['oyster'])
add('Lobster', 'Crustaceans, lobster, northern, raw', 'seafood', ['shellfish'], [])
add('Clams', 'Mollusks, clam, mixed species, raw', 'seafood', ['shellfish'], ['clam'])
add('Squid', 'Mollusks, squid, mixed species, raw', 'seafood', ['shellfish'], ['calamari'])

// ---- USDA lookup ----
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}
function readCsv(file) {
  const lines = readFileSync(join(dir, file), 'utf8').split(/\r?\n/).filter(Boolean)
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map((l) => {
    const cells = parseCsvLine(l)
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]))
  })
}

const foods = readCsv('food.csv')
const byId = new Map(foods.map((f) => [f.fdc_id, f]))
const nutrients = new Map()
for (const r of readCsv('food_nutrient.csv')) {
  if (!byId.has(r.fdc_id)) continue
  if (r.nutrient_id !== '1008' && r.nutrient_id !== '1003') continue
  const e = nutrients.get(r.fdc_id) ?? {}
  if (r.nutrient_id === '1008') e.kcal = Number(r.amount)
  else e.protein = Number(r.amount)
  nutrients.set(r.fdc_id, e)
}

const out = []
const problems = []
for (const it of L) {
  let kcal, protein, usdaId, usdaName
  if (it.n) {
    ;[kcal, protein] = it.n
  } else {
    const musts = it.m.toLowerCase().split('+')
    const nots = (it.x ?? '').toLowerCase().split('+').filter(Boolean)
    const hits = foods
      .filter((f) => {
        const d = f.description.toLowerCase()
        const e = nutrients.get(f.fdc_id)
        return e?.kcal != null && e?.protein != null && musts.every((s) => d.includes(s)) && !nots.some((s) => d.includes(s))
      })
      .sort((a, b) => a.description.length - b.description.length)
    if (!hits.length) { problems.push(`NO MATCH: ${it.name} <- ${it.m}`); continue }
    const f = hits[0]
    ;({ kcal, protein } = nutrients.get(f.fdc_id))
    usdaId = Number(f.fdc_id)
    usdaName = f.description
  }
  out.push({
    name: it.name,
    aliases: it.aliases,
    category: it.cat,
    tags: it.tags,
    shelfLifeDays: it.shelf ?? SHELF[it.cat],
    kcalPer100g: Math.round(kcal),
    proteinPer100g: Math.round(protein * 10) / 10,
    sensitivity: 'safe',
    ...(usdaId ? { usdaId } : {}),
    ...(usdaName ? { _usda: usdaName } : {}),
  })
}

// ---- unit conversion data (approximate, typical values) ----
const PIECE = {
  Eggs: 50, 'Egg whites': 33, Banana: 118, Apple: 182, Orange: 131, Mandarin: 88, Pear: 178, Peach: 150, Kiwi: 69,
  Lemon: 58, Lime: 67, Avocado: 150, Plums: 66, Apricots: 35, Figs: 50, Strawberries: 12, Grapes: 5, Cherries: 8, Dates: 24,
  Potato: 213, 'Sweet potato': 130, Carrot: 61, Onion: 110, Garlic: 3, Shallot: 40, 'Green onion': 15, Tomato: 123,
  'Bell pepper': 119, Cucumber: 301, Zucchini: 196, Jalapeno: 14, Celery: 40, 'Chicken breast': 174,
  'Corn tortillas': 26, 'Flour tortillas': 45, 'White bread': 28, 'Whole wheat bread': 33, 'Pita bread': 60,
  Cinnamon: 3, Olives: 4, 'Bay leaf': 0.3, Eggplant: 450, Cabbage: 900, Bacon: 25, 'Ginger root': 15, Shrimp: 15, 'Chicken thigh': 90, Beets: 82, 'Romaine lettuce': 300, Lobster: 450, Sardines: 28, 'Pork chop': 150, Ham: 28, Mushrooms: 18, Broccoli: 300, Cauliflower: 600, Parsnip: 130, Leek: 90, Radish: 5, 'Egg yolks': 17, 'Chili pepper (fresh)': 15, 'Bouillon cube': 6, 'Pork sausages': 60,
}
const GRAMS_PER_ML = {
  'Olive oil': 0.92, 'Canola oil': 0.92, 'Coconut oil': 0.92, 'Avocado oil': 0.92, 'Sesame oil': 0.92,
  'Whole milk': 1.03, '2% milk': 1.03, 'Skim milk': 1.04, 'Lactose-free milk': 1.03, 'Almond milk (unsweetened)': 1,
  'Soy milk': 1.03, 'Oat milk': 1.03, Buttermilk: 1.03, 'Heavy cream': 0.99, 'Half and half': 1.01, 'Sour cream': 1,
  'Plain yogurt': 1.04, 'Greek yogurt (nonfat)': 1.06, 'Coconut milk (canned)': 0.97,
  Honey: 1.42, 'Maple syrup': 1.33, 'Soy sauce': 1.2, Tamari: 1.2, 'Chicken broth': 1, 'Beef broth': 1, 'Tomato sauce': 1.03,
  'Canned tomatoes': 1, 'Tomato paste': 1.1, 'Apple cider vinegar': 1.01, 'Balsamic vinegar': 1.01, Ketchup: 1.15,
  'Yellow mustard': 1.05, Mayonnaise: 0.95, 'Peanut butter': 1.08, 'Almond butter': 1.05, Tahini: 1.05, Hummus: 1,
  Salsa: 1.03, 'Hot sauce': 1, Water: 1, 'Oyster sauce': 1.2,
  'Lemon juice': 1.03, 'Lime juice': 1.03, 'Fish sauce': 1.2, 'Worcestershire sauce': 1.1, 'Baking powder': 0.93,
  'Baking soda': 0.93, 'Vegetable broth': 1, Yeast: 0.6, Wine: 0.99, 'Sunflower oil': 0.92, 'Condensed milk': 1.3, 'Self-raising flour': 0.53, 'Applesauce (unsweetened)': 1.05, Jam: 1.3, Butter: 0.96, Ghee: 0.91,
  // dry goods measured by the cup
  Sugar: 0.85, 'Brown sugar': 0.93, 'All-purpose flour': 0.53, 'Rice flour': 0.65, 'White rice': 0.78, 'Brown rice': 0.78,
  'Rolled oats': 0.38, Cornmeal: 0.63, Quinoa: 0.72, Couscous: 0.73, Lentils: 0.81, 'Black beans': 0.8, Chickpeas: 0.85,
  'Kidney beans': 0.78, Salt: 1.2, 'Cocoa powder': 0.36, Breadcrumbs: 0.45, Cornstarch: 0.54, Parmesan: 0.4,
  // leafy greens are very light
  Spinach: 0.13, Kale: 0.27, 'Romaine lettuce': 0.2, Arugula: 0.08, 'Basil (fresh)': 0.2,
}
for (const o of out) {
  if (PIECE[o.name] != null) o.gramsPerPiece = PIECE[o.name]
  if (GRAMS_PER_ML[o.name] != null) o.gramsPerMl = GRAMS_PER_ML[o.name]
}
for (const k of [...Object.keys(PIECE), ...Object.keys(GRAMS_PER_ML)]) {
  if (!out.some((o) => o.name === k)) problems.push(`UNKNOWN NAME in conversion table: ${k}`)
}

if (process.argv.includes('--report')) {
  for (const o of out) console.log(`${o.name.padEnd(28)} ${String(o.kcalPer100g).padStart(4)} kcal ${String(o.proteinPer100g).padStart(5)} g  <- ${o._usda ?? '(manual)'}`)
}
for (const o of out) delete o._usda
console.log(problems.join('\n') || 'All curated items matched.')

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'ingredients.seed.json')
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, JSON.stringify(out, null, 1))
console.log(`Wrote ${out.length} ingredients to ${dest}`)
