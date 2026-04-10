/**
 * Typed wrappers for every Streams PHP HTTP action handler.
 * Provides Promise-based access to the full Streams REST API from Node.js.
 *
 * Usage:
 *   var { stream } = await Streams.Actions.createStream(userId, 'Streams/chat', { title: 'My chat' });
 *   await Streams.Actions.relate(catPublisher, catName, 'Streams/topic', publisher, streamName);
 *   await Streams.Actions.join(publisherId, streamName);
 *
 * All methods return Promises resolving to the response slots object.
 * Errors reject with the first error message string.
 *
 * @module Streams
 */
var Q = require('Q');
var Streams = require('Streams');

/**
 * PHP HTTP API wrappers for the Streams plugin.
 * @class Streams.Actions
 * @static
 */
Streams.Actions = {

    // ── Core ──────────────────────────────────────────────────────────────────

    /**
     * Core call. All named methods delegate here.
     * @method call
     * @param {string}   action   Action path e.g. 'Streams/stream'
     * @param {string[]} slots    Response slot names to extract e.g. ['stream']
     * @param {object}   fields   Request params
     * @param {string}   [method='post']
     * @param {object}   [options]  Extra Q.req options (baseUrl, etc.)
     * @return {Promise<object>}  Resolves with slots object, rejects with error string
     */
    call: function (action, slots, fields, method, options) {
        slots  = slots  || [];
        fields = fields || {};
        method = method || 'post';
        options = Q.extend({ method: method, fields: fields }, options);
        return new Q.Promise(function (resolve, reject) {
            Q.req(action, slots, function (err, data) {
                var msg = Q.firstErrorMessage(err, data);
                if (msg) {
                    Q.Streams.onError.handle.call(this, msg, [err, data]);
                    return reject(msg);
                }
                var result = {};
                if (data && data.slots) {
                    for (var i = 0; i < slots.length; i++) {
                        result[slots[i]] = data.slots[slots[i]];
                    }
                }
                resolve(result);
            }, options);
        });
    },

    /**
     * POST to a PHP handler.
     * @method POST
     * @param {string}   action
     * @param {object}   [fields]
     * @param {string[]} [slots]
     * @param {object}   [options]
     * @return {Promise<object>}
     */
    POST: function (action, fields, slots, options) {
        return Streams.Actions.call(action, slots || [], fields, 'post', options);
    },

    /**
     * GET from a PHP handler.
     * @method GET
     * @param {string}   action
     * @param {object}   [fields]
     * @param {string[]} [slots]
     * @param {object}   [options]
     * @return {Promise<object>}
     */
    GET: function (action, fields, slots, options) {
        return Streams.Actions.call(action, slots || [], fields, 'get', options);
    },

    /**
     * PUT to a PHP handler.
     * @method PUT
     * @param {string}   action
     * @param {object}   [fields]
     * @param {string[]} [slots]
     * @param {object}   [options]
     * @return {Promise<object>}
     */
    PUT: function (action, fields, slots, options) {
        return Streams.Actions.call(action, slots || [], fields, 'put', options);
    },

    /**
     * DELETE to a PHP handler.
     * @method DELETE
     * @param {string}   action
     * @param {object}   [fields]
     * @param {string[]} [slots]
     * @param {object}   [options]
     * @return {Promise<object>}
     */
    DELETE: function (action, fields, slots, options) {
        return Streams.Actions.call(action, slots || [], fields, 'delete', options);
    },

    // ── Stream CRUD ───────────────────────────────────────────────────────────

    /**
     * Create a new stream.
     * @method createStream
     * @param {string} publisherId
     * @param {string} type  e.g. 'Streams/chat'
     * @param {object} [fields]
     *   title, content, attributes {object}, icon, file, private, accessProfileName,
     *   notices, dontSubscribe,
     *   Q_Streams_related_publisherId, Q_Streams_related_streamName,
     *   Q_Streams_related_type, Q_Streams_related_weight, Q_Streams_related_inheritAccess
     * @return {Promise<{stream, messageTo, icon}>}
     */
    createStream: function (publisherId, type, fields) {
        return Streams.Actions.POST(
            'Streams/stream',
            Q.extend({ publisherId: publisherId, type: type }, fields),
            ['stream', 'messageTo', 'icon']
        );
    },

    /**
     * Update an existing stream.
     * @method updateStream
     * @param {string} publisherId
     * @param {string} streamName
     * @param {object} fields
     *   title, content, attributes {object — merged as setAttribute calls}, icon, file,
     *   readLevel, writeLevel, adminLevel, permissions, inheritAccess, closedTime
     * @return {Promise<{stream}>}
     */
    updateStream: function (publisherId, streamName, fields) {
        return Streams.Actions.PUT(
            'Streams/stream',
            Q.extend({ publisherId: publisherId, name: streamName }, fields),
            ['stream'],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    /**
     * Close (soft-delete) a stream. A cron job may hard-delete it later.
     * @method closeStream
     * @param {string} publisherId
     * @param {string} streamName
     * @return {Promise<{result}>}
     */
    closeStream: function (publisherId, streamName) {
        return Streams.Actions.DELETE(
            'Streams/stream',
            { publisherId: publisherId, streamName: streamName },
            ['result'],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    // ── Relations ─────────────────────────────────────────────────────────────

    /**
     * Create a relation between two streams.
     * @method relate
     * @param {string}  toPublisherId
     * @param {string}  toStreamName
     * @param {string}  type  relation type
     * @param {string}  fromPublisherId
     * @param {string}  fromStreamName
     * @param {object}  [options]  weight, inheritAccess, exception
     * @return {Promise<{result}>}
     */
    relate: function (toPublisherId, toStreamName, type, fromPublisherId, fromStreamName, options) {
        return Streams.Actions.POST(
            'Streams/related',
            Q.extend({
                toPublisherId:   toPublisherId,
                toStreamName:    toStreamName,
                type:            type,
                fromPublisherId: fromPublisherId,
                fromStreamName:  fromStreamName
            }, options),
            ['result']
        );
    },

    /**
     * Update a relation's weight, or atomically change its type.
     * Pass changeType to retype (preserves weight), weight to reweight, or both.
     * @method updateRelation
     * @param {string}  toPublisherId
     * @param {string}  toStreamName
     * @param {string}  type  current type
     * @param {string}  fromPublisherId
     * @param {string}  fromStreamName
     * @param {object}  fields  weight and/or changeType
     * @return {Promise<{result}>}
     */
    updateRelation: function (toPublisherId, toStreamName, type, fromPublisherId, fromStreamName, fields) {
        return Streams.Actions.PUT(
            'Streams/related',
            Q.extend({
                toPublisherId:   toPublisherId,
                toStreamName:    toStreamName,
                type:            type,
                fromPublisherId: fromPublisherId,
                fromStreamName:  fromStreamName
            }, fields),
            ['result']
        );
    },

    /**
     * Remove a relation between two streams.
     * @method unrelate
     * @param {string}  toPublisherId
     * @param {string}  toStreamName
     * @param {string}  type
     * @param {string}  fromPublisherId
     * @param {string}  fromStreamName
     * @return {Promise<{result}>}
     */
    unrelate: function (toPublisherId, toStreamName, type, fromPublisherId, fromStreamName) {
        return Streams.Actions.DELETE(
            'Streams/related',
            {
                toPublisherId:   toPublisherId,
                toStreamName:    toStreamName,
                type:            type,
                fromPublisherId: fromPublisherId,
                fromStreamName:  fromStreamName
            },
            ['result']
        );
    },

    // ── Messaging ─────────────────────────────────────────────────────────────

    /**
     * Post a message to a stream.
     * @method postMessage
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {string}  type  message type e.g. 'Streams/chat/message'
     * @param {object}  [fields]  content, instructions, weight, dontSubscribe
     * @return {Promise<{message, messages}>}
     */
    postMessage: function (publisherId, streamName, type, fields) {
        return Streams.Actions.POST(
            'Streams/message',
            Q.extend({ publisherId: publisherId, streamName: streamName, type: type }, fields),
            ['message', 'messages'],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    // ── Participation ─────────────────────────────────────────────────────────

    /**
     * Join a stream as a participant to receive real-time socket events.
     * @method join
     * @param {string}  publisherId
     * @param {string}  streamName
     * @return {Promise<{participant}>}
     */
    join: function (publisherId, streamName) {
        return Streams.Actions.POST(
            'Streams/join',
            { publisherId: publisherId, streamName: streamName },
            ['participant'],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    /**
     * Leave a stream you previously joined.
     * @method leave
     * @param {string}  publisherId
     * @param {string}  streamName
     * @return {Promise<{participant}>}
     */
    leave: function (publisherId, streamName) {
        return Streams.Actions.POST(
            'Streams/leave',
            { publisherId: publisherId, streamName: streamName },
            ['participant'],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    /**
     * Subscribe to a stream for offline notifications.
     * @method subscribe
     * @param {string}  publisherId
     * @param {string}  streamName
     * @return {Promise<{participant}>}
     */
    subscribe: function (publisherId, streamName) {
        return Streams.Actions.POST(
            'Streams/subscribe',
            { publisherId: publisherId, streamName: streamName },
            ['participant'],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    /**
     * Unsubscribe from a stream's offline notifications.
     * @method unsubscribe
     * @param {string}  publisherId
     * @param {string}  streamName
     * @return {Promise<{}>}
     */
    unsubscribe: function (publisherId, streamName) {
        return Streams.Actions.POST(
            'Streams/unsubscribe',
            { publisherId: publisherId, streamName: streamName },
            [],
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    },

    // ── Access Control ────────────────────────────────────────────────────────

    /**
     * Grant or update access for a user or contact label on a stream.
     * Pass ofUserId or ofContactLabel (or neither to set stream-level defaults).
     * @method setAccess
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  fields
     *   ofUserId or ofContactLabel,
     *   readLevel, writeLevel, adminLevel, permissions, filter, grantedByUserId
     * @return {Promise<{access}>}
     */
    setAccess: function (publisherId, streamName, fields) {
        return Streams.Actions.PUT(
            'Streams/access',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            ['access']
        );
    },

    /**
     * Remove access for a user or contact label on a stream.
     * @method removeAccess
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  fields  ofUserId or ofContactLabel (one required)
     * @return {Promise<{}>}
     */
    removeAccess: function (publisherId, streamName, fields) {
        return Streams.Actions.DELETE(
            'Streams/access',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            []
        );
    },

    // ── Invitations ───────────────────────────────────────────────────────────

    /**
     * Invite one or more users (or future users) to a stream.
     * @method invite
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  fields
     *   userId|xid|identifier|label (one or more),
     *   platform, token, appUrl, followup,
     *   readLevel, writeLevel, adminLevel,
     *   addLabel, addMyLabel, expireTime, alwaysSend
     * @return {Promise<{invite, userIds, statuses, identifierTypes, alreadyParticipating}>}
     */
    invite: function (publisherId, streamName, fields) {
        return Streams.Actions.POST(
            'Streams/invite',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            ['invite', 'userIds', 'statuses', 'identifierTypes', 'alreadyParticipating']
        );
    },

    /**
     * Accept a pending invite using its token.
     * @method acceptInvite
     * @param {string}  token
     * @return {Promise<{}>}
     */
    acceptInvite: function (token) {
        return Streams.Actions.PUT('Streams/invite', { token: token }, []);
    },

    // ── Forking & Workspaces ──────────────────────────────────────────────────

    /**
     * Fork a stream, creating a divergent copy in a workspace.
     * @method fork
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  [fields]  workspaceId and any fields to override in the fork
     * @return {Promise<{stream}>}
     */
    fork: function (publisherId, streamName, fields) {
        return Streams.Actions.POST(
            'Streams/fork',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            ['stream']
        );
    },

    /**
     * Create a workspace stream.
     * @method createWorkspace
     * @param {object}  fields  publisherId, workspaceId, plus any stream fields
     * @return {Promise<{stream}>}
     */
    createWorkspace: function (fields) {
        return Streams.Actions.POST('Streams/workspace', fields, ['stream']);
    },

    // ── Attributes Lock ───────────────────────────────────────────────────────

    /**
     * Atomically read-modify-write one or more stream attributes.
     * Prevents lost updates when multiple clients modify attributes concurrently.
     * @method lockAttributes
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  fields  attribute keys/values to update under lock
     * @return {Promise<{result}>}
     */
    lockAttributes: function (publisherId, streamName, fields) {
        return Streams.Actions.POST(
            'Streams/attributesLock',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            ['result']
        );
    },

    // ── Answer ────────────────────────────────────────────────────────────────

    /**
     * Post an answer to a Streams/question stream.
     * @method answer
     * @param {string}  publisherId
     * @param {string}  streamName  the question stream name
     * @param {object}  fields  content, plus any answer fields
     * @return {Promise<{stream}>}
     */
    answer: function (publisherId, streamName, fields) {
        return Streams.Actions.PUT(
            'Streams/answer',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            ['stream']
        );
    },

    // ── Avatars ───────────────────────────────────────────────────────────────

    /**
     * Fetch one or more user avatars.
     * @method avatar
     * @param {string|string[]}  userIds  single userId or array; or pass prefix for prefix search
     * @param {object}  [fields]  prefix, limit, offset, public, communities, platform
     * @return {Promise<{avatars}>}
     */
    avatar: function (userIds, fields) {
        return Streams.Actions.GET(
            'Streams/avatar',
            Q.extend({ userIds: userIds }, fields),
            ['avatars']
        );
    },

    // ── Promote ───────────────────────────────────────────────────────────────

    /**
     * Promote a participant to a higher admin/write/read level.
     * @method promote
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {string}  userId  user to promote
     * @param {object}  [fields]  adminLevel, writeLevel, readLevel
     * @return {Promise<{participant}>}
     */
    promote: function (publisherId, streamName, userId, fields) {
        return Streams.Actions.POST(
            'Streams/promote',
            Q.extend({ publisherId: publisherId, streamName: streamName, userId: userId }, fields),
            ['participant']
        );
    },

    // ── Interests ─────────────────────────────────────────────────────────────

    /**
     * Add an interest stream for the logged-in user.
     * @method addInterest
     * @param {string}  title
     * @param {object}  [fields]  publisherId, subscribe
     * @return {Promise<{publisherId, streamName}>}
     */
    addInterest: function (title, fields) {
        return Streams.Actions.POST(
            'Streams/interest',
            Q.extend({ title: title }, fields),
            ['publisherId', 'streamName']
        );
    },

    /**
     * Remove an interest stream for the logged-in user.
     * @method removeInterest
     * @param {string}  title
     * @param {object}  [fields]  publisherId
     * @return {Promise<{publisherId, streamName}>}
     */
    removeInterest: function (title, fields) {
        return Streams.Actions.DELETE(
            'Streams/interest',
            Q.extend({ title: title }, fields),
            ['publisherId', 'streamName']
        );
    },

    // ── Subscription ─────────────────────────────────────────────────────────

    /**
     * Update subscription settings for a stream (notification rules, delivery, etc).
     * @method updateSubscription
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  fields  filter, deliver, receive, notifications, etc.
     * @return {Promise<{}>}
     */
    updateSubscription: function (publisherId, streamName, fields) {
        return Streams.Actions.PUT(
            'Streams/subscription',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            []
        );
    },

    // ── Basic (user profile fields) ───────────────────────────────────────────

    /**
     * Update the logged-in user's basic profile streams (firstName, lastName, username).
     * @method updateBasic
     * @param {object}  fields  fullName or firstName + lastName, username
     * @return {Promise<{}>}
     */
    updateBasic: function (fields) {
        return Streams.Actions.POST('Streams/basic', fields, []);
    },

    // ── Metrics ───────────────────────────────────────────────────────────────

    /**
     * Post viewing/engagement metrics for a stream.
     * @method postMetrics
     * @param {string}   publisherId
     * @param {string}   streamName
     * @param {Array}    metrics     Array of [start, end?] timestamp pairs
     * @param {number}   [minPeriod=2]
     * @return {Promise<{}>}
     */
    postMetrics: function (publisherId, streamName, metrics, minPeriod) {
        return Streams.Actions.POST(
            'Streams/metrics',
            {
                publisherId: publisherId,
                streamName:  streamName,
                metrics:     JSON.stringify(metrics),
                minPeriod:   minPeriod || 2
            },
            []
        );
    },

    // ── File & Image uploads ──────────────────────────────────────────────────

    /**
     * Upload a file to attach to a stream.
     * @method uploadFile
     * @param {string}  publisherId
     * @param {string}  type  stream type to create
     * @param {object}  fields  file (base64 data URI or FormData fields), title, etc.
     * @return {Promise<{stream, file}>}
     */
    uploadFile: function (publisherId, type, fields) {
        return Streams.Actions.POST(
            'Streams/file',
            Q.extend({ publisherId: publisherId, type: type }, fields),
            ['stream', 'file']
        );
    },

    /**
     * Upload audio for a stream.
     * @method uploadAudio
     * @param {string}  publisherId
     * @param {object}  fields  audio data, duration, stream type, etc.
     * @return {Promise<{stream}>}
     */
    uploadAudio: function (publisherId, fields) {
        return Streams.Actions.POST(
            'Streams/audio',
            Q.extend({ publisherId: publisherId }, fields),
            ['stream']
        );
    },

    /**
     * Upload a video for a stream.
     * @method uploadVideo
     * @param {string}  publisherId
     * @param {object}  fields  video data, stream type, etc.
     * @return {Promise<{stream}>}
     */
    uploadVideo: function (publisherId, fields) {
        return Streams.Actions.POST(
            'Streams/video',
            Q.extend({ publisherId: publisherId }, fields),
            ['stream']
        );
    },

    /**
     * Upload HTML/rich content for a stream via Froala editor.
     * @method uploadFroala
     * @param {string}  publisherId
     * @param {string}  streamName
     * @param {object}  fields  content, etc.
     * @return {Promise<{stream}>}
     */
    uploadFroala: function (publisherId, streamName, fields) {
        return Streams.Actions.POST(
            'Streams/froala',
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            ['stream']
        );
    },

    // ── Batch (for advanced use) ──────────────────────────────────────────────

    /**
     * Returns the Q.batcher-wrapped function for a given baseUrl and action.
     * Prefer using Q.Streams.get / Q.Streams.related for normal stream fetching —
     * those already use the batch system internally.
     * Use this only when you need direct access to a custom batch endpoint.
     * @method batchFunction
     * @param {string}  baseUrl
     * @param {string}  [action='batch']
     * @return {Function}  a Q.batcher-wrapped function
     */
    batchFunction: function (baseUrl, action) {
        return Streams.batchFunction(baseUrl, action || 'batch');
    },

    // ── Low-level helper ──────────────────────────────────────────────────────

    /**
     * Call any PHP handler routed to the node closest to a given stream.
     * Uses Q.baseUrl routing so the request hits the right server in
     * multi-node Qbix deployments.
     * @method forStream
     * @param {string}   action
     * @param {string}   publisherId
     * @param {string}   streamName
     * @param {object}   [fields]
     * @param {string[]} [slots]
     * @param {string}   [method='post']
     * @return {Promise<object>}
     */
    forStream: function (action, publisherId, streamName, fields, slots, method) {
        return Streams.Actions.call(
            action,
            slots  || [],
            Q.extend({ publisherId: publisherId, streamName: streamName }, fields),
            method || 'post',
            { baseUrl: Q.baseUrl({ publisherId: publisherId, streamName: streamName }) }
        );
    }

};

module.exports = Streams.Actions;