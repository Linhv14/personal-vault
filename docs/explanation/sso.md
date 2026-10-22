# Single sign-on

Organizations can make their members sign in through the company identity
provider (Google Workspace, Microsoft Entra ID, Okta, any OpenID Connect or SAML
2.0 provider) instead of a 7key password. The design follows Bitwarden's: SSO
proves who the member is, and a separate, member-chosen decryption option
decides how the vault key is recovered, so the server still never sees vault
keys or plaintext.

SSO is a commercial feature. Its code lives under `commercial/` and is covered
by `LICENSE_COMMERCIAL.md`; the AGPL core only knows how to mount it.

## Concepts

- **Organization identifier.** A short, unique slug an organization chooses
  (`acme`). Members type it, or their email, on the SSO screen to find the right
  provider.
- **Verified domain.** An organization proves it owns `acme.com` by publishing a
  DNS TXT record `7key-verify=<token>` that the Worker checks over DNS over
  HTTPS. Members whose email is on a verified domain skip typing the identifier,
  and only that organization may claim the domain.
- **Provider configuration.** Per organization: protocol (OIDC or SAML), and for
  OIDC the issuer, client ID and client secret; for SAML the IdP entity ID,
  single sign-on URL and signing certificate. Secrets are sealed with
  `AT_REST_SECRET` like other server-held secrets.
- **Policies.** _Require SSO_: members other than owners and admins must sign in
  through SSO. _Single organization_: members may not join another
  organization. _Account recovery administration_: members enrol a copy of
  their vault key that admins can use to reset a forgotten password. Trusted
  devices need all three.
- **Member decryption options**, chosen per organization:
  1. **Master password.** SSO replaces the password step for signing in; the
     member still types the master password to derive the vault key. No change to
     the key hierarchy.
  2. **Trusted devices.** The vault key is wrapped for a key held only by the
     device. A new device is approved by an existing trusted device or by an
     admin.
  3. **Key Connector** (self-hosted only, later). The organization runs a small
     service that stores members' key material behind SSO.

## Sign-in flow (OIDC)

1. The client posts the email or identifier to `POST /api/sso/prepare` and gets
   back the organization and a one-time `state`.
2. The client opens the provider's authorize URL with PKCE (`S256`), `state` and
   `nonce`, scope `openid email profile`, redirect URI `<server>/api/sso/callback`.
3. The provider redirects to the callback. The Worker exchanges the code with the
   PKCE verifier, verifies the ID token's signature against the provider's JWKS,
   `iss`, `aud`, `exp`, `nonce`, and that `email_verified` is true and the email
   is on a verified domain of the organization (or an accepted invitation).
4. The Worker issues a short-lived, single-use SSO grant and redirects to the
   client, which trades it for a session at `POST /api/sso/session`.
5. What happens next depends on the decryption option: ask for the master
   password, open the vault with the device key, or start device approval.

A first-time member is provisioned just in time: the client creates the account
keys locally exactly as normal registration does (and, for the master password
option, asks for one), then joins the organization.

SAML follows the same shape with an HTTP-POST binding to
`/api/sso/saml/acs`; the assertion must be signed by the configured certificate,
match the audience and recipient, be inside its validity window and carry a
`InResponseTo` we issued. Signature checks verify the exact element that is read
(no XML Signature Wrapping), and DOCTYPE and external entities are rejected.

## Account recovery administration

The organization has an RSA-OAEP key pair. Its private key is wrapped for each
owner and admin with `wrapForRecipient`, the way team keys already are. A member
who enrols wraps their vault key for the organization public key and uploads
that blob; the server stores it but cannot open it. To reset a member's master
password, an admin unwraps the organization key, unwraps the member's vault key,
and re-wraps it under a new master password the admin sets, all on the admin's
device; the member must change it at next sign-in. Every enrolment, withdrawal
and reset is recorded in the hash-chained audit log, and the member is emailed.

## Trusted devices

Each device that a member trusts generates a device key pair and a symmetric
device key. The vault key is wrapped with the device public key; the device
private key is wrapped with the device key, which never leaves the device. The
server stores the two wrapped blobs and the public key.

A new device asks for approval and shows a short fingerprint phrase. Approval
comes from an existing trusted device (which unwraps the vault key and wraps it
for the new device's public key) or from an admin through account recovery.
Requests expire after 12 hours. Members can list and remove trusted devices;
removing one deletes its wrapped key on the server.

## Licensing

On 7key.online, SSO is available to organizations on the enterprise plan. A
self-hosted server enables it with `LICENSE_KEY`, a signed statement of the
licensee, seat count and expiry that the Worker verifies offline with a public
key built into the code. Without a valid licence the SSO routes answer
`403 license.required`.

## Delivery plan

| Phase | Scope                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Licence check, organization identifier, domain verification, OIDC, require-SSO and single-organization policies, master password option, just-in-time join |
| 2     | Account recovery administration                                                                                                                            |
| 3     | Trusted devices with device-to-device and admin approval                                                                                                   |
| 4     | SAML 2.0                                                                                                                                                   |
| 5     | SCIM provisioning; Key Connector for self-hosted organizations                                                                                             |

Phases 2 and 3 change who can open a vault key, so each gets its own review of
the wrapping scheme and new tests against the threat model before it ships.
