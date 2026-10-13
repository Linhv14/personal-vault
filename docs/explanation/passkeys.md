# Passkeys

1PW can create and use passkeys on websites, so signing in needs neither a
password nor a phone. It is part of **Settings → Autofill and passkeys on
websites** and is off until that is turned on.

## How a passkey is made and used

Chrome has no API that lets an extension act as a passkey provider, so 1PW
does what other password managers do: it replaces `navigator.credentials.create`
and `navigator.credentials.get` on the page and answers them itself.

```
page script (MAIN world)        isolated script            service worker
  navigator.credentials.*  ──►  dialog in a closed  ──►  checks the RP ID against
  forwards the options           shadow root, real         the page Chrome reports,
  and nothing else               clicks only               builds clientDataJSON,
                                                           creates or signs
```

- **The page script decides nothing.** It turns the options into plain data,
  passes them on, and turns the answer back into a `PublicKeyCredential`. A
  site can tamper with it, and gains nothing: it can only ask for passkeys for
  its own origin, which it could do anyway.
- **The service worker owns every decision.** The origin comes from Chrome's
  record of the top frame, never from the page. The RP ID must be that host or
  a parent of it, no broader than its registrable domain: a page cannot claim
  `google.com`, a public suffix such as `co.uk`, or a neighbour on shared
  hosting such as another `github.io` site. `clientDataJSON` is built from the
  real origin, so a signature cannot be replayed elsewhere.
- **Consent is a real click** in a dialog the page cannot read or script.

## What is stored

A passkey is an ECDSA P-256 key pair (ES256). The private key, the credential
id, the RP ID and the user handle are saved inside the login item, so they are
end-to-end encrypted and synced like a password. The server never sees them,
and a share link never includes them.

Passkeys are created as **synced** credentials: the authenticator data marks
them backup-eligible and backed up, which is accurate, and sites that care can
tell. The signature counter stays at zero, as with other synced passkeys.
Attestation is `none`.

## When 1PW steps aside

- **Use another device** in the dialog hands the request back to the browser,
  for a security key, a phone, or the platform's own passkeys.
- Requests in iframes, requests without ES256, and conditional (autofill-style)
  requests go straight to the browser.
- A sign-in on a site where 1PW has no passkey goes straight to the browser
  without a dialog.
- If 1PW is locked and the vault holds no passkeys, the browser handles the
  request without a dialog. The only thing stored to decide this is one
  yes-or-no flag per device, never the list of sites.
- If 1PW is locked and the vault holds passkeys, the dialog asks to unlock it
  and continues on its own once the vault opens.

## Limits

- Chrome desktop only. Mobile browsers do not let extensions do this.
- Passkeys already saved with another provider cannot be moved into 1PW; sites
  let you add a new one.
- A synced passkey is protected by the master password and the devices that
  hold the vault, not by a hardware-bound key. That is the usual trade-off of
  password-manager passkeys.
