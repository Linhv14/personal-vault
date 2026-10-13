# Autofill

"Autofill and passkeys on websites" adds an icon to login forms, fills a saved
login on click, generates passwords in sign-up forms, offers to save what you
type, and handles passkeys (see [Passkeys](passkeys.md)). It is off by default,
because it is the one feature that runs code inside the pages you visit.

## Picking a login

Clicking into a login field opens the list of matching logins by itself when
there is something to offer: a matching login, a strong password for a sign-up
form, or a prompt to unlock 1PW. It stays closed when a page focuses the field
on load, and when nothing matches; the icon in the field opens it on demand.
Typing closes it, ↓ moves into it, Enter picks a login and Esc closes it.

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
`chrome.storage.session` for five minutes, keyed by tab. The page, or the next
page after the navigation, shows **Save** for a new login or **Update** when
the password differs from the saved one. Nothing is offered when it is already
saved, and a pending save is not carried to a different site. Locking the
vault discards it. If the vault is locked when **Save** is pressed, the banner
asks you to unlock first.

## Generating passwords

In a new-password field the menu offers **Use a strong password**: 20 random
characters from the same generator as the popup, filled into the password and
confirmation fields.
