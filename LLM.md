# Streams Plugin — LLM Coding Primer

Supplement to the Q Framework primer. Covers streams, messages, relations,
access, invitations, subscriptions, participants, real-time, forking, and
workspaces. Read before writing Streams-related code.

---

## 1. Stream Lifecycle

```php
// Create
$stream = Streams::create($asUserId, $publisherId, 'MyPlugin/thing', array(
    'title'      => 'Title',
    'content'    => 'Description',
    'attributes' => Q::json_encode(array('foo' => 'bar')),
    'readLevel'  => 40,    // messages (public)
    'writeLevel' => 10,    // join
    'adminLevel' => 20     // invite
), array(
    'relate' => array(     // auto-relate to a category
        'publisherId' => $catPubId,
        'streamName'  => $catName,
        'type'        => 'MyPlugin/items',
        'weight'      => time()
    ),
    'skipAccess' => false
));

// Fetch one — these are equivalent:
$stream = Streams::fetchOne($asUserId, $publisherId, $streamName);        // null if missing
$stream = Streams_Stream::fetch($asUserId, $publisherId, $streamName);    // same thing
$stream = Streams::fetchOne($asUserId, $publisherId, $streamName, true);  // throws if missing
// Streams::fetchOne() calls Streams_Stream::fetch() internally — they are aliases.
// Both enforce access control via calculateAccess().

// Fetch or create (idempotent)
$stream = Streams::fetchOneOrCreate($asUserId, $publisherId, $streamName, array(
    'fields' => array('type' => 'MyPlugin/thing', 'title' => 'T')
), $result);
if ($result['created']) { /* first time */ }

// Fetch multiple
$streams = Streams::fetch($asUserId, $publisherId, array($name1, $name2));
// Returns array keyed by stream name, nulls for missing ones

// Update attributes (THE correct way)
$stream->setAttribute('foo', 'bar');
$stream->changed($asUserId);            // saves + posts Streams/changed message + fires hooks
// WRONG: $stream->save() — skips message posting and hooks

// Update fields
$stream->title = 'New Title';
$stream->content = 'Updated';
$stream->changed($asUserId, array('title', 'content'));

// Close
Streams::close($asUserId, $publisherId, $streamName);
// Posts Streams/closed message, sets closedTime

// Reopen a closed stream (clear closedTime to bring it back)
$stream = Streams_Stream::fetch($asUserId, $publisherId, $streamName);
if ($stream && $stream->closedTime) {
    $stream->closedTime = null;
    $stream->save();  // save() is correct here — no Streams::reopen() method exists
}
// Convention: Streams_stream_post handler does this automatically when
// a POST names an existing closed stream — treats creation as reopening.
```

**Naming convention:** `name` always starts with the type prefix:
`type: "MyPlugin/thing"` → `name: "MyPlugin/thing/{id}"`.
If you omit the `name` field, `beforeSave` auto-generates a unique name prefixed with `{type}/Q`:
```php
// Auto-generated name — just omit 'name':
$stream = Streams::create($asUserId, $publisherId, 'MyPlugin/thing', array(
    'title' => 'Title'
));
// $stream->name will be something like "MyPlugin/thing/Qabcdef123"

// Explicit name — set it yourself:
$stream = Streams::create($asUserId, $publisherId, 'MyPlugin/thing', array(
    'name' => 'MyPlugin/thing/my-custom-id',
    'title' => 'Title'
));
```

---

## 2. Messages

```php
// Post a message to a stream
$stream->post($asUserId, array(
    'type'         => 'MyPlugin/thing/updated',
    'content'      => 'Short human-readable text',      // varchar(4095)
    'instructions' => Q::json_encode($machineData)      // varchar(8191)
), true);  // true = skip access check
// Returns Streams_Message. ordinal auto-assigned (never set manually).

// Static post (no stream object needed)
Streams_Message::post($asUserId, $publisherId, $streamName, array(
    'type' => 'MyPlugin/thing/updated',
    'content' => 'Updated'
), true);

// Post to multiple streams at once
Streams_Message::postMessages($asUserId, array(
    $publisherId => array(
        $streamName1 => array('type' => 'Streams/changed'),
        $streamName2 => array('type' => 'Streams/changed')
    )
), true);

// Fetch messages (follows fork chain transparently)
$messages = Streams_Message::fetch($publisherId, $streamName, array(
    'limit'     => 50,
    'ascending' => false,           // newest first
    'type'      => 'Streams/chat/message'  // optional filter
));

// Fetch by ordinal range
$messages = Streams_Message::fetch($publisherId, $streamName, array(
    'ordinalMin' => 10,
    'ordinalMax' => 20
));

// Message totals (count by type)
$total = new Streams_MessageTotal();
$total->publisherId = $publisherId;
$total->streamName = $streamName;
$total->messageType = 'Streams/chat/message';
if ($total->retrieve()) { $count = $total->messageCount; }
```

Built-in message types:
`Streams/created`, `Streams/changed`, `Streams/closed`,
`Streams/joined`, `Streams/left`,
`Streams/relatedTo`, `Streams/relatedFrom`, `Streams/unrelatedTo`,
`Streams/chat/message`, `Streams/chat/edit`, `Streams/chat/remove`,
`Streams/invited`, `Streams/subscribed`, `Streams/forked`.

---

## 3. Relations

```php
// Relate child (from) to parent (to)
Streams::relate(
    $asUserId,
    $toPublisherId, $toStreamName,      // PARENT / category
    'MyPlugin/items',                    // relation type
    $fromPublisherId, $fromStreamName,   // CHILD / member
    array('weight' => time())            // weight for ordering
);

// Unrelate
Streams::unrelate(
    $asUserId,
    $toPublisherId, $toStreamName,
    'MyPlugin/items',
    $fromPublisherId, $fromStreamName
);

// Fetch related (full stream objects + relations)
list($relations, $relatedStreams, $stream) = Streams::related(
    $asUserId,
    $publisherId, $streamName,
    'MyPlugin/items',
    true,                                // isCategory: true → fetch children (from)
    array(
        'limit'     => 50,
        'offset'    => 0,
        'ascending' => false,            // by weight DESC
        'streamsOnly' => false,
        'relationsOnly' => false
    )
);
// $relations: array of Streams_RelatedTo rows
// $relatedStreams: array of Streams_Stream objects keyed "publisherId\tname"
// $stream: the parent stream

// Update relation weight
Streams::updateRelation(
    $asUserId,
    $toPublisherId, $toStreamName,
    'MyPlugin/items',
    $fromPublisherId, $fromStreamName,
    $newWeight,
    1                                    // adjustWeights
);

// Cheap query (no stream fetch, no access check)
$rows = Streams_RelatedTo::select('*')->where(array(
    'toPublisherId' => $publisherId,
    'toStreamName'  => $streamName,
    'type'          => 'MyPlugin/items'
))->orderBy('weight', false)->fetchDbRows();
// Each row: ->fromPublisherId, ->fromStreamName, ->type, ->weight
```

**Direction convention:** `fromStream` = child/member, `toStream` = parent/category.
`isCategory=true` → fetch children. In JS callback: use `this.from` for children.

---

## 4. Relations — JavaScript

```javascript
// CRITICAL: callback is function(errorMessage) — NOT function(err, result)
Q.Streams.related(
    publisherId, streamName,
    'MyPlugin/items',
    true,              // isCategory: true → children
    { limit: 50 },
    function (errorMessage) {
        if (errorMessage) return console.warn(errorMessage);
        var result = this;
        // result.relations — array
        // result.relatedStreams — keyed "publisherId\tstreamName"
        // result.stream — the parent
        Q.each(result.relations, function () {
            var child = this.from;   // isCategory=true → .from
            // this.to → use when isCategory=false
        });
    }
);

// Relate
Q.Streams.relate(publisherId, streamName, relationType,
    fromPublisherId, fromStreamName, callback);

// Unrelate
Q.Streams.unrelate(publisherId, streamName, relationType,
    fromPublisherId, fromStreamName, callback);
```

---

## 5. Access Control

Numeric levels — use string constants when testing:

| Value | Read | Write | Admin |
|-------|------|-------|-------|
| 0 | none | none | none |
| 10 | see | join | tell |
| 13 | — | vote | — |
| 15 | teaser | suggest | share |
| 16 | — | ephemeral | — |
| 18 | — | contribute | — |
| 19 | — | fork | — |
| 20 | relations | post | invite |
| 23 | content | relate | — |
| 25 | fields | relations | — |
| 30 | participants | edit | manage |
| 35 | messages | closePending | — |
| 40 | receipts | close | own |

```php
// Test access (returns bool)
$stream->testReadLevel('content');     // >= 23
$stream->testWriteLevel('post');       // >= 20
$stream->testWriteLevel('relate');     // >= 23
$stream->testWriteLevel('edit');       // >= 30
$stream->testAdminLevel('invite');     // >= 20
$stream->testAdminLevel('manage');     // >= 30
$stream->testAdminLevel('own');        // >= 40
$stream->testPermission('myCustomPerm');

// Get numeric level
$level = $stream->getReadLevel();      // returns int
$level = $stream->getWriteLevel();
$level = $stream->getAdminLevel();

// Grant access to a specific user
$access = new Streams_Access();
$access->publisherId = $publisherId;
$access->streamName = $streamName;
$access->ofUserId = $userId;
$access->readLevel = 40;    // messages
$access->writeLevel = 20;   // post
$access->adminLevel = -1;   // -1 = don't override
$access->grantedByUserId = $grantingUserId;
$access->save(true);

// Grant access to everyone under a label
$access = new Streams_Access();
$access->publisherId = $publisherId;
$access->streamName = $streamName;
$access->ofContactLabel = 'Users/members';
$access->readLevel = 40;
$access->writeLevel = 20;
$access->adminLevel = -1;
$access->save(true);
```

**Access resolution order:** public (stream fields) → contact labels (max across all) → participant → direct (ofUserId) → inherited. Final = max across all sources. `-1` means "no opinion" (ignored in max calculation).

**Templates:** stream with `name = "MyPlugin/thing/"` → default access/fields for all `MyPlugin/thing` streams. `name = "MyPlugin/thing/*"` → mutable access computed at fetch time.

---

## 6. Participants

```php
// Join a stream
Streams::join($asUserId, $publisherId, array($streamName), array(
    'subscribed' => false,    // also subscribe?
    'reason' => 'Joined'
));
// Shortcut on stream object:
$stream->join(array('userId' => $asUserId));

// Leave
Streams::leave($asUserId, $publisherId, array($streamName));
$stream->leave(array('userId' => $asUserId));

// Check participation
$participant = $stream->participant($userId);  // returns Streams_Participant or null
if ($participant && $participant->state === 'participating') { ... }

// participant->state: 'invited' | 'participating' | 'left'  (NOT 'joined')
// participant->subscribed: 'yes' | 'no'
// participant->posted: 'yes' | 'no'
// participant->extra: JSON string

// Fetch all participants
$participants = Streams_Participant::select('*')->where(array(
    'publisherId' => $publisherId,
    'streamName' => $streamName,
    'state' => 'participating'
))->fetchDbRows();

// Get just user IDs
$userIds = Streams_Participant::getUserIds($publisherId, $streamName);

// Filter users by participation
$participating = Streams_Participant::filter(
    $userIds, $publisherId, $streamName, 'participating'
);
```

---

## 7. Subscriptions & Notifications

```php
// Subscribe (auto-joins if needed)
Streams::subscribe($asUserId, $publisherId, array($streamName), array(
    'filter' => array(
        'types' => array('Streams/chat/message', 'Streams/relatedTo'),
        'notifications' => 0
    ),
    'untilTime' => strtotime('+30 days')
));
// Shortcut:
$stream->subscribe(array('userId' => $asUserId));

// Unsubscribe
Streams::unsubscribe($asUserId, $publisherId, array($streamName));

// Check subscription
$sub = $stream->subscription($userId);  // returns Streams_Subscription or null

// Subscription rules (per-user notification delivery config)
// rule.filter: JSON {"types": [...], "labels": [...]}
// rule.deliver: JSON {"to": "default"} or {"email": true, "mobile": true, "devices": true}
// rule.readyTime: DND — rule inactive before this timestamp
```

**Notification pipeline:** Message posted → find subscribed participants → evaluate subscription filter → evaluate delivery rules → dispatch via devices/email/mobile.

Config: `Streams.notifications.onlyIfAllClientsOffline` — suppress push if user has active socket.

---

## 8. Invitations

```php
// Invite users to a stream
$invites = Streams::invite($publisherId, $streamName,
    array(                              // who to invite
        'userId' => array($userId1, $userId2),
        // OR: 'identifier' => array('alice@example.com'),
        // OR: 'label' => 'Users/members',
    ),
    array(
        'readLevel'  => 40,
        'writeLevel' => 20,
        'adminLevel' => 20,
        'appUrl'     => $url,
        'subscribe'  => true
    )
);
// Returns array of Streams_Invite objects

// Accept invite (usually handled by Streams_before_Q_objects)
$invite = Streams_Invite::fromToken($token, true);
$invite->accept(array(
    'subscribe' => true,    // auto-subscribe
    'access'    => true     // upgrade access levels
));

// invite->state: 'pending' | 'accepted' | 'declined' | 'arrived' | 'forwarded' | 'expired'

// Check pending invites for a stream
$invites = Streams_Invite::forStream($publisherId, $streamName, $userId);

// Invite URL
$url = Streams::inviteUrl($token);  // e.g. https://app.example/i/abcdef...

// Request access (reverse of invite — user asks for access)
Streams::request($publisherId, $streamName, array(
    'readLevel' => 40,
    'writeLevel' => 20
));
```

---

## 9. Real-Time (Observe / Neglect / Ephemeral)

```javascript
// Observe a stream (register for socket updates)
Q.Streams.Stream.observe(publisherId, streamName, function () {
    // now receiving real-time messages, field changes, relation updates
});

// Neglect (stop observing)
Q.Streams.Stream.neglect(publisherId, streamName);

// Observe is automatic with Q.Streams.get() unless {dontObserve: true}
Q.Streams.retainWith(tool).get(publisherId, streamName, function () {
    var stream = this;
    // stream is observed + retained for tool lifetime
    // neglect + release happen automatically on tool removal
});

// Listen for messages on a stream
stream.onMessage('MyPlugin/thing/updated').set(function (msg) {
    var inst = JSON.parse(msg.instructions || '{}');
    // msg.ordinal, msg.type, msg.content, msg.byUserId
}, tool);

// Listen for ephemerals on a stream
stream.onEphemeral('MyPlugin/thing/updated').set(function (e) {
    var inst = JSON.parse(msg.instructions || '{}');
    // e.payload, e.type, e.content, e.byUserId
}, tool);

// Field change events
Q.Streams.Stream.onFieldChanged(pubId, name, 'title').set(function (fields) {
    // fields.title = new value
}, tool);

// Attribute change events
Q.Streams.Stream.onUpdated(pubId, name, 'attrName').set(function (attrs) {
    // attrs.attrName = new value
}, tool);
```

```php
// Ephemeral (non-persisted broadcast to observers)
// Requires writeLevel >= 'ephemeral' (16)
// Configured per stream type in "ephemerals" config
// Used for: typing indicators, cursor positions, playback sync
// Sent via socket from client, broadcast to all observers, never stored in DB
```

---

## 10. Forking

```php
// Fork a stream at a specific ordinal
$fork = Streams::fork(
    $asUserId,
    $publisherId, $streamName,   // source stream
    $ordinal,                     // split point
    $toPublisherId,               // destination publisher
    $toStreamName                 // optional — defaults to same name
);
// Requires writeLevel >= 'fork' (19) on source

// Fork copies all fields, sets fork JSON with provenance chain,
// starts messageCount at $ordinal, relates to source via 'Streams/fork',
// inherits access from source, copy-on-write file attachments via symlinks.

// Message fetch on forked stream transparently walks the fork chain:
// messages 0..ordinal-1 from source, ordinal+ from fork
$messages = Streams_Message::fetch($toPublisherId, $toStreamName);
// Returns unified sequence across all ancestors

// Read fork chain
$chain = Streams::forkChain($publisherId, $streamName);
// Returns array of [publisherId, streamName, ordinalMin, ordinalMax, closedTime]
```

---

## 11. Workspaces

```php
// Workspaces are virtual publisher namespaces: "alice~ws2"
// Client passes workspaces[] query parameter for overlay semantics

// Get workspace stack from request
$workspaces = Streams_Workspace::fromRequest();
// Returns array of workspace names, top of stack first

// Build cascade publisherIds
$ids = Streams_Workspace::stackedPublisherIds('alice', array('ws2', 'ws1'));
// Returns ['alice~ws2', 'alice~ws1', 'alice']
// First match wins in SELECT; writes go to topmost workspace

// Create workspace
Streams_Workspace::ensure('ws2', 'ws1');  // ws2 with parent ws1

// Parse workspace from publisherId
$wsName = Streams_Workspace::nameFromPublisherId('alice~ws2');  // 'ws2'
```

---

## 12. User Streams (Auto-Created on Registration)

When a user registers, these streams are created under their publisherId:

| Stream Name | Type | Purpose |
|---|---|---|
| `Streams/user/firstName` | `Streams/text/name` | First name |
| `Streams/user/lastName` | `Streams/text/name` | Last name |
| `Streams/user/username` | `Streams/text/name` | Username |
| `Streams/user/icon` | `Streams/image` | Profile icon |
| `Streams/user/emailAddress` | `Streams/text/emailAddress` | Email (private, readLevel 0) |
| `Streams/user/mobileNumber` | `Streams/text/mobileNumber` | Mobile (private, readLevel 0) |
| `Streams/invited` | `Streams/invited` | Invite notifications |
| `Streams/mentioned` | `Streams/mentioned` | @mention notifications |
| `Streams/participating` | `Streams/participating` | Category of participating streams |
| `Streams/contacts` | `Streams/resource` | Contact management access |
| `Streams/labels` | `Streams/resource` | Label management access |

```php
// Read a user's personal stream
$firstName = Streams::my('Streams/user/firstName', 'content');
// OR:
$stream = Streams::fetchOne($asUserId, $userId, 'Streams/user/firstName', true);
$firstName = $stream->content;

// Sync: Users_User.username ↔ Streams/user/username (bidirectional)
// Config: Streams.onUpdate.Users_User.username = "Streams/user/username"
```

---

## 13. Stream Type Configuration

```json
{
    "Streams": {
        "types": {
            "MyPlugin/thing": {
                "emoji": "🎯",
                "create": true,
                "edit": ["title", "content"],
                "defaults": {
                    "title": "Untitled",
                    "icon": "MyPlugin/thing",
                    "readLevel": 40,
                    "writeLevel": 10,
                    "adminLevel": 20
                },
                "messages": {
                    "MyPlugin/thing/updated": {
                        "description": "Thing was updated",
                        "post": true
                    }
                },
                "ephemerals": {
                    "MyPlugin/typing": {}
                },
                "subscriptions": {
                    "filter": {
                        "types": ["MyPlugin/thing/updated"],
                        "notifications": 0
                    }
                },
                "admins": ["Users/owners", "Users/admins"],
                "canCreate": ["Users/owners", "Users/admins"],
                "participating": ["Streams/participating"],
                "observersMax": 100,
                "extend": ["MyPlugin_Thing"]
            }
        }
    }
}
```

`create` — `true`, `false`, or array of fields settable on create.
`edit` — `true`, `false`, or array of editable fields.
`extend` — PHP class names mixed into the stream (for `beforeSave`, custom methods).
`defaults` — field values for new streams of this type.
`messages` — declare valid message types; `"post": true` allows client-side posting.
`ephemerals` — declare valid ephemeral types for real-time broadcast.
`participating` — which category stream to auto-relate to when user participates.

**User streams config (`streams.json`):**
Plugins and apps declare user-specific streams in files listed under `Streams/userStreams` config. These are merged by `Streams::userStreamsTree()` and define streams that can be created with explicit names (e.g. `Streams/user/firstName`). The `possibleUserStreams` config lists which stream names a user is allowed to set explicitly when creating via the HTTP POST handler — the user must also have `adminLevel >= own` on the template.

---

## 14. Avatars

```php
// Fetch avatar (cached user display info scoped per viewer)
$avatars = Streams_Avatar::fetch($toUserId, array($publisherId1, $publisherId2));
// Returns array of Streams_Avatar objects keyed by publisherId
// Each: ->username, ->firstName, ->lastName, ->icon

// Get display name (convenience)
$name = Streams::displayName($userId, array('short' => true));

// Update avatars (called automatically on access changes)
Streams_Avatar::updateAvatars($publisherId, $accessRows, $streamName);
```

---

## 15. Hooks — Common Patterns

Register in `plugin.json`:
```json
{
    "Q": {
        "handlersAfterEvent": {
            "Streams/create/MyPlugin/thing": ["MyPlugin/after/Streams_create_MyPlugin_thing"],
            "Streams/message/MyPlugin/thing/updated": ["MyPlugin/after/Streams_message_MyPlugin_thing_updated"],
            "Streams/relateTo/MyPlugin/thing": ["MyPlugin/after/Streams_relateTo_MyPlugin_thing"]
        }
    }
}
```

```php
// After stream creation hook
function MyPlugin_after_Streams_create_MyPlugin_thing($params) {
    $stream = $params['stream'];
    $stream->setAttribute('initialized', true);
    $stream->changed($params['asUserId']);
}

// After message posted hook
function MyPlugin_after_Streams_message_MyPlugin_thing_updated($params) {
    $message = $params['message'];
    $stream = $params['stream'];
    $instructions = $message->getAllInstructions();
}

// Before stream save hook (validation)
// File: handlers/MyPlugin/before/Streams_Stream_save_MyPlugin_thing.php
function MyPlugin_before_Streams_Stream_save_MyPlugin_thing($params) {
    $stream = $params['stream'];
    $modifiedFields = $params['modifiedFields'];
    if (empty($modifiedFields['title'])) {
        throw new Q_Exception_RequiredField(array('field' => 'title'));
    }
}
```

---

## 16. syncRelations (Auto-Relations from Attributes)

Stream types can declare that changing certain attributes automatically maintains relations.
Config-driven — no manual `Streams::relate()` calls needed.

```json
{
    "Streams": {
        "types": {
            "MyPlugin/thing": {
                "syncRelations": ["from"],
                "attributes": {
                    "MyPlugin/categories": {
                        "type": "array",
                        "syncRelations": {
                            "toStreamName": "MyPlugin/categories",
                            "relationType": "MyPlugin/category"
                        }
                    },
                    "MyPlugin/tags": {
                        "type": "array",
                        "syncRelations": {
                            "toStreamName": "MyPlugin/tags",
                            "relationType": "attribute/MyPlugin/tags"
                        }
                    }
                }
            }
        }
    }
}
```

When `Safebox/categories` attribute changes on a stream, the framework automatically
computes which relations to add/remove and calls `Streams::relate()`/`Streams::unrelate()`
within a transaction. Relation types follow the pattern `attribute/{name}={value}`.

---

## 17. Client-Side Stream Constructors

```javascript
// Define a constructor for a stream type (like Q.Tool.define for tools)
Q.Streams.define("Chess/game", function (fields) {
    // Set extended fields
    this.fields.moves = fields.moves;

    // Subscribe to messages — update local state to match server
    this.onMessage('Chess/move').set(function (stream, message) {
        stream.moves += "\n" + message.instructions.move;
    }, 'Chess/game');
});

// WRONG: Do NOT add events directly to stream objects
this.onSomething = new Q.Event();  // ← breaks on refresh (new objects replace cached ones)

// Convention: message handlers must "apply the diff" —
// update local state so it matches what a full refresh would return.
```

---

## 18. Common Mistakes

| Wrong | Right |
|-------|-------|
| `$stream->save()` after `setAttribute()` | `$stream->changed($userId)` — saves + posts message + hooks |
| `$stream->fields->name` (in JS) | `stream.fields.name` — no `streamName` property |
| `Streams::related(..., function(err, result){})` (JS) | `function(errorMessage){ var result = this; }` |
| `this.to` when `isCategory=true` (JS) | `this.from` — children are "from" streams |
| Setting `ordinal` manually on messages | Never — auto-assigned by `Streams_Message::post()` |
| `participant->state === 'joined'` | State is `'participating'` (not 'joined') |
| `Streams_Access` with readLevel = 0 to mean "inherit" | Use `-1` for "don't override"; `0` = `none` (actively blocked) |
| Fetching messages without considering fork chain | `Streams_Message::fetch()` handles it transparently |
| Creating streams without type prefix in name | Name must start with type: `MyPlugin/thing/{id}` (or omit name for auto-generation) |
| `$stream->post(...)` without skipAccess on system messages | Pass `true` as third arg for internal/system messages |
| Querying `Streams_RelatedFrom` for category contents | Use `Streams_RelatedTo` — it's on the category publisher's shard |
| Granting access without `grantedByUserId` | Always set — tracks who authorized the access |
| Setting `closedTime` directly + `save()` | Use `Streams::close($asUserId, $pub, $name)` — posts message + hooks |
| Manually relating on attribute change | Use `syncRelations` config — framework auto-maintains relations |
| Adding `new Q.Event()` on stream objects (JS) | Breaks on refresh — use `stream.onMessage()` factory instead |
| Using `Streams::related()` for hot category pages | Use `Streams_Category::getRelatedTo()` for denormalized high-perf index |