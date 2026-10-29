# Murmur

A small social app: chat with friends, post updates, share 24-hour photo stories, and look at profiles.
Plain HTML, CSS and JavaScript on the front end, Firebase for accounts and data.

## Running it

The JavaScript uses ES modules, so opening `index.html` by double-clicking it will not work.
Serve the folder instead:

```
python -m http.server 8000
```

then open http://localhost:8000. On GitHub it runs as-is with GitHub Pages
(Settings > Pages > deploy from the `main` branch, root folder).

## Folder layout

```
index.html            the page (markup only)
manifest.json         install-to-home-screen settings
css/
  base.css            colors, buttons, forms, shared pieces
  auth-flows.css      log in, create account, forgot password
  splash.css          loading screen
  legal.css           terms, privacy, cookie notice
  app-layout.css      feed, friends, chats, menu, phone layout
js/
  main.js             the app (auth, feed, friends, chat, stories, profile)
  firebase-config.js  Firebase project settings
  legal-content.js    text of the Terms, Privacy and Cookie pages
assets/icon.svg       logo / favicon
archive/              the original single-file version, kept as a backup
```

CSS files load in the order listed in `index.html`. Keep that order, later files override earlier ones.

## Things to remember

- The Firebase keys in `firebase-config.js` are public by design. The Realtime Database
  rules in the Firebase console are what actually protect user data, so check them.
- Demo mode uses sample data and saves nothing. Real accounts use Firebase.
- Change `PRIVACY_CONTACT` in `js/legal-content.js` to a real email address before launch.

## Still to do

- Split `main.js` further (register wizard, chat, stories, profile each get their own file).
- Tests.
- Offline support.
