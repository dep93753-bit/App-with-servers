# App-with-servers
## Automatic tests
GitHub runs browser tests on every pull request (see the **Tests** check). They open the app on a
desktop and a phone screen with Firebase and the AI turned off, so they never touch real data.
To run them yourself: `npm install`, then `npm test`.
