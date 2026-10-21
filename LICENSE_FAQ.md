# Licensing FAQ

## Is 7key open source?

Yes. Everything in this repository is licensed under the GNU Affero General Public License
version 3 (AGPL-3.0), an OSI-approved open source license, except files inside a
`commercial/` directory. Today no such directory exists: every feature of 7key is under the
AGPL.

The server, the browser extension, the web dashboard, the CLI and the GitHub Action are all
covered. You can read, audit, build, modify and self-host them.

## Why open source?

A password manager asks you to trust it with everything. Publishing the code lets anyone
check that 7key does what the threat model says: that data is encrypted on your device and
the server only ever sees ciphertext.

## Why the AGPL and not MIT?

The AGPL keeps improvements open. If you run a modified 7key server and let others use it
over a network, you must offer them the source of your modified version. That stops anyone
from taking the code, closing it and selling it back as a competing hosted service.

Earlier releases were published under the MIT License. Those releases stay under MIT; the
AGPL applies from the release that adds this file onward.

## What will the commercial license cover?

Features built mainly for larger organizations, such as single sign-on (SSO), SCIM
provisioning or directory sync, may be published in a `commercial/` directory under
`LICENSE_COMMERCIAL.md`. That code is source available: you can read it, test it and audit
it, but running it in production needs a subscription. Personal vaults, team vaults, project
secrets, the CLI, CI and AI agent support are not planned to move under it.

## Can I self-host 7key?

Yes, for free, under the AGPL. If you modify the server and others use it over a network,
you must make your modified source available to them. Commercial features, once they exist,
need a subscription for production use.

## Can I offer 7key as a hosted service?

Under the AGPL you may, as long as you publish the complete source of what you run,
including your changes, under the AGPL. You may not use the 7key name or logo for it (see
`TRADEMARKS.md`), and you may not host the commercial features without an agreement.

## Can I use 7key's code in my own product?

Yes, if your product is released under the AGPL-3.0 (or a compatible license, as the AGPL
allows). If you need different terms, contact hello@7key.online.

## Do I need to sign anything to contribute?

Yes. Pull requests are accepted under the Contributor License Agreement in `CLA.md`. It
lets the project keep offering 7key under the AGPL and, where needed, under the commercial
license, while you keep the copyright in your contribution.

## Who owns 7key?

7key is written and maintained by linhv14, who holds the copyright and the trademarks.
