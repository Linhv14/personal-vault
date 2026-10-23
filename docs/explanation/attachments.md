# File attachments

Design for files attached to vault items: a scanned passport on an identity, a
licence file, an SSH key bundle, the recovery sheet a bank printed. Status:
proposed; nothing below is built yet.

## Goals and limits

- A file is encrypted on the device before it leaves; the server stores bytes it
  cannot read and learns only sizes, counts and which item a file hangs off.
- Attachments work in personal vaults and team vaults, and survive trash,
  restore and moving an item between vaults.
- Nothing about an item changes for clients that do not know attachments: the
  file list lives in a field they ignore.
- Not in the first version: offline copies of files, attachments in share links,
  exports that carry files, previews of anything but images and PDFs, files
  from Bitwarden or 1Password imports. Each is listed under
  [Later](#later).

## Availability

Attachments are a paid feature on 7key.online and free when you run your own
server:

- **7key.online** sets `ATTACHMENTS = "paid"`. A team vault takes files when its
  organization is on the Team or Enterprise plan (`attachments` in
  `PLAN_LIMITS`, next to seats and teams), and a person can attach files to
  personal items while they belong to such an organization. On the Free plan the
  clients show the feature as part of Team, without an upload button.
- **A self-hosted server** defaults to `ATTACHMENTS = "all"`: every account and
  every team, with no licence key, once the `FILES` bucket exists.
- `ATTACHMENTS = "off"`, or no `FILES` binding, turns the feature off.

`/api/config` reports `attachments: "all" | "paid" | "off"`; whether a given
account or team may upload is decided by the server on each upload, and the
answer for the signed-in account comes with its organizations.

Files already uploaded stay readable and deletable if an organization drops back
to Free; only new uploads are refused (`403 files.plan_required`), so nobody
loses a document because a payment lapsed.

## Encryption

Each file gets a fresh 256-bit **file key** and a random UUID. The plaintext is
cut into 1 MiB chunks, and each chunk is sealed with AES-256-GCM:

- **Nonce:** four zero bytes followed by the chunk index as a 64-bit big-endian
  integer. The key encrypts one file only, so a counter never repeats a nonce,
  and no nonce has to be stored.
- **Associated data:** `personal-vault/file/<file id>/<chunk index>/<last>`,
  where `<last>` is `1` for the final chunk and `0` otherwise. The server cannot
  reorder chunks, swap two files, or cut a file short and pass the rest off as
  complete: a missing tail fails because no chunk claims to be last.

The stored object is a one-byte format version followed by the sealed chunks
back to back, each 16 bytes longer than its plaintext. Decryption reads one
chunk at a time, so memory stays bounded by the chunk size.

The file key never reaches the server on its own. It sits with the file's name,
type and plaintext size inside the item's ciphertext:

```json
"attachments": [
  { "id": "…uuid…", "name": "passport.pdf", "type": "application/pdf",
    "size": 482113, "key": "…base64…", "uploadedAt": 1792800000 }
]
```

So whoever can open the item can open its files, and nobody else. The item size
limit of 64 KiB leaves room for a few hundred attachments per item; the limits
below are far stricter.

This lives in `src/core/files.ts`, next to the other primitives, with tests for
truncation, reordering, a swapped file id and a flipped bit.

## Storage

Files go to an R2 bucket bound as `FILES`, under two prefixes:

| Scope         | Object key                       | Metadata row                               |
| ------------- | -------------------------------- | ------------------------------------------ |
| Personal item | `a/<account id>/<file id>`       | `files` table in the account's `UserStore` |
| Team item     | `o/<org id>/<team id>/<file id>` | `team_files` table in the `OrgStore`       |

A metadata row holds the file id, the item id it belongs to, the stored size,
who uploaded it (team files) and when. Quotas, deletion and the activity log
read these rows; nobody lists the bucket during normal work.

## API

| Request                                                                 | Effect                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `PUT /api/files/:id?item=<item id>`                                     | Streams the sealed object to R2 after checking the declared `Content-Length` against quotas |
| `GET /api/files/:id`                                                    | Streams it back; `Cache-Control: private, no-store`                                         |
| `DELETE /api/files/:id`                                                 | Removes the object and its row                                                              |
| Same three under `/api/orgs/:org/teams/:team/files/:id`                 | Team scope: members read, members who can edit write, as for team items                     |
| `POST /api/orgs/:org/teams/:team/files/:id/copy` `{ from: "personal" }` | Copies a personal file into the team, for moving an item                                    |

Uploads go through the account write limiter like item writes. A file id the
caller did not create is refused, so one account cannot overwrite another's
object by guessing ids.

## Lifecycle

**Saving.** The client uploads the files first, then saves the item that names
them. If the item save never happens (the tab closed, the network dropped), the
file is an orphan. Each upload schedules an alarm in its Durable Object for 24
hours later; the alarm deletes the file if no live item with its item id exists
by then. The server cannot read the item, so it checks only that the item still
exists; a file the item no longer lists is removed by the client when the user
removes it, and otherwise waits for the item's deletion.

**Removing a file** from an item deletes the object, then saves the item without
it.

**Trash.** A trashed item keeps its files, so restoring it brings them back.
Deleting an item for good, by hand or when the 30-day trash purge runs, sends the
usual `DELETE /api/items/:id`; the server then deletes every file whose row
names that item. Team items are hard-deleted the same way.

**Moving an item** between a personal vault and a team vault copies its files
server-side into the target scope (`/copy`, ciphertext unchanged: the key is in
the item), writes the item there, and deletes the source item, which takes its
source files with it. Two copies exist only between those steps.

**Account deletion** deletes the `a/<account id>/` prefix. **Team deletion**
deletes `o/<org id>/<team id>/`. Both run after the database work, in
`waitUntil`, in batches of 1,000 keys.

## Teams and re-keying

Removing a member re-keys the team as today: the admin's device re-seals every
team item under the new team key, and the attachment entries, file keys
included, move inside them. **The files themselves are not re-encrypted.** The
departed member could already read every file that existed while they were in
the team, so they learn nothing new; from the moment they leave, the server
refuses to hand them any object; and files uploaded afterwards get keys they
never see. Re-encrypting gigabytes on one admin's device to protect data the
person has already seen would buy nothing.

Uploading and deleting team files are written to the activity log as
`team.file_saved` and `team.file_deleted`, with sizes and without names.

## Limits

| Limit                  | Value   | Why                                                     |
| ---------------------- | ------- | ------------------------------------------------------- |
| One file               | 25 MiB  | Decrypted in memory for download; covers scans and PDFs |
| Per account (personal) | 250 MiB | Personal documents of a member of a paid organization   |
| Per team vault         | 1 GiB   | Shared documents of a small team                        |
| Files per item         | 20      | Keeps the item well under 64 KiB                        |

Self-hosted servers can raise them with variables (`FILE_MAX_BYTES`,
`ACCOUNT_FILES_BYTES`, `TEAM_FILES_BYTES`).

## What the server learns

Compared with today, the server also sees how many files each item has, their
sizes to within 16 bytes per MiB, and when they were uploaded or read. Sizes can
hint at content (a passport scan and a two-line note differ); padding each file
up to a size bucket was considered and left out of the first version because it
multiplies storage, and the threat model says so plainly.

## Self-hosting

R2 must be turned on in the Cloudflare account (the free tier asks for a payment
method), so the bucket is opt-in: `npm run deploy -- --attachments` creates it
and the `FILES` binding. Without the binding the server reports
`attachments: "off"` and the clients hide the feature.

## Delivery plan

1. `src/core/files.ts`: chunked sealing and opening, with tests.
2. Worker, personal scope: optional `FILES` binding, `ATTACHMENTS` mode and the
   plan check, `files` table and alarm in `UserStore`, the three routes,
   quotas, deletion with the item and the account, `attachments` in
   `/api/config`.
3. Extension: attach, list, download and remove in the editor and detail view;
   images and PDFs open in a new tab from a `blob:` URL.
4. Team scope: `team_files`, team routes, copy on move, deletion with the team,
   activity log.
5. Console and web dashboard; deploy option; limits, HTTP API, data model,
   threat model and privacy policy.

## Later

- Offline copies of chosen files, kept encrypted in the extension's storage.
- Files in share links: a separate one-time object under the share's key.
- Encrypted exports that include files, and attachments from Bitwarden and
  1Password exports.
- Larger quotas per plan once billing opens.
