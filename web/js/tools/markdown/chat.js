(function (Q, $, window, undefined) {
	/**
	 * Render chat messages with Markdown or HTML based on parse_mode
	 * @class Streams/markdown/chat
	 * @constructor
	 * @param {Object} [options] Parameters for this tool
	 * @param {Object} [options.allowedTags] Whitelisted HTML tags, tagName: true
	 */
	Q.Tool.define("Streams/markdown/chat", ["Streams/chat"], function (options) {
		var tool = this;
		tool.chatTool = Q.Tool.from(this.element, "Streams/chat");

		// Load marked.js if available
		Q.addScript("{{Q}}/js/markdown/marked.js", function () {
			tool.markedReady = true;

			// Hook into message rendering
			tool.chatTool.state.onMessageRender.set(function (message, html) {
				var content = message.getContent();
				var parseMode = message.getInstruction("parse_mode");
				var $message = html.find(".Streams_chat_text");

				if (!$message.length || !content) return;

				let newHtml;
				if (parseMode === "html") {
					newHtml = tool.sanitizeHtml(content);
				} else if (parseMode === "markdown") {
					newHtml = tool.renderMarkdown(content);
				} else {
					newHtml = content.encodeHTML().replace(/\n/g, "<br>");
				}

				$message.html(newHtml);
			}, tool);

			// Re-render already existing messages (e.g. from initial load)
			$(".Streams_chat_item", tool.chatTool.element).each(function () {
				const message = $(this).data("Streams/chat/message");
				if (message) {
					tool.chatTool.state.onMessageRender.call(tool, message, $(this));
				}
			});
		});
	},

	// Default options
	{
		allowedTags: {
			b: true, strong: true,
			i: true, em: true,
			u: true, ins: true,
			s: true, strike: true, del: true,
			span: true, // Only with class="tg-spoiler"
			code: true, pre: true,
			a: true
		}
	},

	// Methods
	{
		renderMarkdown: function (text) {
			if (typeof marked !== "undefined" && this.markedReady) {
				return marked.parse(text);
			}
			// Simple fallback
			// Improved fallback Markdown renderer
            return text.encodeHTML()
                .replace(/`([^`]+?)`/g, '<code>$1</code>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.+?)__/g, '<strong>$1</strong>')
                .replace(/\*(?!\*)(.+?)\*/g, '<em>$1</em>')   // Avoid matching bold
                .replace(/_(?!_)(.+?)_/g, '<em>$1</em>')     // Avoid matching bold
                .replace(/~~(.+?)~~/g, '<del>$1</del>')
                .replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
                .replace(/\n/g, '<br>');


		},

		sanitizeHtml: function (html) {
			const tool = this;
			const whitelist = tool.state.allowedTags;
			const div = document.createElement("div");
			div.innerHTML = html;

			const walk = (node) => {
				const children = Array.from(node.childNodes);
				for (const child of children) {
					if (child.nodeType === 1) {
						const tag = child.tagName.toLowerCase();
						const isSpoiler = tag === "span" && child.getAttribute("class") === "tg-spoiler";
						if (!whitelist[tag] || (tag === "span" && !isSpoiler)) {
							// Replace with text content instead of inner HTML to avoid double parsing
							node.replaceChild(document.createTextNode(child.textContent), child);
						} else {
							walk(child); // Recurse
						}
					}
				}
			};

			walk(div);
			return div.innerHTML;
		}
	});

})(Q, Q.jQuery, window);