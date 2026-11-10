(function (Q, $) {

/**
 * @module Streams-tools
 */

/**
 * Qbix embed wrapping tool. Takes a sanitized embed-source string, binds it
 * against a scoped page object built from a stream the embed is "for", and
 * renders inside a Q/lazyload region. The embed source is validated at save
 * time by Q_Embed_Sanitizer, so this tool trusts the string it receives but
 * still runs through the restricted-grammar evaluator (Q.Template.bind's
 * default) and the embedTemplates gate on Q/if and Q/each.
 *
 * The scope ("page.*") this tool exposes is intentionally small -- only
 * documented fields reach the embed. Add fields here when a vocabulary
 * entry needs them; a field not in the scope cannot be referenced from
 * the embed source because the restricted evaluator throws on unknown
 * roots.
 *
 * @class Streams embed
 * @constructor
 * @param {Object} [options]
 * @param {String} options.publisherId Publisher of the stream the embed is for.
 * @param {String} options.streamName Name of that stream.
 * @param {String} options.html Sanitized embed source.
 * @param {String} [options.retainKey] Key for Streams.retain/release
 *   bookkeeping. Defaults to "Streams/embed:publisherId:streamName".
 * @param {RegExp|Array} [options.embedTemplates=/^Embed\//] Template names
 *   Q/if and Q/each are allowed to render.
 */
Q.Tool.define('Streams/embed', function (options) {
    var tool = this;
    var state = this.state;
    var publisherId = state.publisherId;
    var streamName = state.streamName;
    var html = state.html;
    var retainKey = state.retainKey
        || ('Streams/embed:' + publisherId + ':' + streamName);
    var disposed = false;
    var activeSession = null;

    if (!publisherId || !streamName) {
        console.error('Streams/embed: publisherId and streamName are required');
        return;
    }
    if (typeof html !== 'string') {
        console.error('Streams/embed: html option must be a string');
        return;
    }

    tool.element.classList.add('Streams_embed');

    Q.Streams.retainWith(retainKey).get(
        publisherId, streamName, function (err, stream) {
            if (disposed) return;
            if (err || !stream) {
                console.error('Streams/embed: could not load stream', err);
                return;
            }
            buildAndRender(stream);
        }
    );

    function buildAndRender(stream) {
        var page = buildPage(stream);
        Q.Template.bind('Streams/embed', { page: page }, {
            tool: tool,
            embedTemplates: state.embedTemplates
        }).then(function (session) {
            if (disposed) { session.dispose(); return; }
            activeSession = session;
            // Expose the bound session and page for the declarative
            // action layer (Q.Embed._applyResult inline merge).
            tool.Q_embed_session = session;
            tool.Q_embed_page = page;

            // innerHTML is safe here because the html option was produced
            // by Q_Embed_Sanitizer at save time: every <script> path, every
            // event-handler attribute, every javascript:/data:/vbscript:
            // URL, and every DOM-clobbering id/name is already rejected.
            // The <template> parse keeps the contents inert until stamp().
            var template = document.createElement('template');
            template.innerHTML = html;

            // Wrap the stamped content in an implicit Q/lazyload region so
            // any .Q_tool[data-q-lazyload] descendants (typically the rows
            // of a <q-each>) activate on scroll and tear down on exit.
            var lazyWrapper = document.createElement('div');
            lazyWrapper.className = 'Q_tool';
            lazyWrapper.setAttribute('data-q-tool', 'Q/lazyload');
            lazyWrapper.appendChild(session.stamp(template.content, { page: page }));
            tool.element.appendChild(lazyWrapper);
            Q.activate(tool.element);

            // Delegated click handler for data-action / <q-submit>.
            // No-op if the embed uses no actions. Idempotent per root.
            if (Q.Embed && typeof Q.Embed.bindActions === 'function') {
                Q.Embed.bindActions(tool.element);
            }

            // When rendered inside an iframe, tell the host via Q.Users.Embed.
            if (inIframe()) {
                postToParent('Q.Users.Embed.ready', {
                    publisherId: publisherId,
                    streamName: streamName
                });
                startResizeObserver();
            }
        }).catch(function (err) {
            console.error('Streams/embed: bind failed', err);
            if (inIframe()) {
                postToParent('Q.Users.Embed.error', {
                    message: (err && err.message) || 'bind failed'
                });
            }
        });
    }

    // True whenever this document is framed. The try/catch handles the
    // cross-origin case: reading window.top from a frame on a different
    // origin throws, but the fact it throws is itself the signal.
    function inIframe() {
        try { return window.self !== window.top; }
        catch (e) { return true; } // if accessing window.top throws, we're cross-origin inside an iframe
    }

    // Deliver a message to the hosting page. We use the parent origin
    // Q.info.expectedParentOrigin when set and fall back to '*' because
    // this is a public embed route whose host origin is not known at save
    // time; the Users.Embed bridge on the parent side gates delivery with
    // its own sameDocument check, so a leaked '*' target does not let the
    // wrong frame impersonate a response -- it just means a second embed
    // on the same parent page may receive an echo it then drops.
    function postToParent(type, payload) {
        try {
            var target = Q.getObject('Q.info.expectedParentOrigin') || '*';
            window.parent.postMessage({ type: type, payload: payload }, target);
        } catch (e) {
            console.warn('Streams/embed: postMessage to parent failed', e);
        }
    }

    // Report document height back to the parent so Q.Users.Embed.autoHeight
    // can resize the iframe. We observe both <html> and <body> because
    // either may be the layout root depending on the embed's CSS, and we
    // fire one synchronous measure out of the stamping tick in case the
    // content settled before the ResizeObserver's first callback. The
    // parent clamps the height it receives, so an inflated number here is
    // harmless on their side.
    var resizeObserver = null;
    var lastHeight = 0;
    function startResizeObserver() {
        if (typeof ResizeObserver === 'undefined') return;
        var measure = function () {
            var h = Math.ceil(document.documentElement.scrollHeight
                || document.body.scrollHeight
                || tool.element.scrollHeight || 0);
            if (h > 0 && h !== lastHeight) {
                lastHeight = h;
                postToParent('Q.Users.Embed.resize', { height: h });
            }
        };
        resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(document.documentElement);
        if (document.body) resizeObserver.observe(document.body);
        // One synchronous measure in case content has settled before observer fires.
        setTimeout(measure, 0);
    }

    function buildPage(stream) {
        // Keep this list in sync with config/Q/Embed.json's "vocabulary"
        // entry. Anything not here can't be referenced from the embed.
        return {
            stream: {
                publisherId: stream.fields.publisherId,
                name: stream.fields.name,
                title: stream.fields.title,
                content: stream.fields.content,
                icon: stream.iconUrl ? stream.iconUrl() : stream.fields.icon,
                type: stream.fields.type,
                createdTime: stream.fields.insertedTime
            }
            // Related, participants, messages, canSee/canContribute/canAdmin
            // get populated by further Streams.get / Streams.related calls
            // the embed definition requires. Day one: title/content/icon
            // are enough for the simplest embeds; expand per vocabulary.
        };
    }

    // Teardown: set the disposed flag so the in-flight stream.get and
    // Q.Template.bind.then callbacks drop their results if they come back
    // after removal, disconnect the resize observer, dispose the bound
    // session (frees its Proxy listeners and keyed-row reconciler state),
    // and release the stream retention so the Streams layer can gc it.
    tool.Q.beforeRemove.set(function () {
        disposed = true;
        if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
        if (activeSession) activeSession.dispose();
        Q.Streams.release(retainKey);
    });
}, {
    publisherId: null,
    streamName: null,
    html: '',
    retainKey: null,
    embedTemplates: /^Embed\//
});

})(Q, Q.jQuery);
