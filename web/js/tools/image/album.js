(function (Q, $, window, undefined) {

var Users = Q.Users;

/**
 * @module Streams-tools
 */

/**
 * Renders an album of related images
 * @class Streams/image/album
 * @constructor
 * @param {Object} [options] options for the tool
 */
Q.Tool.define("Streams/image/album", function (options) {
	var tool = this;
	var state = tool.state;

	if (!Users.loggedInUser) {
		throw new Q.Error("Streams/image/album: You are not logged in.");
	}
	if ((!state.publisherId || !state.streamName)
		&& (!state.stream || Q.typeOf(state.stream) !== 'Streams.Stream')) {
		throw new Q.Error("Streams/image/album: missing publisherId or streamName");
	}

	// Set up the related tool inside this tool’s element
	Q.Tool.setUpElement(
		'div',
		'Streams/related',
		{
			publisherId: state.publisherId,
			streamName: state.streamName,
			relationType: 'Streams/images',
			isCategory: true,
			realtime: state.realtime,
			editable: state.editable,
			closeable: state.closeable,
			sortable: state.sortable,
			creatable: {
				'Streams/image': {
					title: tool.text && tool.text.image && tool.text.image.newImage || "New Image"
				}
			},
			// forward options down to preview tool
			previewOptions: Q.extend({}, state.previewOptions, {
				editable: state.editable,
				closeable: state.closeable
			})
		},
		tool.prefix + "_related"
	);

}, {
	// defaults
	publisherId: null,
	streamName: null,
	relationType: "Streams/images",
	realtime: false,
	editable: true,
	closeable: true,
	sortable: true,
	previewOptions: {}
}, {
	// methods
	refresh: function (onUpdate) {
		var relatedTool = this.child("Streams_related");
		if (relatedTool) {
			relatedTool.refresh(onUpdate);
		}
	}
});

})(Q, Q.jQuery, window);