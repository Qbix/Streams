(function (Q, $, window, undefined) {

/**
 * Tool for editing a stream's content field as Markdown.
 * View mode: renders Markdown to HTML via marked.js.
 * Edit mode: split-pane textarea + live preview, with toolbar.
 * Same API shape as Streams/html.
 * @class Streams/markdown
 * @constructor
 * @param {Object} [options]
 *   @param {String} options.publisherId
 *   @param {String} options.streamName
 *   @param {String} [options.field="content"] Which stream field to edit
 *   @param {String} [options.attribute] Use an attribute instead of a field
 *   @param {Boolean} [options.editable] Whether to show the editor
 *   @param {String} [options.placeholder="Write in Markdown..."]
 *   @param {Boolean} [options.livePreview=true] Show live preview while editing
 *   @param {Object} [options.markedOptions] Options passed to marked.parse()
 *   @param {Q.Event} [options.onSave] Fires after content is saved
 *   @param {Q.Event} [options.onRefresh] Fires after rendering
 */
Q.Tool.define("Streams/markdown",

function _Streams_markdown(options) {
    var tool = this;
    var state = tool.state;

    if (!state.publisherId || !state.streamName) {
        throw new Q.Error("Streams/markdown: publisherId and streamName are required");
    }

    // Load marked.js
    Q.addScript('{{Q}}/js/markdown/marked.js', function () {
        tool._markedLoaded = true;
        tool.refresh();
    });
},

{
    publisherId: null,
    streamName: null,
    field: 'content',
    attribute: null,
    editable: false,
    placeholder: 'Write in Markdown...',
    livePreview: true,
    markedOptions: {
        breaks: true,
        gfm: true
    },
    onSave: new Q.Event(),
    onRefresh: new Q.Event()
},

{
    refresh: function () {
        var tool = this;
        var state = tool.state;

        if (!tool._markedLoaded) return;

        Q.Streams.get(state.publisherId, state.streamName, function (err) {
            if (err) return;
            var stream = this;
            var markdown = state.attribute
                ? stream.getAttribute(state.attribute) || ''
                : stream.fields[state.field] || '';

            tool._stream = stream;
            tool._markdown = markdown;

            if (state.editable && stream.testWriteLevel('suggest')) {
                tool._renderEditor(markdown);
            } else {
                tool._renderView(markdown);
            }

            Q.handle(state.onRefresh, tool, [stream]);
        });
    },

    _renderView: function (markdown) {
        var tool = this;
        var html = tool._parse(markdown);
        tool.element.innerHTML = '<div class="Streams_markdown_view">' + html + '</div>';
    },

    _renderEditor: function (markdown) {
        var tool = this;
        var state = tool.state;

        var container = document.createElement('div');
        container.className = 'Streams_markdown_editor';

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.className = 'Streams_markdown_toolbar';
        var buttons = [
            { label: 'B', action: 'bold', wrap: ['**', '**'] },
            { label: 'I', action: 'italic', wrap: ['*', '*'] },
            { label: '🔗', action: 'link', wrap: ['[', '](url)'] },
            { label: '🖼', action: 'image', wrap: ['![alt](', ')'] },
            { label: 'H1', action: 'h1', prefix: '# ' },
            { label: 'H2', action: 'h2', prefix: '## ' },
            { label: 'H3', action: 'h3', prefix: '### ' },
            { label: '•', action: 'ul', prefix: '- ' },
            { label: '1.', action: 'ol', prefix: '1. ' },
            { label: '> ', action: 'quote', prefix: '> ' },
            { label: '``', action: 'code', wrap: ['`', '`'] },
            { label: '```', action: 'codeblock', wrap: ['```\n', '\n```'] }
        ];

        buttons.forEach(function (btn) {
            var el = document.createElement('button');
            el.className = 'Streams_markdown_btn';
            el.type = 'button';
            el.textContent = btn.label;
            el.title = btn.action;
            el.addEventListener('click', function (e) {
                e.preventDefault();
                tool._applyFormat(btn);
            });
            toolbar.appendChild(el);
        });
        container.appendChild(toolbar);

        // Editor pane
        var editorPane = document.createElement('div');
        editorPane.className = 'Streams_markdown_panes'
            + (state.livePreview ? ' Streams_markdown_split' : '');

        var textarea = document.createElement('textarea');
        textarea.className = 'Streams_markdown_textarea';
        textarea.value = markdown;
        textarea.placeholder = state.placeholder;
        tool._textarea = textarea;
        editorPane.appendChild(textarea);

        // Live preview
        if (state.livePreview) {
            var preview = document.createElement('div');
            preview.className = 'Streams_markdown_preview Streams_markdown_view';
            preview.innerHTML = tool._parse(markdown);
            tool._previewEl = preview;
            editorPane.appendChild(preview);

            textarea.addEventListener('input', function () {
                preview.innerHTML = tool._parse(textarea.value);
            });
        }

        container.appendChild(editorPane);

        // Save on blur
        textarea.addEventListener('blur', function () {
            var newVal = textarea.value;
            if (newVal === tool._markdown) return;
            tool._markdown = newVal;
            tool._save(newVal);
        });

        // Ctrl/Cmd+S to save
        textarea.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                var newVal = textarea.value;
                if (newVal !== tool._markdown) {
                    tool._markdown = newVal;
                    tool._save(newVal);
                }
            }
        });

        Q.Tool.clear(tool.element);
        tool.element.innerHTML = '';
        tool.element.appendChild(container);
    },

    _parse: function (markdown) {
        if (!markdown) return '';
        if (window.marked && marked.parse) {
            return marked.parse(markdown, this.state.markedOptions);
        }
        // Fallback: return escaped HTML
        return Q.htmlEntities(markdown).replace(/\n/g, '<br>');
    },

    _applyFormat: function (btn) {
        var ta = this._textarea;
        if (!ta) return;
        var start = ta.selectionStart;
        var end = ta.selectionEnd;
        var text = ta.value;
        var selected = text.substring(start, end) || btn.action;

        if (btn.wrap) {
            ta.value = text.substring(0, start)
                + btn.wrap[0] + selected + btn.wrap[1]
                + text.substring(end);
            ta.selectionStart = start + btn.wrap[0].length;
            ta.selectionEnd = start + btn.wrap[0].length + selected.length;
        } else if (btn.prefix) {
            // Find start of current line
            var lineStart = text.lastIndexOf('\n', start - 1) + 1;
            ta.value = text.substring(0, lineStart)
                + btn.prefix
                + text.substring(lineStart);
            ta.selectionStart = start + btn.prefix.length;
            ta.selectionEnd = end + btn.prefix.length;
        }

        ta.focus();
        ta.dispatchEvent(new Event('input'));
    },

    _save: function (value) {
        var tool = this;
        var state = tool.state;
        var stream = tool._stream;
        if (!stream) return;

        if (state.attribute) {
            stream.setAttribute(state.attribute, value);
            stream.save(function () {
                Q.handle(state.onSave, tool, [value]);
            });
        } else {
            var fields = {};
            fields[state.field] = value;
            stream.set(fields);
            stream.save(function () {
                Q.handle(state.onSave, tool, [value]);
            });
        }
    },

    Q: {
        beforeRemove: function () {
            this._textarea = null;
            this._previewEl = null;
            this._stream = null;
        }
    }
});

})(Q, Q.jQuery, window);
