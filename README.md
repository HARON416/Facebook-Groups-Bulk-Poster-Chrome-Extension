# Postika

Postika is a browser-only Chrome extension for preparing and publishing posts
to Facebook Groups. No Postika account, sign-in, or remote Postika backend is
required. Posting is not limited by Postika quotas; Facebook's own limits,
policies, and Group rules still apply.

## Build

```bash
npm install
npm run build
```

The build writes extension bundles to `public/dist`. To package a Chrome Web
Store release, increment the version in `public/manifest.json`, build, then
package the contents of `public` so the manifest is at the ZIP root.

The side panel supports English, Spanish, and Arabic. It follows the browser
language on first launch, and the language picker saves later choices. Arabic
uses a right-to-left document direction. Run `npm run i18n:extract` after
changing localized messages to update the Wuchale catalogs in `src/locales`.

## Extension workflow

Create a post, choose Facebook Groups, review the queue, and start posting.
Postika operates through the Facebook account already signed in to Chrome.
Post text, images, loaded Groups, and selections are saved in Chrome extension
storage on the device so drafts can be restored. Content is sent directly to
Facebook only when you start a posting action.

The extension stores workflow preferences in Chrome extension storage too.
