"use strict";

/**
 * Streams/handlers/Streams/commands/streamCommand.js
 *
 * Handles voice/text commands that create streams or modify access control.
 * Loaded into Q.handlers.Streams.commands.streamCommand and registered in config
 * under the Streams group:
 *
 *   Streams/commands/Streams/stream/create       : { handler: "Streams/commands/streamCommand", routing: "immediate" }
 *   Streams/commands/Streams/stream/grantAccess  : { handler: "Streams/commands/streamCommand", routing: "immediate" }
 *   Streams/commands/Streams/stream/revokeAccess : { handler: "Streams/commands/streamCommand", routing: "immediate" }
 *
 * FLOW
 * ----
 *  1. CommandsClassifier captures the command + a display name ("Robert") and
 *     dispatches here via the stream/ branch of _emit, which passes a normalized
 *     params object (command stripped to create|grantAccess|revokeAccess).
 *  2. Node resolves the display name -> userId via Streams.Avatar.fetchByPrefix
 *     (native static method, direct DB query — no PHP roundtrip).
 *  3. Node posts an immediate ack message to the chat via Streams.Message.post().
 *  4. Node calls Q.Utils.sendToPHP('Streams/command') — the PHP response handler
 *     (Streams/handlers/Streams/command/response/content.php) runs the privileged
 *     op (Streams::create, Streams_Access::save, ...) as asUserId, posts the
 *     result message to chat, and returns the result in slots.
 *
 * Node->PHP calls use Q.Utils.sendToPHP(), which signs the payload with the
 * internal secret; PHP verifies via Q_Utils::verifyInternal() in the handler.
 *
 * @module Streams
 * @class Streams.commands.streamCommand
 * @param {Object}   params
 *   @param {String} params.command         'create' | 'grantAccess' | 'revokeAccess'
 *   @param {String} params.userId          asUserId performing the action
 *   @param {String} params.publisherId     presentation stream publisherId
 *   @param {String} params.streamName      presentation stream streamName
 *   @param {String} params.chatStreamName  Streams/chat backing stream
 *   @param {String} [params.targetName]    raw display name from capture ("Robert")
 *   @param {String} [params.writeLevel]    'post' | 'ephemeral' | 'contribute'
 *   @param {String} [params.toolTitle]     for the create command
 * @param {Object}   Q          server-side Q (has Q.Utils.sendToPHP)
 * @param {Object}   Users      Users module
 * @param {Function} [callback] (err, result) called on completion
 */

module.exports = async function streamCommand(params, Q, Users, callback) {
    callback = callback || function () {};
    var p = params || {};
    var command        = p.command;
    var userId         = p.userId;
    var publisherId    = p.publisherId;
    var streamName     = p.streamName;
    var chatStreamName = p.chatStreamName;
    var targetName     = p.targetName;
    var writeLevel     = p.writeLevel;
    var toolTitle      = p.toolTitle;

    if (!userId || !chatStreamName) {
        return callback(null, { handled: false });
    }

    var Streams = Q.require('Streams');

    // -- Step 1: resolve display name -> userId via Streams.Avatar.fetchByPrefix --
    var targetUserId  = p.targetUserId || '';
    var targetDisplay = targetName || targetUserId;

    if (targetName && !targetUserId) {
        try {
            var avatars = await new Promise(function (resolve, reject) {
                Streams.Avatar.fetchByPrefix(
                    userId, targetName, { limit: 1 },
                    function (err, rows) { err ? reject(err) : resolve(rows); }
                );
            });
            var firstId = Object.keys(avatars)[0];
            if (firstId) {
                targetUserId  = firstId;
                var row       = avatars[firstId].fields;
                targetDisplay = [row.firstName, row.lastName].filter(Boolean).join(' ').trim()
                             || row.username || targetName;
            }
        } catch (e) {
            Q.log && Q.log('Streams/streamCommand: avatar lookup failed', e.message);
        }
    }

    // -- Step 2: post immediate acknowledgment to chat --
    var ackText = {
        'create':       'Creating "' + (toolTitle || 'tool') + '" stream…',
        'grantAccess':  'Granting ' + targetDisplay + ' access to post…',
        'revokeAccess': 'Removing access for ' + targetDisplay + '…'
    }[command] || 'Processing…';

    await _postMessage(Streams, {
        publisherId: userId,
        streamName:  chatStreamName,
        byUserId:    userId,
        type:        'Streams/command/ack',
        content:     ackText
    });

    // -- Step 3: execute the privileged op via the Streams/command PHP handler --
    try {
        var result = await Q.Utils.sendToPHP('Streams/command', {
            command:         command,
            asUserId:        userId,
            publisherId:     publisherId,
            streamName:      streamName,
            chatPublisherId: userId,
            chatStreamName:  chatStreamName,
            targetUserId:    targetUserId,
            targetDisplay:   targetDisplay,
            writeLevel:      writeLevel || 'post',
            toolTitle:       toolTitle  || 'Tool'
        });
        return callback(null, { handled: true, result: result });
    } catch (e) {
        Q.log && Q.log('Streams/streamCommand: PHP error', e.message);
        await _postMessage(Streams, {
            publisherId: userId,
            streamName:  chatStreamName,
            byUserId:    userId,
            type:        'Streams/command/error',
            content:     e.message || 'Command failed'
        });
        return callback(e);
    }
};

function _postMessage(Streams, fields) {
    return new Promise(function (resolve) {
        try {
            Streams.Message.post(fields, function () { resolve(); });
        } catch (e) { resolve(); }
    });
}