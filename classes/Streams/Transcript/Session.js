"use strict";

/**
 * Streams/classes/Streams/Transcript/Session.js
 *
 * Per-socket transcription session state and registry. A session holds a command
 * classifier, a rolling transcript buffer, display-name state, and the view
 * indices a host drives — all Streams concerns — plus slots the AI plugin fills
 * at runtime (the LLM pipeline, the veto queue). Both AI and Media consume the
 * same session, so it lives in Streams.
 *
 * Moved here from AI/classes/AI/Session.js.
 *
 * @class Streams.Transcript.Session
 * @static
 */

var Q       = require('Q');
var Streams = require('Streams');

function Session() {}

/**
 * Active sessions keyed by socket.id.
 * @property all
 * @type {Map}
 * @static
 */
Session.all = new Map();          // socketId → session (current binding)
Session.byToken = new Map();      // sessionToken → session (stable identity)
Session._pendingCleanup = new Map();  // sessionToken → timeout handle

Session.GRACE_MS = 60 * 1000;     // 60s grace before real cleanup

/**
 * Create a new session for a connected socket. Closes any previous
 * session on the same socket before installing the new one.
 *
 * @method create
 * @static
 * @param {Object} client    socket.io client
 * @param {String} userId
 * @param {Object} data      payload from Streams/transcript/session/start
 * @param {Object} Q
 * @return {Object} the new session object
 */
Session.create = function (client, userId, data, Q) {
    var token = (data && data.sessionToken) || Session._generateToken();

    // ── Resume path ──────────────────────────────────────────────
    var existing = Session.byToken.get(token);
    if (existing && existing.userId === userId) {
        // Cancel pending cleanup if any
        var pending = Session._pendingCleanup.get(token);
        if (pending) {
            clearTimeout(pending);
            Session._pendingCleanup.delete(token);
        }
        // Rebind to the new socket
        Session.all.delete(existing.socketId);
        existing.socketId = client.id;
        existing.socket = client;
        Session.all.set(client.id, existing);
        Q.log && Q.log('AI Session resumed', { token: token, userId: userId });
        return existing;
    }

    var lang        = (data && data.lang)        || 'en-US';
    var sampleRate  = (data && data.sampleRate)  || 16000;
    var publisherId = (data && data.publisherId) || null;
    var streamName  = (data && data.streamName)  || null;
    var role        = (data && data.role)        || 'participant';
    var mode        = (data && data.mode)        || 'live';
    var modes = {
        composition:   (data && data.modes && data.modes.composition   !== false),
        navigation:    (data && data.modes && data.modes.navigation    !== false),
        transcription: (data && data.modes && data.modes.transcription !== false)
    };

    var session = {
        userId:           userId,
        socketId:         client.id,
        socket:           client,
        role:             role,
        lang:             lang,
        mode:             mode,
        modes:            modes,
        sampleRate:       sampleRate,
        publisherId:      publisherId,
        streamName:       streamName,
        toolStreamName:   (data && data.toolStreamName)  || null,
        toolPublisherId:  (data && data.toolPublisherId) || userId,
        slideIndex:       0,
        revealIndex:      0,
        zoomScale:        1,
        transcription:    null,
        transcriptBuffer: [],
        transcriptFile:   null,
        _displayNames:    {},
        sessionStartMs:   Date.now(),
        isOwnLivestream:  !!(data && data.isOwnLivestream),
        // The classifier reads its phrase sources by locale; no Q handle threaded in.
        classifier:       new Streams.CommandsClassifier({ locale: lang.split('-')[0] }),
        // Slots filled by the AI plugin at runtime.
        pipeline:         null,
        vetoQueue:        [],
        vetoTimers:       new Map()
    };

    var prev = Session.all.get(client.id);
    if (prev) Session.close(prev);

    Session.all.set(client.id, session);
    Session.byToken.set(token, session);
    session.classifier.locale = lang.split('-')[0];
    session.classifier.reload();
    return session;
};

/**
 * Mark a session as orphaned (socket disconnected) and schedule the
 * finalizer to run after the grace period. If the same sessionToken
 * reconnects in time, cancel the finalizer and rebind the new socket.
 *
 * @param {Object}   session
 * @param {Object}   Q
 * @param {Function} onFinalize  Called once if the grace period expires
 *                               without a reconnect. Receives no args.
 *                               This is where the disconnect handler's
 *                               "real" cleanup (transcript flush, end
 *                               message, sessionEnd event) belongs.
 */
Session.markDisconnected = function (session, Q, onFinalize) {
    if (!session) return;
    Session.all.delete(session.socketId);
    // Keep session in Session.byToken so a reconnect resume can find it.

    if(session.pipeline) session.pipeline.destroy();

    var token = session.sessionToken;
    // Defensive: if a previous markDisconnected was somehow still pending
    // for this token (rapid disconnect/reconnect/disconnect), cancel it
    // before scheduling the new one. Without this, two finalizers race.
    var existing = Session._pendingCleanup.get(token);
    if (existing) clearTimeout(existing);

    var timeout = setTimeout(function () {
        try {
            if (typeof onFinalize === 'function') onFinalize();
        } catch (e) {
            Q && Q.log && Q.log('AI Session finalize error', e && e.message);
        }
        Session.close(session);
        Session.byToken.delete(token);
        Session._pendingCleanup.delete(token);
    }, Session.GRACE_MS);

    Session._pendingCleanup.set(token, timeout);
};

Session._generateToken = function () {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
};

/**
 * Look up the session for a socket.
 * @method get
 * @static
 * @param {String} socketId
 * @return {Object|null}
 */
Session.get = function (socketId) {
    return Session.all.get(socketId) || null;
};

/**
 * Remove a session from the registry without tearing down resources.
 * @method remove
 * @static
 */
Session.remove = function (socketId) {
    Session.all.delete(socketId);
};

/**
 * Close a session: stop transcription, clear timers. The caller removes it from
 * the registry when ready.
 * @method close
 * @static
 * @param {Object} session
 */
Session.close = function (session) {
    if (!session) return;
    if (session.transcription) {
        try { session.transcription.close(); } catch (e) {}
        session.transcription = null;
    }
    if (session.vetoTimers) {
        session.vetoTimers.forEach(function (t) { clearTimeout(t); });
        session.vetoTimers.clear();
    }
};

/**
 * Compute relSec from the session start.
 * @method relSec
 * @static
 * @param {Object} session
 * @return {String}
 */
Session.relSec = function (session) {
    return ((Date.now() - session.sessionStartMs) / 1000).toFixed(1);
};

/**
 * Post a durable message to a session's stream. Fire-and-forget — errors logged.
 * @method postMessage
 * @static
 * @param {Object} Q
 * @param {Object} fields      Streams.Message.post fields
 * @param {Function} [callback]  (err, message)
 */
Session.postMessage = function (Q, fields, callback) {
    try {
        var Streams = Q.require('Streams');
        Streams.Message.post(Object.assign({
            byClientId: '',
            weight: 1
        }, fields), function (err, message) {
            if (err) Q.log && Q.log('Streams.Transcription: message post error', err.message || err);
            if (callback) callback(err, message);
        });
    } catch (e) {
        Q.log && Q.log('Streams.Transcription: postMessage exception', e.message);
        if (callback) callback(e);
    }
};

module.exports = Session;