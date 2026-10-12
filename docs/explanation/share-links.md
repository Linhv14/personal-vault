# Share links

A share link hands one login to someone without an account, for a limited time
and a limited number of views, while the server stays unable to read it.

## How a link carries its own key

```
1. The sender picks an item, a lifetime, a view limit, and optionally
   recipients and a passphrase.
2. The extension draws a 32-byte share key and seals the chosen fields
   (title, site, username, password, note, 2FA secret) with AES-256-GCM.
3. It uploads the ciphertext. The Worker stores it under a random id and
   returns the id and a revoke token.
4. The link is   https://<worker>/s/<id>#<share key>
                                        └─ the fragment: browsers never send it
5. The recipient opens the link. The page reads the key from the fragment,
   fetches the ciphertext, which spends a view, and decrypts locally.
```

The server sees the ciphertext and the id. The key exists only in the link.

The recipient page never writes the password into the page: it can be copied,
not displayed, so it does not end up in screenshots, screen shares or the
browser's form history. A 2FA secret becomes a live code that refreshes on the
page.

## The limit: whoever carries the link can read it

To a chat app or an email provider, a link is text, fragment included. Such a
service, or anyone with access to it, can open the link before the recipient
does. The server stays blind; the messenger does not. Every link-based sharing
system has this property, 1Password's included.

What reduces it:

- **Short lifetime and one view.** The default is one day and one view, so a
  link that someone else opened first stops working for the recipient, which
  makes the interception visible.
- **A link password**, sent through a different channel. It is mixed into the
  key with HKDF, so the link alone opens nothing. The link already carries 256
  bits of key, so the password is a second factor rather than the source of
  strength. It is not slowed by a key-derivation function, though: someone who
  has the link and fetches the ciphertext, spending a view, can try passwords
  quickly. Use several random words, not a short code.
- **Restricting to email addresses**, below.

## Controls on a share

**Lifetime and views.** 1 hour to 30 days, 1 to 10 views in the extension
(the API allows up to 100). An expired or used-up share stops opening at once
and is deleted within the hour.

**One answer for every dead link.** Unknown, expired, revoked and used-up
shares all return `shares.gone`, so the API never confirms that an id existed.

**Claiming a view is atomic.** One statement increments the view count only if
it is below the limit and returns the ciphertext. Reading first and writing
afterwards would let two people open a single-view link at the same moment.

**Revoking without an owner.** The `shares` table has no account column, so
the database does not record who shared with whom. Creating a share returns a
random revoke token; the server keeps its hash. The extension keeps its list of
created links, with their tokens, sealed under the vault key. Settings →
Shared links shows each link's views left and expiry, and revokes it. Because
the list lives where it was created, a link made on one device is not listed on
another.

**Restricting to email addresses.** With email configured on the server, the
sender can name up to ten recipients. The server stores keyed hashes of the
addresses, not the addresses. The page then asks for an email, sends a 6-digit
code to it if it is on the list, and spends the view only when the right code
is entered. Requesting a code returns the same response whether the address is
on the list, the share exists, or a cooldown is running, so the list cannot be
probed one guess at a time.

Restriction protects against a carrier that reads the link but not the
recipient's inbox. It does not help when the same provider carries both.
