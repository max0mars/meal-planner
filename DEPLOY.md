# Putting the app on your phone

The camera features (barcode and receipt scanning) only work on a secure (`https://`) address, and installing the app to your home screen needs one too. Your computer's `localhost` is secure, but your phone cannot reach it. So the finished app has to be hosted somewhere. Free static hosting is enough.

**What goes online:** only the app's files (the same ones in the `dist` folder). **What stays on your phone:** all your data (pantry, recipes, plan, settings). Nothing you enter is uploaded. The app has no server and no account.

**Heads up:** the online address is a different "place" for your browser than `localhost`, so it starts empty. Use **Settings > Your data > Save a backup** on the old copy and **Restore from a backup** on the new one if you want to bring anything across.

## 1. Build the files

```
npm run build
```

This makes a `dist` folder.

## 2a. Easiest: Netlify drag and drop (no git needed)

1. Create a free account at netlify.com.
2. Open **Sites**, then drag the whole `dist` folder onto the "Drag and drop your site output folder here" area.
3. Netlify gives you an address like `https://something-random.netlify.app`. You can rename it under **Site configuration > Change site name**.
4. To update the app later, run `npm run build` again and drag the new `dist` folder onto the site's **Deploys** page.

## 2b. Alternative: GitHub Pages

1. Create a free GitHub account and a new repository.
2. Upload the **contents** of `dist` (not the folder itself) to the repository, on a branch called `gh-pages`, or to `main` with Pages pointed at it.
3. In the repository, open **Settings > Pages**, pick that branch and the root folder, and save.
4. Your address is `https://<your-username>.github.io/<repository-name>/`. The app already uses relative paths and hash links (`#/recipes`), so it works in that subfolder with nothing else to set up.

The repository is public by default on a free account. That only exposes the app's code and the starter recipes. It does not expose anything you type into the app.

## 3. Install on your phone

- **iPhone (Safari):** open the address, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the address, then the menu, then **Install app** (or **Add to Home screen**).

Open the app from the home screen icon after that. It works offline once it has loaded once.

## 4. Things to know

- **Updates:** the app updates itself the next time you open it with a connection. If something looks old, close it fully and reopen.
- **Your data and the browser:** clearing the browser's site data deletes your data. On iPhone, Safari may delete a website's stored data after about a week without using it in the browser. An app added to the home screen is not affected by that rule, so install it first, then enter your data. Save a backup now and then either way.
- **Barcode lookups:** when you scan a barcode, only the barcode number is sent, to Open Food Facts (a free food database), to find the product's name and nutrition. Nothing else leaves your phone, and no photo is uploaded.
- **Receipt scanning:** the photo is read on your phone and is never uploaded or saved.
