(function (Q, $, window, undefined) {

var Users = Q.Users;
var Streams = Q.Streams;

/**
 * @module Streams-tools
 */

/**
 * Displays a gallery of related images, backed by Q/gallery.
 * Allows editing of per-image params if user has relations write access.
 * @class Streams/image/gallery
 * @constructor
 * @param {Object} [options]
 */
Q.Tool.define("Streams/image/gallery", function (options) {
	var tool = this;
	var state = tool.state;

	if (!Users.loggedInUser) {
		throw new Q.Error("Streams/image/gallery: You are not logged in.");
	}
	if ((!state.publisherId || !state.streamName)
		&& (!state.stream || Q.typeOf(state.stream) !== 'Streams.Stream')) {
		throw new Q.Error("Streams/image/gallery: missing publisherId or streamName");
	}

	// Container for the gallery
	var container = Q.element("div", {"class": "Streams_image_gallery_container"});
	tool.element.appendChild(container);

	state.$gallery = container;

	tool.refresh();

}, {
	// defaults
	publisherId: null,
	streamName: null,
	relationType: "Streams/images",
	params: {
		transition: { duration: 1000, ease: "smooth", type: "crossfade" },
		interval:   { duration: 3000, ease: "smooth", type: "" },
		autoplay:   true,
		loop:       true
	}
}, {
	refresh: function () {
		var tool = this, state = tool.state;

		Streams.get(state.publisherId, state.streamName).then(function (stream) {
			Streams.related(state.publisherId, state.streamName, state.relationType, true, {}, function (err) {
				if (err) return console.warn(err);

				var images = [];
				var self = this;
				Q.each(self.relatedStreams, function (_, imgStream) {
					var overrides = imgStream.getAttribute("Streams/image/gallery") || {};
					images.push(Q.extend({}, 2, {
						src: imgStream.iconUrl(800),
						caption: imgStream.fields.title || ""
					}, 2, overrides));
				});

				// clear old gallery
				state.$gallery.innerHTML = "";

				// mount Q/gallery
				Q.Tool.setUpElement(state.$gallery, "Q/gallery", Q.extend({}, 2, state.params, {
					images: images,
					onTransition: new Q.Event(function (idx) {
						if (stream.testWriteLevel("relations")) {
							var imgStream = self.relatedStreams[idx];
							tool.openImageEditor(imgStream);
						}
					})
				}));
			});
		});
	},

	openImageEditor: function (imageStream) {
		var tool = this;
		var overrides = imageStream.getAttribute("Streams/image/gallery") || {};
		var intervalVal = (overrides.interval && overrides.interval.duration) 
			|| tool.state.params.interval.duration;

		var content = Q.element("div", {"class": "Q_gallery_image_editor"}, [
			Q.element("h3", {}, [tool.text.gallery.EditImageTitle]),
			Q.element("label", {}, [
				tool.text.gallery.IntervalLabel,
				Q.element("input", {
					type: "number",
					name: "interval",
					value: intervalVal,
					placeholder: tool.text.gallery.IntervalPlaceholder
				})
			]),
			Q.element("p", {}, [tool.text.gallery.KenburnsInstruction]),
			Q.element("div", {"class": "Q_gallery_kenburns_start"}),
			Q.element("div", {"class": "Q_gallery_kenburns_end"})
		]);

		var startDiv = content.querySelector(".Q_gallery_kenburns_start");
		var endDiv   = content.querySelector(".Q_gallery_kenburns_end");
		var fromSel, toSel;

		var startImg = Q.element("img", {src: imageStream.iconUrl(800)});
		var endImg   = Q.element("img", {src: imageStream.iconUrl(800)});
		startDiv.appendChild(startImg);
		endDiv.appendChild(endImg);

		Q.Tool.setUpElement(startImg, "Q/viewport", {
			onUpdate: new Q.Event(function (sel) { fromSel = sel; })
		});
		Q.Tool.setUpElement(endImg, "Q/viewport", {
			onUpdate: new Q.Event(function (sel) { toSel = sel; })
		});

		Q.Dialogs.push({
			title: tool.text.gallery.DialogTitle,
			content: content,
			apply: true,
			onClose: function () {
				var intervalInput = content.querySelector("input[name=interval]");
				var interval = parseInt(intervalInput.value, 10);

				if (isNaN(interval) || interval <= 0) {
					alert(tool.text.errors.AmountInvalid);
					return;
				}

				var newOverrides = {
					interval: { duration: interval }
				};

				if (fromSel && toSel) {
					newOverrides.interval.type = "kenburns";
					newOverrides.interval.from = fromSel;
					newOverrides.interval.to   = toSel;
				}

				imageStream.setAttribute("Streams/image/gallery", newOverrides);
				imageStream.save({changed: {attributes: true}}, function (err) {
					if (err) {
						console.warn("Failed to save image params:", err);
					} else {
						tool.refresh();
					}
				});
			}
		});
	}
});

})(Q, Q.jQuery, window);