# Streams Plugin

Real-time content streams, access control, messaging, invitations, subscriptions, and social collaboration for the Qbix platform. Streams is the core social infrastructure layer — it sits on top of the Users plugin and provides the data model that most Qbix apps build on.

## Core Concepts

Everything in Streams revolves around six primitives: **streams**, **messages**, **participants**, **access rows**, **relations**, and **invites**. A stream is a content object with a publisher, a name, a type, and fine-grained access control. Messages are the append-only event log on a stream. Participants track who has joined. Access rows govern who can see, write, or administer. Relations connect streams to each other in typed, weighted graphs. Invites grant people entry via shareable token URLs.

### Streams

A **stream** is identified by a `(publisherId, name)` pair. The `publisherId` is the user who owns the stream. The `name` is a freeform path-like string — by convention it follows the pattern `Module/purpose/identifier`, for example `Streams/chat/poker-night` or `Streams/user/firstName`.

Every stream has a `type` that determines its behavior, default access levels, which messages it accepts, and which UI tools render it. Types follow the `Module/kind` convention: `Streams/chat`, `Streams/image`, `Streams/task`, `Streams/category`, and so on.

Streams carry `title`, `content`, `icon`, `attributes` (a JSON object), and `permissions` (a JSON array of named capabilities). The `content` field (up to 4095 bytes) holds indexable text — a chat description, an article summary, a file caption. Heavier payloads go in `attributes` or in the message log.

When a user creates, edits, or closes a stream, the plugin posts a typed message (`Streams/created`, `Streams/changed`, `Streams/closed`) to that stream's message log. This means the full history of a stream is recoverable from its messages.

### Access Levels

Streams uses a numeric-tier system for access control across three orthogonal dimensions. Each level is a threshold — having level N grants all capabilities at level N and below.

**Read levels** control what you can see:

| Level | Name | Meaning |
|---|---|---|
| 0 | `none` | Cannot see the stream at all |
| 10 | `see` | Can see icon and title |
| 15 | `teaser` | Can see teaser attributes |
| 20 | `relations` | Can see relations to other streams |
| 23 | `content` | Can see the stream's content field |
| 25 | `fields` | Can see most fields |
| 30 | `participants` | Can see who is participating |
| 35 | `messages` | Can play/view the stream's message log |
| 40 | `receipts` | Can see other users' read receipts |

**Write levels** control what you can do:

| Level | Name | Meaning |
|---|---|---|
| 0 | `none` | Cannot affect the stream |
| 10 | `join` | Can become a participant and leave |
| 13 | `vote` | Can vote on relation messages |
| 15 | `suggest` | Can privately suggest actions to managers |
| 16 | `ephemeral` | Can send ephemeral (non-persisted) payloads |
| 18 | `contribute` | Can contribute (e.g. join the stage in a live stream) |
| 19 | `fork` | Can fork the stream into a new branch |
| 20 | `post` | Can post durable messages |
| 23 | `relate` | Can post messages relating other streams |
| 25 | `relations` | Can update relation weights and unrelate |
| 30 | `edit` | Can edit stream content directly |
| 35 | `closePending` | Can request stream closure |
| 40 | `close` | Can close the stream |

**Admin levels** control governance:

| Level | Name | Meaning |
|---|---|---|
| 0 | `none` | No admin capabilities |
| 10 | `tell` | Can prove things about the stream |
| 15 | `share` | Can share the stream's content |
| 20 | `invite` | Can create invitations granting up to their own access |
| 30 | `manage` | Can approve posts, grant admin levels below manage |
| 40 | `own` | Full control, can appoint managers |

### Access Resolution

When the plugin checks whether user A can do something with a stream published by user B, it considers multiple access sources in priority order:

1. **Public** — the stream's own `readLevel`, `writeLevel`, `adminLevel` fields (the defaults for everyone).
2. **Contact** — access rows where `ofContactLabel` matches a label that B has assigned to A (e.g. `Users/friends`, `Streams/invitedMe`).
3. **Participant** — if A is participating, the participant row may grant additional access.
4. **Direct** — access rows where `ofUserId` is exactly A's user id.
5. **Inherited** — all four sources can also be inherited from parent streams listed in the stream's `inheritAccess` JSON array.

The effective access level for each dimension is the maximum across all applicable sources. Access rows with a level of -1 are ignored (treated as "no opinion"), which allows granting write access via a contact label without overriding read access.

### Messages

A **message** is an immutable event posted to a stream. Messages are ordered by `ordinal` (a monotonically increasing integer per stream) and carry a `type`, human-readable `content`, and machine-readable `instructions` (a JSON payload with deltas, metadata, or commands).

Message types follow the pattern `Module/kind` or `Module/kind/subkind`. The Streams plugin defines several built-in types:

`Streams/created`, `Streams/changed`, `Streams/closed` — lifecycle events. `Streams/joined`, `Streams/left` — participation changes. `Streams/relatedTo`, `Streams/relatedFrom`, `Streams/unrelatedTo` — relation changes. `Streams/chat/message`, `Streams/chat/edit`, `Streams/chat/remove` — chat operations. `Streams/invited`, `Streams/subscribed`, `Streams/announcement` — social events. `Streams/task/progress`, `Streams/task/complete`, `Streams/task/error` — task lifecycle.

Each message records `byUserId` (who posted it), `byClientId` (which socket client), `sentTime`, and a `weight` field for reputation-weighted sorting.

### Message Totals

The `total` table maintains running counts of messages by type per stream. This allows efficient "unread count" and "new messages since X" queries without scanning the message table.

### Participants

A **participant** row tracks a user's membership in a stream. Participant state is one of `invited`, `participating`, or `left`. The row also records whether the user is `subscribed` (receiving notifications) and whether they have `posted` a message.

Participants carry an `extra` JSON field for per-user metadata (e.g. last-read ordinal, role assignments, custom state that apps layer on).

### Relations

Streams can be connected to each other via typed, weighted relations. This is the mechanism for categories, playlists, threaded discussions, file attachments, and any other graph structure.

Two tables mirror each relation: `related_to` (owned by the category/parent stream's publisher) and `related_from` (owned by the member/child stream's publisher). The split allows each publisher's shard to own its own side of the relation.

Each relation has a `type` (freeform string — e.g. `""`, `"Streams/fork"`, an app-specific label) and a `weight` (decimal, used for ordering). Relating a stream posts `Streams/relatedTo` and `Streams/relatedFrom` messages to the respective streams, which triggers real-time notifications to observers.

The `related_to_total` and `related_from_total` tables maintain denormalized counts of relations by type per stream.

### Categories

A **category** is a denormalized cache for a stream that acts as a container. The `category` table stores a serialized JSON snapshot of the related stream types, icons, and titles, enabling fast display of stream listings without joining across multiple tables.

## Invitations

The invite system lets users with sufficient admin level (`invite` or above) generate shareable token URLs that grant access to a stream. The flow works like this:

1. The inviting user calls `Streams::invite()`, specifying the target stream, the invitees (by user id, email, mobile number, or contact label), and optionally the access levels and permissions to grant.
2. The system generates a random token (16 lowercase letters by default) and stores an `invite` row on the publisher's shard and an `invited` row on the invitee's shard.
3. The invite URL (e.g. `https://app.example/i/abcdefghijklmnop`) is sent to the invitee via the configured delivery channels (push notification, email, SMS).
4. When the invitee clicks the link, `Streams_before_Q_objects` intercepts the token, looks up the invite, auto-logs in the invited user if they're not already logged in, and stores the token in the PHP session.
5. On the next page load (or immediately via `Streams.acceptInvite` on the client), `invite->accept()` upgrades the user's access levels, joins them as a participant, and optionally auto-subscribes them to the stream.

Invite states cycle through `pending` → `accepted` (or `declined`, `forwarded`, `expired`, `arrived`). Each transition posts messages to the stream and to the invitee's personal `Streams/invited` stream.

The `request` table handles the reverse flow — a user requesting access to a stream they can see but not fully access. Requests go through `pending` → `granted` or `rejected`.

### Invite Tokens and Short URLs

Invite tokens are separate from Metrics tracker IDs and Groups contact tokens. All three can coexist in a single link. The tracker handles attribution ("which campaign brought this person"), the invite token handles access ("what are they allowed to do"), and the contact token handles identity ("which specific recipient clicked").

## Subscriptions and Notifications

**Subscribing** to a stream means opting in to receive notifications when certain message types are posted. A subscription is a row in the `subscription` table with a `filter` (JSON object specifying which message types trigger notifications) and an optional `untilTime` expiry.

**Rules** (the `rule` table) control how notifications are delivered. Each rule specifies a `filter` (which message types to catch), a `deliver` object (which channels to use: `devices`, `email`, `mobile`), and a `readyTime` (after which the rule is active — used for "do not disturb" windows). A subscription can have multiple rules applied in ordinal order.

When a message is posted to a stream, the notification pipeline:

1. Finds all participants who are subscribed.
2. For each subscriber, evaluates their subscription filter to see if this message type passes.
3. For matching subscribers, evaluates their rules to determine delivery channels.
4. Dispatches notifications via the configured transports (push notifications via the Users plugin's device table, email, SMS).

Notification delivery respects the `onlyIfAllClientsOffline` flag — if the user has an active socket connection, push/email notifications may be suppressed in favor of real-time delivery.

## Real-Time System

Streams provides bidirectional real-time updates via WebSockets (through the Qbix Node.js server). The system uses three socket operations:

**Observe** — A client calls `Stream.observe(publisherId, streamName)` to register interest in a stream. The Node.js server validates the client's capability token (which encodes their read access), adds them to an in-memory observers map, and begins forwarding messages, participant changes, and relation updates for that stream.

**Neglect** — The inverse of observe. Removes the client from the observers map. Happens automatically on disconnect.

**Ephemeral** — Clients with write level ≥ `ephemeral` (16) can broadcast transient payloads to all observers of a stream. Ephemerals are never persisted to the database — they're for cursor positions, typing indicators, live audio/video sync commands (`Streams/play`, `Streams/pause`, `Streams/seek`), and similar low-latency, high-frequency events. Each stream type declares which ephemeral types it accepts in its config.

On the server (Node.js) side, when a PHP handler posts a message or updates a stream, it sends a `Q.Utils.sendToNode` payload. The Node.js process then calls `Streams.Stream.construct()` to update its in-memory cache and broadcasts the event to all connected observers via their socket connections.

### Client-Side Caching

The JavaScript `Streams.Stream` class maintains an in-memory cache of streams, keyed by `(publisherId, name)`. When a stream is fetched via `Streams.get()`, the result is cached locally. Real-time updates from the socket automatically update the cached copy via `Stream.construct()`. Tools that render streams can call `Stream.observe()` to ensure they stay current and `Stream.neglect()` when they unmount.

## Forking

Streams supports **forking** — creating a new stream that inherits the message history of an existing stream up to a given ordinal, then diverges. This is conceptually similar to git branching or ZFS clones.

`Streams::fork($asUserId, $publisherId, $streamName, $ordinal, $toPublisherId)` creates a new stream under `$toPublisherId` that:

1. Copies all fields from the source stream (type, content, attributes, access levels).
2. Sets its `fork` JSON field with the full provenance chain — the source publisher, stream name, ordinal, and timestamp.
3. Starts its `messageCount` at `$ordinal`, so new messages on the fork continue the sequence.
4. Is related to the source stream via a `Streams/fork` relation (weighted by ordinal for governance sorting).
5. Inherits access from the source stream via `inheritAccess`.
6. Fork-copies file attachments using copy-on-write symlinks (zero bytes copied at fork time, real copies made only on subsequent writes).

The `fork` field contains a `chain` array — an ordered list of `[publisherId, ordinalMin, ordinalMax]` segments. When fetching messages from a forked stream, `Streams_Message::fetch()` walks the chain, building a UNION query that pulls messages from each ancestor for its ordinal range. This means a forked stream's full history is readable without physically duplicating message rows.

## Workspaces

**Workspaces** are virtual publisher namespaces that enable copy-on-write overlays across entire stream trees. A workspace publisherId looks like `"alice~ws2"` — the base publisher is `"alice"`, and `"ws2"` is the workspace name.

Workspaces are stateless per request. The client passes a `workspaces[]` query parameter (or `Streams.workspaces` special field) specifying a stack of workspace names. The server constructs a cascade of publisherIds — `["alice~ws2", "alice~ws1", "alice"]` — and uses the first match when fetching streams. Writes go to the topmost workspace publisher, creating overlay rows that shadow the base publisher's data.

This enables scenarios like draft editing (work in a workspace, merge when ready), A/B testing (different workspace stacks see different content), and governance workflows (propose changes in a workspace, approve to merge into the base).

## Avatars

The `avatar` table is a denormalized cache of user display information (username, first name, last name, icon) scoped per viewer. The `(toUserId, publisherId)` key means each user can see a different presentation of another user's identity, depending on their access to that user's profile streams.

When access rows change (a contact label is added or removed, a direct access grant is made), the avatar system recalculates which profile fields are visible and updates the relevant avatar rows. This is handled automatically by hooks on `Streams_Access::afterSaveExecute` and `afterRemoveExecute`.

The special `toUserId = ""` row is the public avatar — what unauthenticated users and users with no special access see.

## User Streams

When a user registers, the Streams plugin automatically creates a set of personal streams defined in `config/streams.json`. These include:

`Streams/user/firstName`, `Streams/user/lastName`, `Streams/user/username` — name fields, each a `Streams/text/name` stream with its own access levels. `Streams/user/icon` — profile image, a `Streams/image` stream. `Streams/user/emailAddress`, `Streams/user/mobileNumber` — contact info, private by default (readLevel 0). `Streams/invited` — a personal stream where invite notifications are posted. `Streams/mentioned` — a personal stream for @mention notifications. `Streams/participating` — a category stream listing what the user is participating in. `Streams/contacts`, `Streams/labels` — resource streams governing who can manage the user's contacts and labels.

Additional personal streams can be configured via `Streams.possibleUserStreams` (birthday, gender, height, dating preferences, interests, etc.) and `Streams.onInsert.person` / `Streams.onInsert.user`.

The `Streams.onUpdate.Users_User` config maps Users table fields to their corresponding streams. When a user's `username` changes in the Users table, the `Streams/user/username` stream is automatically updated, and vice versa.

### Platform Data Import

Each user stream can declare a `platforms` mapping in `streams.json` — for example, `Streams/user/firstName` maps to `facebook → first_name` and `twitter → name (split by space, index 0)`. When a user authenticates via an external platform, the plugin can populate these streams from the platform's profile data, but only if the stream's `updateIfEmpty` flag is set (so it won't overwrite data the user has already set).

## Stream Types

The plugin ships with a rich set of built-in types, each with its own default access levels, message types, and UI conventions:

**Content types:** `Streams/text` (rich text), `Streams/text/small` (short text with chat), `Streams/image`, `Streams/file`, `Streams/audio`, `Streams/video`, `Streams/pdf`, `Streams/live` (live audio/video).

**Structural types:** `Streams/category` (container for related streams), `Streams/album` (image gallery container), `Streams/participating` (what you're part of), `Streams/search` (search index).

**Social types:** `Streams/chat` (conversation), `Streams/interest` (shared interest), `Streams/greeting` (community welcome), `Streams/topic` (discussion topic), `Streams/question` / `Streams/answer` (Q&A).

**Workflow types:** `Streams/task` (with state machine: unassigned → assigned → accepted → progress → paused → completed → approved), `Streams/tasks` (task list container).

**Identity types:** `Streams/user/profile`, `Streams/access`, `Streams/template`, `Streams/incoming` / `Streams/outgoing` (message channels).

Each type can declare `ephemerals` (which ephemeral payload types it accepts for real-time broadcast), `messages` (which message types can be posted, with descriptions and autosubscribe behavior), `defaults` (initial field values), `syncRelations` (whether relation changes propagate), and `extend` (PHP class mixins for custom behavior).

## Database Schema

### stream

The central content table. Every piece of content in the system — a chat room, a user's first name, an uploaded image, a task — is a row here.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. Owner of the stream. |
| `name` | varbinary(255) | PK. Path-like identifier. |
| `type` | varchar(63) | Stream type (e.g. `Streams/chat`). |
| `title` | varchar(255) | Human-readable title. |
| `icon` | varbinary(255) | Path to icon folder. |
| `content` | varbinary(4095) | Indexable text content. |
| `attributes` | varchar(1023) | JSON object for structured data. |
| `readLevel` | int | Default public read level. |
| `writeLevel` | int | Default public write level. |
| `adminLevel` | int | Default public admin level. |
| `permissions` | varchar(255) | JSON array of permission names. |
| `inheritAccess` | varbinary(255) | JSON array of `[publisherId, streamName]` pairs. |
| `messageCount` | int | Total messages posted. |
| `invitedCount` | int | Number of users invited. |
| `arrivedCount` | int | Number who arrived via invite. |
| `participatingCount` | int | Currently participating. |
| `leftCount` | int | Number who left. |
| `arrivedRatio` | decimal(10,4) | arrivedCount / invitedCount. |
| `joinedRatio` | decimal(10,4) | participatingCount / invitedCount. |
| `closedTime` | timestamp | When the stream was closed, if ever. |
| `fork` | varbinary(4095) | JSON fork provenance chain. |
| `insertedTime` | timestamp | Row creation time. |
| `updatedTime` | timestamp | Last update time. |

### message

Append-only event log per stream.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. Stream owner. |
| `streamName` | varbinary(255) | PK. Stream name. |
| `ordinal` | int unsigned | PK. Monotonic sequence number. |
| `type` | varbinary(255) | Message type. |
| `content` | varchar(1023) | Human-readable content (≤1023 chars). |
| `instructions` | varchar(4092) | Machine-readable JSON payload. |
| `byUserId` | varbinary(31) | Who posted the message. |
| `byClientId` | varbinary(31) | Which socket client posted it. |
| `weight` | decimal(10,4) | Reputation weight. |
| `insertedTime` | timestamp | Server receive time. |
| `sentTime` | timestamp | Client send time. |

### participant

Membership tracking per stream.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. Stream owner. |
| `streamName` | varbinary(255) | PK. Stream name. |
| `userId` | varbinary(31) | PK. The participant. |
| `streamType` | varchar(63) | Cached stream type. |
| `state` | enum | `invited`, `participating`, `left`. |
| `subscribed` | enum | `yes` or `no`. |
| `posted` | enum | Whether user has posted. |
| `extra` | varchar | JSON metadata (via migrations). |
| `insertedTime` | timestamp | When they first appeared. |
| `updatedTime` | timestamp | Last state change. |

### access

Per-user or per-label access grants.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. Stream owner. |
| `streamName` | varbinary(255) | PK. Can end in `/` (type template) or `*` (wildcard). |
| `ofUserId` | varbinary(31) | PK. Specific user, or `""` if using a label. |
| `ofContactLabel` | varbinary(255) | PK. Contact label, or `""` if using a user id. |
| `grantedByUserId` | varbinary(31) | Who created this access row. |
| `readLevel` | int | -1 = ignored, 0–40 = level. |
| `writeLevel` | int | -1 = ignored, 0–40 = level. |
| `adminLevel` | int | -1 = ignored, 0–40 = level. |
| `permissions` | varchar(255) | JSON array of permission names. |

Access rows support template matching: a `streamName` ending in `/` applies to all streams of that type (e.g. `Streams/chat/` matches any chat stream). A `streamName` ending in `*` applies to all streams with that prefix.

### invite

Invite tokens stored on the publisher's shard.

| Column | Type | Purpose |
|---|---|---|
| `token` | varbinary(255) | PK. Random token for the URL. |
| `userId` | varbinary(31) | The invited user (may be empty for open invites). |
| `publisherId` | varbinary(31) | Stream owner. |
| `streamName` | varbinary(255) | Target stream. |
| `invitingUserId` | varbinary(31) | Who sent the invite. |
| `displayName` | varchar(255) | Inviter's name at invite time. |
| `appUrl` | varbinary(255) | Where to redirect on accept. |
| `readLevel` / `writeLevel` / `adminLevel` | int | Access levels to grant. |
| `permissions` | varchar(255) | Permissions to grant. |
| `state` | enum | `pending`, `accepted`, `declined`, `arrived`, `forwarded`, `expired`. |
| `extra` | varchar(1023) | JSON payload for additional data. |
| `expireTime` | timestamp | When the invite expires. |

### invited

Mirror of invite tokens stored on the invitee's shard for fast lookup.

| Column | Type | Purpose |
|---|---|---|
| `userId` | varbinary(31) | The invited user. |
| `token` | varbinary(255) | The invite token. |
| `state` | enum | Mirrors the invite state. |
| `expireTime` | timestamp | When the invite expires. |

### related_to / related_from

The relation graph, split across two tables for shard locality.

**related_to** (owned by the category/parent publisher):

| Column | Type | Purpose |
|---|---|---|
| `toPublisherId` | varbinary(31) | PK. Category owner. |
| `toStreamName` | varbinary(255) | PK. Category stream. |
| `type` | varbinary(255) | PK. Relation type. |
| `fromPublisherId` | varbinary(31) | PK. Member owner. |
| `fromStreamName` | varbinary(255) | PK. Member stream. |
| `weight` | decimal(10,4) | Sort order. |
| `insertedTime` | timestamp | When the relation was created. |

**related_from** mirrors the same data, owned by the member/child publisher.

### subscription

Notification subscription for a user on a stream.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. Stream owner. |
| `streamName` | varbinary(255) | PK. Stream name. |
| `ofUserId` | varbinary(31) | PK. Subscriber. |
| `filter` | varchar(255) | JSON: `{"types": [...], "notifications": N}`. |
| `untilTime` | timestamp | Subscription expiry. |
| `duration` | int | Auto-renew duration in seconds. |

### rule

Delivery rules for notifications.

| Column | Type | Purpose |
|---|---|---|
| `ofUserId` | varbinary(31) | PK. |
| `publisherId` | varbinary(31) | PK. |
| `streamName` | varbinary(255) | PK. |
| `ordinal` | int | PK. Rule priority. |
| `filter` | varchar(255) | JSON: `{"types": [...], "labels": [...]}`. |
| `deliver` | varchar(255) | JSON: channels and modes. |
| `readyTime` | timestamp | DND window — rule inactive before this time. |
| `relevance` | decimal(10,4) | Priority for message display. |

### notification

Notification log per user.

| Column | Type | Purpose |
|---|---|---|
| `userId` | varbinary(31) | PK. Recipient. |
| `insertedTime` | timestamp | PK. |
| `publisherId` | varbinary(31) | Source stream owner. |
| `streamName` | varbinary(255) | Source stream. |
| `type` | varbinary(255) | Message type that triggered it. |
| `viewedTime` | timestamp | When the user viewed the notification. |
| `readTime` | timestamp | When the user read the full content. |
| `comment` | varbinary(255) | Optional display text. |

### avatar

Denormalized user display info, scoped per viewer.

| Column | Type | Purpose |
|---|---|---|
| `toUserId` | varbinary(31) | PK. Who sees this avatar (`""` = public). |
| `publisherId` | varbinary(31) | PK. Whose avatar it is. |
| `username` | varchar(255) | Cached username. |
| `firstName` | varchar(255) | Visible first name. |
| `lastName` | varchar(255) | Visible last name. |
| `icon` | varbinary(255) | Icon path. |

### total

Running message counts by type per stream.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. |
| `streamName` | varbinary(255) | PK. |
| `messageType` | varbinary(255) | PK. |
| `messageCount` | bigint | Count. |

### request

Access request from a user to a stream.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. |
| `streamName` | varbinary(255) | PK. |
| `userId` | varbinary(31) | PK. Requester. |
| `readLevel` / `writeLevel` / `adminLevel` | int | Requested levels. |
| `state` | enum | `pending`, `granted`, `rejected`, `forwarded`, `expired`. |
| `actions` | varchar(255) | JSON array of post-grant actions. |

### task

Extended data for `Streams/task` type streams.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. |
| `streamName` | varbinary(255) | PK. |
| State, progress, items, processed | various | Task tracking fields. |

### state

Integrity verification table — hashes of resource states (files, URLs, streams).

| Column | Type | Purpose |
|---|---|---|
| `hash` | varchar(255) | Hash value. |
| `algorithm` | enum | `sha1`, `sha256`, `sha512`, or HMAC variants. |
| `uri` | varbinary(255) | Resource URI (`file:///`, `https://`, `stream://`). |
| `extra` | varbinary(1023) | Additional metadata. |

### metrics

Per-stream, per-user engagement statistics.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. |
| `streamName` | varbinary(255) | PK. |
| `userId` | varbinary(31) | PK. |
| `metrics` | text | JSON-encoded statistics. |

### workspace

Copy-on-write virtual publisher namespaces.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. Base publisher. |
| `name` | varbinary(15) | PK. Workspace name. |
| `parentName` | varbinary(15) | Parent workspace for nesting. |

### category

Denormalized cache for stream containers.

| Column | Type | Purpose |
|---|---|---|
| `publisherId` | varbinary(31) | PK. |
| `streamName` | varbinary(255) | PK. |
| `relatedTo` | text | JSON snapshot of related streams. |

## Server-Side Architecture

### Plugin Hooks

Streams registers extensive before/after hooks on Qbix and Users events (configured in `plugin.json`). Key hooks include:

**Before Q/objects** — Intercepts invite tokens from URLs, resolves them, auto-logs in invited users, and handles invite acceptance. This is the entry point for the entire invite flow.

**After Users/register** — Creates the user's personal streams (firstName, lastName, icon, invited, participating, etc.) from the `streams.json` config.

**After Users_User/saveExecute** — Syncs user table changes to their corresponding streams (username → `Streams/user/username`, icon → `Streams/user/icon`, etc.) and updates avatars.

**Before Q/responseExtras** — Injects stream-related data into the page response (JavaScript config, preloaded streams, socket setup).

**After Q/image/save and Q/file/save** — Updates stream attributes when images or files are saved as part of a stream.

**After Streams/message/* ** — Type-specific handlers that fire when messages are posted. For example, `Streams/message/Streams/relatedTo` updates relation totals and the category cache.

### Template System

Stream types can have templates — streams whose name ends in `typePrefix/` (e.g. a stream named `Streams/chat/` is a template for all `Streams/chat` streams). Templates provide default field values, subscription configs, and access rows that are automatically applied when creating new streams of that type. Templates can be scoped to a specific publisher or be global (publisherId = `""`).

### Request Handlers

The plugin exposes REST-like handlers under the `Streams/` namespace:

`Streams/stream` — GET/POST/PUT/DELETE for CRUD on streams. `Streams/message` — GET/POST for reading and posting messages. `Streams/related` — GET/POST/PUT/DELETE for managing relations. `Streams/invite` — GET/POST/PUT for creating and managing invitations. `Streams/join`, `Streams/leave` — POST for joining/leaving streams. `Streams/subscribe`, `Streams/unsubscribe` — POST for subscription management. `Streams/access` — GET/PUT/DELETE for managing access rows. `Streams/participant` — GET for querying participants. `Streams/batch` — POST for batching multiple requests. `Streams/search` — GET for full-text search across streams. `Streams/workspace` — POST for creating workspaces. `Streams/fork` — POST for forking streams. `Streams/avatar` — GET for fetching user avatars.

### Batching

The `Streams/batch` handler allows clients to bundle multiple stream, message, and participant queries into a single HTTP request. The client-side `Streams.get()`, `Streams.related()`, and `Streams.Message.get()` methods automatically batch their requests when called in quick succession, reducing round trips.

## Client-Side Architecture

### Streams.js (Core)

The main JavaScript module (`web/js/Streams.js`, ~185KB) provides:

**Fetching and caching** — `Streams.get()` fetches streams by publisherId/name, caches locally, and returns via callback. `Streams.related()` fetches relation graphs. Both support batching.

**Stream construction** — `Streams.Stream.construct()` takes raw server data and returns a live `Stream` object with methods for `join()`, `leave()`, `subscribe()`, `unsubscribe()`, `post()`, `observe()`, `neglect()`, and field access. Construction triggers `Streams.onConstruct` events for type-specific handlers.

**Real-time observation** — `Stream.observe()` opens a socket connection and registers the client for real-time updates. `Stream.neglect()` tears it down.

**Methods** — `Streams.create()`, `Streams.relate()`, `Streams.unrelate()`, `Streams.updateRelation()`, `Streams.invite()` provide the client-side API for write operations.

**Event system** — `Streams.Stream.onMessage(type)`, `Streams.Stream.onFieldChanged(fieldName)`, `Streams.Stream.onRelatedTo()`, etc. provide fine-grained event handlers for building reactive UIs.

### Tools (UI Components)

The plugin ships with a library of Qbix tools (jQuery-based UI components) in `web/js/tools/`:

`chat.js` — Full chat interface with message composition, editing, removal, voting, media attachments, and mentions. `preview.js` — Stream preview cards with icon, title, and contextual actions. `related.js` — Renders lists of related streams with add/remove/reorder. `participants.js` — Participant list with avatars, states, and actions. `access.js` — Access control editor UI. `subscription.js` — Subscription management UI. `avatar.js` — User avatar display with size variants. `inplace.js` — Inline editing for stream title and content. `interests.js` — Interest selection and discovery. `tree.js` — Hierarchical stream browser. `gallery.js` — Image gallery with coverflow. `fileManager.js` — File upload and management. `userChooser.js` — User search and selection. `topic.js`, `task.js`, `question.js` — Type-specific UIs.

Each tool type also has `*/preview.js` and `*/chat.js` variants for rendering in preview and chat contexts.

### Commands System

The `Streams/Commands` module (`classes/Streams/Commands.js` and `classes/Streams/CommandsClassifier.js`) provides natural-language command processing for chat streams. Users can type commands like "create a new stream" or "grant access to Alice", and the classifier routes them to the appropriate handler (`Streams/commands/streamCommand.js`, `Streams/commands/cssUpdate.js`).

The command system uses extraction functions (`extract/duration.js`, `extract/time.js`, `extract/personName.js`, `extract/writeLevel.js`, etc.) to parse structured parameters from natural language input.

### Transcript System

The `TranscriptEmitter` (`classes/Streams/TranscriptEmitter.js`) provides session-scoped event-driven transcript processing. It writes WebVTT files with speaker attribution, ordinal cross-references to the message table, and topic-change markers. This powers live transcription for presentations, meetings, and podcasts — utterances become VTT cues with `<v Speaker>` and `<c.ordinal-N>` tags that link back to the stream's message log.

## Configuration

The main configuration lives in `config/plugin.json` under the `Streams` key:

```json
{
    "Streams": {
        "types": {
            "*": {
                "defaults": { "readLevel": 0, "writeLevel": 0 },
                "messages": { ... },
                "subscriptions": { "filter": { ... } },
                "observersMax": 100,
                "admins": ["Users/owners", "Users/admins"]
            },
            "Streams/chat": {
                "messages": {
                    "Streams/chat/message": { "post": true }
                }
            }
        },
        "invites": {
            "tokens": { "length": 16, "characters": "a-z" },
            "maxPerCall": 100,
            "expires": 86400
        },
        "notifications": {
            "onlyIfAllClientsOffline": true
        },
        "onInsert": {
            "user": ["Streams/contacts", "Streams/labels", ...],
            "person": ["Streams/invited", "Streams/mentioned", ...]
        }
    }
}
```

`Streams.types.*` — Default configuration for all stream types. Type-specific overrides are keyed by the full type name. `Streams.invites` — Token generation, limits, and expiry. `Streams.notifications` — Delivery behavior. `Streams.onInsert` — Which streams to auto-create for new users. `Streams.onUpdate.Users_User` — Field mappings from Users table to user streams. `Streams.rules.deliver` — Default notification delivery channels. `Streams.readLevelOptions` / `writeLevelOptions` / `adminLevelOptions` — Human-readable labels for access level UIs.

## Integration Points

### With Users Plugin

Streams depends on Users and extends it heavily. It hooks into user registration, login, contact management, and label management. The avatar system bridges Streams access control with Users identity. The referral system (`Users_Referred`) connects with stream invites — accepting an invite can award referral points to the inviting user.

### With Metrics Plugin

Streams exposes a `Streams_Metrics` table for per-stream engagement statistics and hooks into the Metrics plugin's visit and hit tracking for attribution on invite flows. The `Streams/metrics` handler and tool provide in-context analytics for stream publishers.

### With App Plugins

Apps build on Streams by defining custom stream types, message types, and relation patterns. The Groups app, for example, uses Streams for communities (category streams), conversations (chat streams), events (topic streams), and member management (participant queries with label-based access). The type system, template system, and hook architecture make it possible to customize behavior at every level without modifying the Streams plugin itself.

## Routes

The plugin registers these URL routes:

| Route | Handler | Purpose |
|---|---|---|
| `s/:publisherId/:streamName[]` | `Streams/stream` | View a stream by publisher and name. |
| `i/:token` | `Streams/invited` | Follow an invite link. |
| `Users/:userId.vcf` | `Streams/vcard` | Export a user's profile as a vCard. |
| `Streams/participating` | `Streams/participating` | List streams the user is participating in. |
| `Q/plugins/Streams/:action` | `Streams/*` | Generic plugin action routing. |