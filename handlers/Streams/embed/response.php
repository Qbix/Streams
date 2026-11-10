<?php

/**
 * Serves a Qbix embed page. Takes a publisherId + streamName in the URL,
 * fetches the stream, loads the pre-sanitized embed source for its type
 * (or the stream itself's attribute), sets a strict CSP, and renders a
 * page that activates the Streams/embed tool with the embed source as
 * state.
 *
 * Embed sources are stored sanitized -- the sanitizer runs at authoring
 * time, not here. This handler trusts the stored string.
 *
 * URL parameters:
 *   publisherId, streamName : identify the stream
 *
 * CSP: no 'unsafe-eval'. Q.Template.bind's safe evaluator runs in default
 * mode here. 'frame-ancestors *' is intentional -- third-party hosting is
 * the point; the per-origin check happens at the bridge layer, not at the
 * frame boundary.
 *
 * @module Streams
 * @class HTTP Streams embed
 * @method response
 */
function Streams_embed_response()
{
    $publisherId = Streams::requestedPublisherId(true);
    $streamName = Streams::requestedName(true);

    $user = Users::loggedInUser();
    $userId = $user ? $user->id : '';

    $streams = Streams::fetch($userId, $publisherId, $streamName);
    if (empty($streams)) {
        throw new Q_Exception_MissingRow(array(
            'table' => 'Stream',
            'criteria' => "{publisherId: '$publisherId', name: '$streamName'}"
        ));
    }
    $stream = reset($streams);
    if (!$stream->testReadLevel('see')) {
        throw new Users_Exception_NotAuthorized();
    }

    $html = Streams_embed_loadSource($stream);
    if ($html === null) {
        throw new Q_Exception("No embed defined for stream type '{$stream->type}'");
    }

    // Phase G: defensive re-sanitize at serve time. The stored HTML was
    // sanitized at save, so this should be a no-op. If the DB has drifted
    // or a bug let unsanitized content through, strict=false silently
    // strips the violation rather than throwing -- the user still gets a
    // working embed, just without the attack vector.
    if (class_exists('Q_Embed_Sanitizer')) {
        $html = Q_Embed_Sanitizer::sanitize($html, array('strict' => false));
    }

    header(
        "Content-Security-Policy: " .
        "default-src 'self'; " .
        "script-src 'self'; " .
        "style-src 'self'; " .
        "img-src 'self' https: data:; " .
        "connect-src 'self' https: wss:; " .
        "object-src 'none'; " .
        "base-uri 'none'; " .
        "form-action 'none'; " .
        "frame-ancestors *;"
    );
    header("Referrer-Policy: no-referrer-when-downgrade");
    header("X-Content-Type-Options: nosniff");

    Q_Response::setToolOptions(array(
        'publisherId' => $stream->publisherId,
        'streamName' => $stream->name,
        'html' => $html
    ));

    return Q::view('Streams/content/embed.php', array(
        'publisherId' => $stream->publisherId,
        'streamName' => $stream->name,
        'title' => $stream->title
    ));
}

/**
 * Resolve the embed source for a stream.
 *
 * Resolution order:
 *   1. $stream->getAttribute('Streams.embed.html') -- per-stream override.
 *   2. Config Streams/embed/types/<stream->type>/html -- per-type default.
 *
 * Both come from Q_Embed_Sanitizer::sanitize() output. If neither is set,
 * returns null and the caller 404s or similar.
 *
 * @method Streams_embed_loadSource
 * @private
 * @param {Streams_Stream} $stream
 * @return {string|null}
 */
function Streams_embed_loadSource(Streams_Stream $stream)
{
    $attr = $stream->getAttribute('Streams.embed.html');
    if (is_string($attr) && $attr !== '') {
        return $attr;
    }
    $byType = Q_Config::get('Streams', 'embed', 'types', $stream->type, 'html', null);
    if (is_string($byType) && $byType !== '') {
        return $byType;
    }
    return null;
}
