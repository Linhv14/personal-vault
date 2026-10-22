# Set up single sign-on

Let the members of an organization sign in through your company's identity
provider. SSO only replaces the sign-in step: each member still unlocks their
vault with their own master password, which never leaves their device. See
[Single sign-on](../explanation/sso.md) for how it works.

You need to be an owner or admin of the organization, and SSO must be
available: on 7key.online the organization is on the enterprise plan; on your
own server, `LICENSE_KEY` holds a valid licence (see
[Configuration](../reference/configuration.md)).

## 1. Choose an identifier and verify your domains

In the console, open **Settings → Single sign-on**.

1. Set the **organization identifier**, for example `acme`. Members whose email
   is not on a verified domain type it on the sign-in screen.
2. Under **Verified domains**, add `acme.com`. 7key shows a TXT record such as
   `7key-verify=Qm9…`.
3. Publish that record as a TXT record on `acme.com` at your DNS host, then
   press **Verify**. 7key looks it up through Cloudflare's DNS over HTTPS; a new
   record can take a few minutes to appear.

Only one organization can verify a domain. You can keep the record in DNS; 7key
does not check it again after verification.

## 2. Register 7key at your identity provider

Copy the **Redirect URI** shown in the console. It is always
`https://<your server>/api/sso/callback`, for example
`https://7key.online/api/sso/callback`. Register a web application (a
confidential client with a client secret) that uses the authorization code flow
with that redirect URI and the scopes `openid`, `email` and `profile`.

### Google Workspace

1. In the Google Cloud console, create or pick a project, configure the OAuth
   consent screen as **Internal**, then go to **Credentials → Create credentials
   → OAuth client ID** and choose **Web application**.
2. Add the redirect URI under **Authorized redirect URIs**.
3. Issuer: `https://accounts.google.com`. Copy the client ID and client secret.

### Microsoft Entra ID

1. In the Entra admin center, go to **App registrations → New registration**,
   choose **Accounts in this organizational directory only**, and add the
   redirect URI as a **Web** platform.
2. Under **Certificates & secrets**, create a client secret and copy its value.
3. Under **Token configuration**, add the optional ID token claims `email` and
   `xms_edov`. Entra does not send `email_verified`; 7key accepts `xms_edov: true`
   instead, and only from `login.microsoftonline.com` issuers.
4. Issuer: `https://login.microsoftonline.com/<tenant id>/v2.0`. Copy the
   **Application (client) ID**.

### Okta

1. In the Okta admin console, go to **Applications → Create App Integration**,
   choose **OIDC** and **Web Application**.
2. Add the redirect URI under **Sign-in redirect URIs**, keep **Client secret**
   as the client authentication, and assign the people or groups who may use
   7key.
3. Issuer: your Okta org URL, for example `https://acme.okta.com` (or the
   authorization server URL, such as `https://acme.okta.com/oauth2/default`,
   if you use one). Copy the client ID and client secret.

Any other OpenID Connect provider works the same way, provided its ID tokens are
signed with RS256 or ES256 and carry `email` and `email_verified: true`.

## 3. Enter the provider in 7key

Under **OpenID Connect provider**, paste the issuer, client ID and client
secret, tick **Allow members to sign in with SSO** and save. 7key fetches
`<issuer>/.well-known/openid-configuration` and refuses to save if it cannot read
it or if it names another issuer. The client secret is stored encrypted and is
never shown again; leave the field blank later to keep it.

**Member decryption** is **Master password**: members unlock with their own
master password after signing in. Trusted devices come in a later release.

## 4. Try it, then turn on policies

On the extension's first screen or on the web dashboard, choose **Sign in with
SSO** and enter your work email or the identifier. Someone without a 7key
account yet is asked to create a master password and joins the organization as
a member. Addresses on other domains cannot use SSO, even when invited: they
accept the invitation and sign in with their master password.

When it works, choose the policies:

- **Require single sign-on.** Members on a verified domain, other than owners
  and admins, can no longer
  sign in with their master password alone; the sign-in screen sends them to
  SSO. Owners and admins keep password sign-in so a broken provider cannot lock
  everyone out.
- **Single organization.** Members other than owners and admins cannot join
  another organization, and people who already belong to another organization
  cannot join this one.

Every change on this page is recorded in the organization's activity log.

## Troubleshooting

| Message                                                     | Cause                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The TXT record was not found yet                            | DNS has not picked the record up yet, or it was added to another name                                                   |
| The provider's OpenID configuration could not be read       | Wrong issuer URL, or the provider does not publish discovery at `<issuer>/.well-known/openid-configuration`             |
| The identity provider did not confirm the sign-in           | Wrong client secret or redirect URI, the person cancelled, or the ID token failed a check (signature, audience, expiry) |
| Your identity provider has not verified this email address  | The ID token has no `email_verified: true` (for Entra, no `xms_edov: true`)                                             |
| This email is not on a verified domain of the organization  | Verify the domain. Addresses on other domains sign in with their master password                                        |
| Single sign-on needs the enterprise plan or a valid licence | No enterprise plan and no valid `LICENSE_KEY`, or the licence expired                                                   |
