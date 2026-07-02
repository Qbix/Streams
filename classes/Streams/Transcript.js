"use strict";

/**
 * Streams/classes/Streams/Transcript.js
 *
 * The Streams side of transcript ingestion. Everything here is general to a
 * streamed, spoken conversation — none of it is specific to a Media
 * presentation. One static entry point, Streams.Transcript.process, takes a
 * final utterance from any source (browser WebSpeech, a Deepgram adapter, typed
 * text) and does the work that belongs to Streams: buffer it, resolve the
 * speaker's display name, run the command classifier and the entity (NER) pass,
 * write the durable Streams/transcript record and its VTT cue, post the
 * chat-style copy, and fan the final utterance out to the speaker's other
 * devices.
 *
 * It returns what the AI layer needs to decide what to do next — whether the
 * utterance was a control command, the entry itself, and the message ordinal —
 * and knows nothing about the LLM pipeline. AI.Transcript wraps this and adds
 * the pipeline; a transcription-only deployment can call this directly.
 *
 * @class Streams.Transcript
 * @static
 */

var Q               = require('Q');
var Session         = Q.require('Streams/Transcript/Session');  // session bag, now in Streams
var StreamProxy     = Q.require('Streams/StreamProxy');            // server-side stream stand-in for ephemerals
var transcriptEmitter = Q.require('Streams/TranscriptEmitter').transcriptEmitter;

function Transcript() {}

// 'processed' (session, result, Q, Users) fires after every final utterance is
// ingested. result is { isControl, entry, ordinal }.
Q.makeEventEmitter(Transcript);

/**
 * Process the Streams side of one final transcript chunk.
 *
 * @method process
 * @static
 * @param {Object} session
 * @param {Object} chunk    { transcript, isFinal, confidence, speaker }
 * @param {Object} Q
 * @param {Object} Users
 * @return {Promise<Object|null>} { isControl, entry, ordinal } — or null when the
 *   chunk is interim/empty and nothing was done.
 */
Transcript.process = async function (session, chunk, Q, Users) {
    if (!chunk.transcript || !chunk.transcript.trim()) return null;

    var text = chunk.transcript.trim();
    var entry = {
        text:    text,
        ts:      Date.now(),
        relSec:  Session.relSec(session),
        speaker: chunk.speaker || session.userId,
        isFinal: chunk.isFinal,
        latestFinalAt: chunk.latestFinalAt,
        payload: chunk.payload
    };
    
    if(session.transcriptBufferMap.has(chunk.latestFinalAt)) {
        let entryToUpdate = session.transcriptBufferMap.get(chunk.latestFinalAt);
        if(entryToUpdate.isWakeUp && session.wakeState != 'listening') {
            //console.log('Transcript: handle ended wake')
            if(entryToUpdate.wakeUpTextLength == null) {
                entryToUpdate.wakeUpTextLength = entryToUpdate.text ? entryToUpdate.text.length : 0;
            }
            if(entryToUpdate.isWakeUpStartEntry && entryToUpdate.isWakeUpEndEntry) {
                //console.log('Transcript: handle ended wake 1')
                entryToUpdate.text = text.slice(entryToUpdate.wakeUpTextLength);
            } else if (entryToUpdate.isWakeUpEndEntry) {
                //console.log('Transcript: handle ended wake 2')
                entryToUpdate.text = text.slice(entryToUpdate.wakeUpTextLength);
            } else if (entryToUpdate.isWakeUpStartEntry) {
                //console.log('Transcript: handle ended wake 3')
                entryToUpdate.text = text.slice(entryToUpdate.wakeUpTextLength);
            } 
        } else if (entryToUpdate.isWakeUp && session.wakeState == 'listening' && entryToUpdate.wakeUpTextLength != null) {
            entryToUpdate.text = text.slice(entryToUpdate.wakeUpTextLength);
        } else {
            entryToUpdate.text = text;
        }
       
        entry = entryToUpdate;
        if(chunk.isFinal) entryToUpdate.isFinal = true;
    } else {
        session.transcriptBufferMap.set(chunk.latestFinalAt, entry)
        session.transcriptBuffer.push(entry);
    }
    
    /* if (session.transcriptBuffer.length > 8) {
        session.transcriptBuffer.shift();
    } */

    // The browser enriches the utterance with what only it has: the PDF page
    // corpus it already rendered, and the slide it is on. Stash both so the
    // classifier's slideNavigate can match against the slides without re-parsing.
    if (chunk.pdf && chunk.pdf.pages) { session.pdfPages = chunk.pdf.pages; }
    if (chunk.slideIndex != null) { session.slideIndex = chunk.slideIndex; }

    Transcript._resolveDisplayName(session, entry.speaker, Q);

    // Rolling context — catches a control command split across chunks
    // ("go to the … roadmap slide").
    var recent3 = session.transcriptBuffer.slice(-3).map(function (e) {
        return e.text;
    }).join(' ');

    // 1) Classifier, then NER — host-driven, instant, zero LLM cost. Runs first
    //    so the control flag is known when we write the durable record and cue.
    var isControl = false;
    if (session.role === 'host' && session.modes.navigation !== false && entry.isFinal && text.length <= 25) {
        var state = Transcript._classifyState(session, Q, Users);
        state.entry = entry;
        var proxy = session.publisherId ? StreamProxy.make(session, Q, Users) : null;
        if (proxy) {
            // classify() is async — await it. A command is handled here and skips
            // both the NER pass and the LLM pipeline.
            /* var handled = await session.classifier.classify(recent3, proxy, state);
            if (handled) {
                isControl = true;
            } else {
                // Plain narration — let the entity pass surface avatars and
                // streams the speaker named, without consuming the utterance.
                try {
                    await session.classifier.recognize(entry.text, proxy, state);
                } catch (e) {
                    Q.log && Q.log('Streams.Transcript: recognize error', e && e.message);
                }
            } */



            // Pass 1: match against the current chunk alone. This is the
            // common case — a clean single-utterance command like
            // "next slide" or "zoom in". No buffer contamination possible.
            if (await session.classifier.classify(text, proxy, state)) {
                isControl = true;
            } else if (session.transcriptBuffer.length > 1) {
                // Pass 2: rolling-context fallback for multi-chunk commands
                // where the parameter arrives in a later isFinal=true chunk
                // than the trigger verb. Restricted to capture-needing
                // intents so simple commands can't match stale buffer
                // entries (the "previous slide" → matched lingering
                // "next slide" bug).
                var recent3 = session.transcriptBuffer
                    .slice(-3)
                    .map(function (e) { return e.text; })
                    .join(' ');
                if (recent3 !== text &&
                    await session.classifier.classify(recent3, proxy, state)) {
                    isControl = true;
                }
            } else {
                // Plain narration — let the entity pass surface avatars and
                // streams the speaker named, without consuming the utterance.
                try {
                    await session.classifier.recognize(entry.text, proxy, state);
                } catch (e) {
                    Q.log && Q.log('Streams.Transcript: recognize error', e && e.message);
                }
            }
        }
    }

    // 2) Durable Streams/transcript message + VTT cue. Await the post so the
    //    ordinal is known; the cue and (in AI) the TTS audio key off it.
    var ordinal = null;
    if (session.publisherId && session.streamName) {
        ordinal = await new Promise(function (resolve) {
            Session.postMessage(Q, {
                publisherId:  session.publisherId,
                streamName:   session.streamName,
                byUserId:     entry.speaker || session.userId,
                type:         'Streams/transcript',
                content:      entry.text,
                instructions: JSON.stringify({
                    speaker:    entry.speaker || session.userId,
                    relSec:     entry.relSec,
                    isFinal:    true,
                    confidence: chunk.confidence || 1,
                    control:    isControl || undefined
                })
            }, function (err, message) {
                resolve((!err && message) ? message.fields.ordinal : null);
            });
        });
        transcriptEmitter.emitChunk(session, entry, ordinal, { control: isControl });
    } else {
        transcriptEmitter.emitChunk(session, entry, null, { control: isControl });
    }

    // 4) Fan the final utterance out to the speaker's other devices.
    Users.Socket.emitToUser(session.userId, 'Streams/utterance', {
        transcript: entry.text,
        isFinal:    true,
        confidence: chunk.confidence,
        speaker:    entry.speaker,
        relSec:     entry.relSec
    });

    var result = { isControl: isControl, entry: entry, ordinal: ordinal };

    // Higher layers (AI runs its pipeline, Media could react) subscribe here.
    // emit is synchronous, so this runs their handlers inline; they fire-and-
    // forget their own async work.
    Transcript.emit('processed', session, result, Q, Users);

    return result;
};

/**
 * Build the state object the classifier and the NER pass read. Carries the
 * presentation identity, the host's view indices, and a full session reference
 * for command handlers that need session-internal fields. CommandsClassifier
 * itself ignores session; only handlers reach in via state.session.
 *
 * @method _classifyState
 * @private
 * @static
 */
Transcript._classifyState = function (session, Q, Users) {
    return {
        slideIndex:      session.slideIndex,
        revealIndex:     session.revealIndex,
        zoomScale:       session.zoomScale,
        userId:          session.userId,
        publisherId:     session.publisherId,
        streamName:      session.streamName,
        toolStreamName:  session.toolStreamName || null,
        toolPublisherId: session.userId,
        session:         session,
        sessionStartMs:  session.sessionStartMs,
        Q:               Q,
        Users:           Users
    };
};

/**
 * Resolve and cache a speaker's display name for the VTT <v> tag. Direct DB
 * query — the same shape as PHP Streams_Avatar::fetch with the user's own
 * publisherId. The TranscriptEmitter only reads session._displayNames; the
 * resolution is orchestration, so it lives here rather than in the emitter.
 *
 * @method _resolveDisplayName
 * @private
 * @static
 */
Transcript._resolveDisplayName = function (session, speakerUserId, Q) {
    if (!speakerUserId || !session._displayNames) return;
    if (speakerUserId in session._displayNames) return;
    // Placeholder prevents duplicate fetches under concurrent utterances.
    session._displayNames[speakerUserId] = speakerUserId;
    try {
        var Streams = Q.require('Streams');
        var Avatar  = Streams && Streams.Avatar;
        if (Avatar && Avatar.SELECT) {
            Avatar.SELECT('*')
                .where({ toUserId: ['', speakerUserId], publisherId: speakerUserId })
                .limit(1)
                .execute(function (err, rows) {
                    if (err || !rows || !rows.length) return;
                    var f = rows[0].fields;
                    var name = [f.firstName, f.lastName].filter(Boolean).join(' ').trim()
                            || f.username || speakerUserId;
                    if (name && session._displayNames) {
                        session._displayNames[speakerUserId] = name;
                    }
                });
        }
    } catch (e) {
        // Streams.Avatar not available — the userId stays as the fallback name.
    }
};

module.exports = Transcript;