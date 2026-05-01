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

	// Fetch related images
	Streams.related(state.publisherId, state.streamName, state.relationType, true, state.related, function (err) {
		if (err) {
			console.warn("Streams/image/coverflow related error:", err);
			return;
		}

		var elements = [];

		Object.values(this.relatedStreams || {}).forEach(function (stream) {
			elements.push(
				Q.element("img", {
					src: stream.iconUrl ? stream.iconUrl(state.image.size) : Q.url("{{Q}}/img/placeholder.png"),
					title: stream.fields.title || "",
					"data-publisherId": stream.fields.publisherId,
					"data-streamName": stream.fields.name
				})
			);
		});

		// Activate Q/coverflow on the list
		$(tool.element).tool("Q/coverflow", Q.extend({ elements }, state.coverflow)).activate(function () {
			Q.Tool.from(this.element, "Q/coverflow").state.onInvoke.set(function () {
				Q.handle(state.onInvoke, tool, arguments);
			}, tool);
		});
		
	});

}, {
	publisherId: null,
	streamName: null,
	relationType: "Streams/image",
	image: {
		size: 400
	},
	related: {
		limit: 50,
		offset: 0,
		sortable: true
	},
	coverflow: {
		scrollOnMouseMove: 0.5
	},
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