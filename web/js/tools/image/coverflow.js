(function (Q, $) {

var Streams = Q.Streams;
var Users = Q.Users;

/**
 * @module Streams-tools
 */

/**
 * Renders a coverflow of related images
 * @class Streams/image/coverflow
 * @constructor
 * @param {Object} [options]
 *   @param {String} [options.publisherId]
 *   @param {String} [options.streamName]
 *   @param {Object} [options.related] options for Streams/related
 *   @param {Object} [options.coverflow] options for Q/coverflow
 */
Q.Tool.define("Streams/image/coverflow", function (options) {
	var tool = this;
	var state = tool.state;

	if (!state.publisherId || !state.streamName) {
		throw new Q.Error("Streams/image/coverflow: missing publisherId or streamName");
	}

	// Container UL for images
	var coversEl = Q.element("ul", {"class": "Q_coverflow_covers"});
	tool.element.appendChild(coversEl);

	// Fetch related images
	Streams.related(
		state.publisherId,
		state.streamName,
		"Streams/images",
		true,
		state.related,
		function (err) {
			if (err) {
				console.warn("Streams/image/coverflow related error:", err);
				return;
			}
			var relatedStreams = this.relatedStreams || [];
			var elements = [];

			relatedStreams.forEach(function (s) {
				var f = s.fields;
				var img = Q.element("img", {
					src: s.iconUrl ? s.iconUrl(400) : Q.url("{{Q}}/img/placeholder.png"),
					title: f.title || ""
				});
				var li = Q.element("li", {title: f.title || ""}, [img]);
				coversEl.appendChild(li);
				elements.push(img);
			});

			// Activate Q/coverflow on the list
			Q.activate(coversEl.parentNode, function () {
				tool.child("Q_coverflow").state.onInvoke.set(function () {
					// Optional: handle clicks on the middle cover
					Q.handle(state.onInvoke, tool, arguments);
				}, tool);
			});
		}
	);

	// Set up the Q/coverflow tool wrapper
	Q.Tool.setUpElement(
		"div",
		"Q/coverflow",
		Q.extend({elements: []}, state.coverflow),
		tool.prefix + "_coverflow"
	);

}, {
	publisherId: null,
	streamName: null,
	related: {limit: 50, offset: 0, sortable: true},
	coverflow: {scrollOnMouseMove: 0.5},
	onInvoke: new Q.Event()
}, {
	refresh: function (onUpdate) {
		var relatedTool = this.child("Streams_related");
		if (relatedTool) {
			relatedTool.refresh(onUpdate);
		}
	}
});

})(Q, Q.jQuery);