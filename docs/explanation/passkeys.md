# Passkeys

7key can create and use passkeys on websites, so signing in needs neither a
password nor a phone. It is part of **Settings → Preferences → Autofill and
passkeys on websites** and is off until that is turned on.

## How a passkey is made and used

Chrome has no API that lets an extension act as a passkey provider, so 7key
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

## The prompt

The prompt is a small panel in the top-right corner, like the browser's own
password prompts, not a modal over the page: the site stays readable and
usable while it is open. It offers **Save in 7key** when a site creates a
passkey and the saved accounts when it asks for one. After a save it confirms
for a moment and closes. When the site lists a credential 7key already holds in
`excludeCredentials`, the panel says the passkey is already saved instead of
offering a second one, and the site gets the `InvalidStateError` the spec asks
for.

## Passkeys in the sign-in field

Many sites ask for a passkey quietly when the sign-in page loads
(`mediation: "conditional"`) and expect it to be offered in the username
field's autofill. 7key passes that request on to the browser as usual, so its
own passkey suggestions still appear, and also lists the passkeys it holds for
the site in its fill menu on that field. Picking one there is the consent: 7key
signs, the site gets the credential, and the browser's pending request is
cancelled. If the site cancels first, the passkeys leave the menu. The list
never reaches the page: the fill menu and the passkey bridge share the
extension's isolated world, which page scripts cannot read.

Sites often check `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`
before offering a passkey at all. With autofill on, 7key answers yes, since it
is one; without that, sites on machines with no Touch ID or Windows Hello never
ask.

## What is stored

A passkey is an ECDSA P-256 key pair (ES256). The private key, the credential
id, the RP ID and the user handle are saved inside the login item, so they are
end-to-end encrypted and synced like a password. The server never sees them,
and a share link never includes them.

Passkeys are created as **synced** credentials: the authenticator data marks
them backup-eligible and backed up, which is accurate, and sites that care can
tell. The signature counter stays at zero, as with other synced passkeys.
Attestation is `none`, with the 7key AAGUID
`8c3f47c7-7c94-4ad9-9344-8fbe58a9b394` in the authenticator data. Sites look
an AAGUID up in the community
[passkey-authenticator-aaguids](https://github.com/passkeydeveloper/passkey-authenticator-aaguids)
list to show the provider's name and icon next to the passkey, so the name
appears only once 7key is listed there. Passkeys created before this AAGUID
carry all zeros and stay unnamed.

## When 7key steps aside

- **Use another device** in the dialog hands the request back to the browser,
  for a security key, a phone, or the platform's own passkeys.
- Requests in iframes, requests without ES256, and registrations that ask for
  a `cross-platform` authenticator (a security key) go straight to the
  browser.
- A sign-in on a site where 7key has no passkey goes straight to the browser
  without a dialog.
- If 7key is locked and the vault holds no passkeys, the browser handles the
  request without a dialog. The only thing stored to decide this is one
  yes-or-no flag per device, never the list of sites.
- If 7key is locked and the vault holds passkeys, the dialog asks to unlock it
  and continues on its own once the vault opens.

## Limits

- Chrome desktop only. Mobile browsers do not let extensions do this.
- Passkeys can be imported from Proton Pass and Bitwarden JSON exports.
  1Password and browsers do not export passkeys, so on those sites add a new
  passkey with 7key.
- A synced passkey is protected by the master password and the devices that
  hold the vault, not by a hardware-bound key. That is the usual trade-off of
  password-manager passkeys.
