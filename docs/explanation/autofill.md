# Autofill

"Autofill and passkeys on websites" adds an icon to login forms, fills a saved
login on click, generates passwords in sign-up forms, offers to save what you
type, and handles passkeys (see [Passkeys](passkeys.md)). It is off by default,
because it is the one feature that runs code inside the pages you visit. Only
login items take part; cards, addresses and the other types are never offered
to a page.

## Picking a login

Clicking into a login field opens the list of matching logins by itself when
there is something to offer: a matching login, a strong password for a sign-up
form, or a prompt to unlock 7key. It stays closed when a page focuses the field
on load, and when nothing matches; the icon in the field opens it on demand.
Typing closes it, ↓ moves into it, Enter picks a login and Esc closes it.

The login used most recently on the site comes first, as it does for passkeys.
Each fill records `lastUsedAt` inside the encrypted item, at most once a minute,
so the order follows you to other devices. Recording it does not change the
item's modified date. In the popup, **Recent** sorts by whichever is later, the
last edit or the last use.

## What turning it on grants

Turning it on in Settings asks Chrome for access to `https://*/*` and
`http://*/*`. When the permission is granted, the service worker registers the
page script; when it is removed, from Settings or from Chrome's extension page,
the script is unregistered. Without the permission the extension does not
touch any page.

The script runs only in the top frame. Login forms inside iframes are left
alone: a framed form could belong to a different site than the address bar
shows.

## Where trust comes from

The page script is the untrusted half. It runs next to the site's own scripts
and can be lied to, so it decides nothing. The service worker decides, using
only what Chrome tells it:

- **The site is the one Chrome reports.** For each request, the service worker
  takes the domain from `sender.url`, the address of the frame that sent the
  message. A page cannot claim to be another site.
- **Only https,** except on `localhost`, where http is allowed for development.
- **Suggestions carry no secrets.** The menu receives titles and usernames.
  The password of a login is sent only when it is clicked, and only if that
  login matches the page's domain, even if the page somehow learns the id of
  another item.
- **Nothing happens without a real click.** Every action checks the event's
  `isTrusted` flag, so a script cannot click on the user's behalf. The icon,
  menu and banners live in a closed shadow root that page scripts cannot
  reach.

## Matching a page to a login

A login matches a page when their registrable domains are equal, so
`accounts.example.com` and `www.example.com` share logins. Two exceptions keep
unrelated sites apart:

- **Shared hosting.** On hosts where anyone can publish a subdomain, such as
  `github.io`, `pages.dev` or `vercel.app`, each subdomain is its own site:
  `alice.github.io` never sees `mallory.github.io`'s login.
- **IP addresses** match only themselves.

## Saving and updating

When a form with a password is submitted, the page script sends the username
and password to the service worker, which keeps them in
`chrome.storage.session`, keyed by tab. Nothing is shown yet: a submit only
says the password was sent, not that it was right.

The page script then waits for the sign-in to land. It asks only once no login
form has been on screen for a full second, either because the page navigated
to one without a password field or because a single-page app swapped the form
out. The capture is dropped, without asking, when:

- the site marks the password field `aria-invalid`;
- a login form is still, or again, on screen 10 seconds after the submit,
  which is what a rejected password looks like on most sites;
- the page that loads next is a login form again;
- nothing confirms it within a minute.

Revealing the password does not count as the form going away: the fields
captured at submit are tracked even when their type changes.

Once confirmed, the banner shows **Save** for a new login or **Update** when
the password differs from the saved one, and keeps being offered on that tab
for five minutes. Nothing is offered when it is already saved, and a pending
save is not carried to a different site. Locking the vault discards it. If the
vault is locked when **Save** is pressed, the banner asks you to unlock first.

## Generating passwords

In a new-password field the menu offers **Use a strong password**: 20 random
characters from the same generator as the popup, filled into the password and
confirmation fields. The menu opens by itself when such a field gets focus,
whether by click or Tab. A field counts as new when it says so
(`autocomplete="new-password"`), when the form has two password fields, when
its name, the form action or the address mentions signing up, or when the form
has a button such as "Create account" or "Sign up"; `current-password` always
means sign-in.

## 2FA codes

A code field (`autocomplete="one-time-code"`, or a short or numeric field named
like `otp`, `2fa` or "authentication code") gets the same 7key button, and its
menu lists the logins for the site that have a 2FA code. Picking one fills the
current code; six one-digit boxes are filled one digit each. The code is
computed in the extension with the clock offset measured at unlock.

## Saving 2FA while you set it up

On a page that talks about authenticators, two-factor or a QR code, 7key looks
for the setup secret: an `otpauth://` link or text, a setup key next to that
wording, or a QR code it can read with the browser's `BarcodeDetector` (in
images, canvases and inline SVG). A QR image served from another origin cannot
be read by the page script, so the extension fetches that image itself over
HTTPS, without cookies, only when it is an image under 512 KB.

It then offers **Save 2FA for {site}?**, naming the personal login it will add
the code to (the most recently used one for the site), or saying it will
replace a different code already there, or create a login when there is none.
It never writes into a team vault item. After saving it fills the current code
into the page's code field, so the site's "enter the code to confirm" step is
already done. A secret that is already saved is not offered again.

Reading QR codes needs `BarcodeDetector`, which Chrome ships on macOS, ChromeOS
and Android; elsewhere the link and setup-key paths still work, and the popup's
scan button remains.

## Replacing the browser's password manager

**Make 7key the password manager** in Settings asks for the optional `privacy`
permission and turns off the browser's own offer to save and fill passwords
(`privacy.services.passwordSavingEnabled`), so only 7key asks. Turning it off
restores the browser's setting and gives the permission back. Chrome, Edge,
Brave, Opera, Vivaldi and other Chromium browsers share this setting.

When a company policy or another extension controls it, 7key says so instead of
changing it, and offers to open the browser's own password settings
(`chrome://password-manager/settings`, `edge://settings/passwords`,
`brave://password-manager/settings` and so on). Passwords already saved in the
browser stay there; export them as CSV and import them into 7key.
